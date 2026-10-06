// Instagram API with Instagram Login (no Facebook Page): OAuth, webhook verification + parsing, Graph calls.
// Pure helpers and a fetch-based client — no database access here (see ../social.ts).
// Never log or return access tokens: errors are sanitised before they leave this module.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const GRAPH_VERSION = 'v21.0'
const GRAPH = 'https://graph.instagram.com'
const OAUTH_AUTHORIZE = 'https://www.instagram.com/oauth/authorize'
const OAUTH_TOKEN = 'https://api.instagram.com/oauth/access_token'

export const INSTAGRAM_SCOPES = [
  'instagram_business_basic',
  'instagram_business_manage_messages',
  'instagram_business_manage_comments',
  'instagram_business_content_publish',
] as const

/** Bot DMs are only allowed within 24 hours of the customer's last message. */
export const DM_WINDOW_MS = 24 * 3600_000
/** Instagram DM text limit (bytes). */
export const MAX_DM_BYTES = 1000
const STATE_TTL_MS = 10 * 60_000

// ── Configuration ───────────────────────────────────────────────────────────

export const META_ENV = ['META_APP_ID', 'META_APP_SECRET', 'META_WEBHOOK_VERIFY_TOKEN'] as const
export type MetaConfig = { appId: string; appSecret: string; verifyToken: string }

/** The Meta app settings, or null while any of META_APP_ID / META_APP_SECRET / META_WEBHOOK_VERIFY_TOKEN is missing. */
export function metaConfig(env: Record<string, string | undefined> = process.env): MetaConfig | null {
  const appId = env.META_APP_ID?.trim()
  const appSecret = env.META_APP_SECRET?.trim()
  const verifyToken = env.META_WEBHOOK_VERIFY_TOKEN?.trim()
  return appId && appSecret && verifyToken ? { appId, appSecret, verifyToken } : null
}

export const missingMetaEnv = (env: Record<string, string | undefined> = process.env) =>
  META_ENV.filter((k) => !env[k]?.trim())

/** Origin of the dashboard app (API routes live at `{origin}/api/...` in both routing modes). */
export const appOrigin = (env: Record<string, string | undefined> = process.env) =>
  (env.APP_URL ?? 'http://app.localhost:3000').replace(/\/$/, '')

/** URLs to paste into the Meta app dashboard. */
export const metaUrls = (origin = appOrigin()) => ({
  callback: `${origin}/api/integrations/meta/callback`,
  webhook: `${origin}/api/integrations/meta/webhook`,
  deauthorize: `${origin}/api/integrations/meta/deauthorize`,
  dataDeletion: `${origin}/api/integrations/meta/data-deletion`,
})

// ── OAuth state (HMAC-signed, 10 minutes) ───────────────────────────────────

export type OAuthState = { t: string; u: string; n: string; exp: number }

const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64url')
const hmac = (secret: string, data: string) => createHmac('sha256', secret).update(data).digest()

export const newNonce = () => randomBytes(16).toString('base64url')

/** `base64url(json).base64url(hmac)` — binds tenant, user and a cookie nonce to one connect attempt. */
export function signState(
  input: { tenantId: string; userId: string; nonce: string },
  secret: string,
  now = Date.now(),
) {
  const payload = b64(
    JSON.stringify({ t: input.tenantId, u: input.userId, n: input.nonce, exp: now + STATE_TTL_MS }),
  )
  return `${payload}.${b64(hmac(secret, payload))}`
}

/** The state payload when the signature matches and it hasn't expired; null otherwise. */
export function verifyState(state: string | null | undefined, secret: string, now = Date.now()) {
  if (!state) return null
  const [payload, sig] = state.split('.')
  if (!payload || !sig) return null
  if (!safeEqual(Buffer.from(sig, 'base64url'), hmac(secret, payload))) return null
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as OAuthState
    if (typeof data.t !== 'string' || typeof data.u !== 'string' || typeof data.n !== 'string') return null
    if (typeof data.exp !== 'number' || data.exp < now) return null
    return data
  } catch {
    return null
  }
}

export function authorizeUrl(opts: { appId: string; redirectUri: string; state: string }) {
  const q = new URLSearchParams({
    client_id: opts.appId,
    redirect_uri: opts.redirectUri,
    response_type: 'code',
    scope: INSTAGRAM_SCOPES.join(','),
    state: opts.state,
  })
  return `${OAUTH_AUTHORIZE}?${q.toString()}`
}

// ── Signatures ──────────────────────────────────────────────────────────────

function safeEqual(a: Buffer, b: Buffer) {
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b)
}

/** Constant-time string comparison (hashes first so lengths don't leak). */
export function constantTimeEqual(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b) return false
  const h = (s: string) => createHmac('sha256', 'compare').update(s).digest()
  return timingSafeEqual(h(a), h(b))
}

/** Checks `X-Hub-Signature-256: sha256=<hex>` against an HMAC-SHA256 of the raw body with the app secret. */
export function verifyMetaSignature(
  rawBody: string | Buffer,
  header: string | null | undefined,
  appSecret: string,
) {
  if (!header || !appSecret) return false
  const m = /^sha256=([0-9a-f]{64})$/i.exec(header.trim())
  if (!m?.[1]) return false
  return safeEqual(Buffer.from(m[1].toLowerCase(), 'hex'), hmac(appSecret, rawBody.toString()))
}

/** Test/helper: the header Meta would send for `rawBody`. */
export const metaSignature = (rawBody: string, appSecret: string) =>
  `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`

/** Meta `signed_request` (deauthorize / data-deletion callbacks): `sig.payload`, HMAC-SHA256 of the payload. */
export function parseSignedRequest(signed: string | null | undefined, appSecret: string) {
  if (!signed) return null
  const [sig, payload] = signed.split('.')
  if (!sig || !payload) return null
  if (!safeEqual(Buffer.from(sig, 'base64url'), hmac(appSecret, payload))) return null
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>
    return data.algorithm && String(data.algorithm).toUpperCase() !== 'HMAC-SHA256' ? null : data
  } catch {
    return null
  }
}

// ── Webhook payloads ────────────────────────────────────────────────────────

export type InstagramEvent =
  | {
      kind: 'dm'
      /** Our Instagram professional account (the recipient). */
      accountId: string
      /** Instagram-scoped id of the customer (the thread id). */
      senderId: string
      mid: string
      text: string
      at: Date
    }
  | {
      kind: 'comment'
      accountId: string
      commentId: string
      mediaId?: string
      parentId?: string
      fromId?: string
      fromUsername?: string
      text: string
      at: Date
    }

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : undefined
const str = (v: unknown) => (typeof v === 'string' && v ? v : typeof v === 'number' ? String(v) : undefined)
const arr = (v: unknown) => (Array.isArray(v) ? v : [])
const clip = (s: string) => (s.length > 2000 ? `${s.slice(0, 2000)}…` : s)
const when = (v: unknown, fallback: Date) => {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return new Date(n < 1e12 ? n * 1000 : n) // entry.time is seconds, messaging timestamps are ms
}

/**
 * Flattens an Instagram webhook body into the events we act on: customer DMs and comments.
 * Echoes of our own messages, deletions, reads, reactions and our own comment replies are skipped.
 */
export function parseInstagramWebhook(body: unknown, now = new Date()): InstagramEvent[] {
  const root = obj(body)
  if (!root || (root.object !== undefined && root.object !== 'instagram')) return []
  const out: InstagramEvent[] = []
  for (const e of arr(root.entry)) {
    const entry = obj(e)
    if (!entry) continue
    const entryId = str(entry.id)
    const entryAt = when(entry.time, now)
    for (const raw of arr(entry.messaging)) {
      const m = obj(raw)
      const message = obj(m?.message)
      if (!m || !message) continue
      if (message.is_echo || message.is_deleted) continue
      const senderId = str(obj(m.sender)?.id)
      const accountId = str(obj(m.recipient)?.id) ?? entryId
      const mid = str(message.mid)
      if (!senderId || !accountId || !mid || senderId === accountId) continue
      const attachment = obj(arr(message.attachments)[0])
      const text =
        str(message.text)?.trim() ||
        (attachment ? `[${str(attachment.type) ?? 'attachment'}]` : message.is_unsupported ? '[unsupported]' : '')
      if (!text) continue
      out.push({ kind: 'dm', accountId, senderId, mid, text: clip(text), at: when(m.timestamp, entryAt) })
    }
    for (const raw of arr(entry.changes)) {
      const change = obj(raw)
      if (!change || change.field !== 'comments') continue
      const v = obj(change.value)
      const commentId = str(v?.id)
      const text = str(v?.text)?.trim()
      if (!v || !entryId || !commentId || !text) continue
      const from = obj(v.from)
      const fromId = str(from?.id)
      if (fromId && fromId === entryId) continue // our own reply
      out.push({
        kind: 'comment',
        accountId: entryId,
        commentId,
        mediaId: str(obj(v.media)?.id),
        parentId: str(v.parent_id),
        fromId,
        fromUsername: str(from?.username),
        text: clip(text),
        at: entryAt,
      })
    }
  }
  return out
}

// ── Graph API client ────────────────────────────────────────────────────────

export class MetaApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: number,
  ) {
    super(message)
    this.name = 'MetaApiError'
  }
}

/** Removes anything token-like from provider messages before they are stored or shown. */
export const scrubSecrets = (s: string) =>
  s
    .replace(/(access_token|client_secret)=[^&\s"]+/gi, '$1=[redacted]')
    .replace(/\b(IG|EA)[A-Za-z0-9_-]{20,}\b/g, '[redacted]')
    .slice(0, 300)

type FetchFn = typeof fetch

async function request<T>(fetchImpl: FetchFn, url: string, init: RequestInit & { token?: string } = {}) {
  const { token, ...rest } = init
  const headers = new Headers(rest.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  let res: Response
  try {
    res = await fetchImpl(url, { ...rest, headers, signal: rest.signal ?? AbortSignal.timeout(15_000) })
  } catch {
    throw new MetaApiError(0, 'Could not reach Instagram — check the connection and try again.')
  }
  const text = await res.text()
  let data: Obj = {}
  try {
    data = obj(JSON.parse(text)) ?? {}
  } catch {
    // non-JSON error page
  }
  const err = obj(data.error)
  if (!res.ok || err) {
    const message =
      str(err?.error_user_msg) ?? str(err?.message) ?? str(data.error_message) ?? `HTTP ${res.status}`
    throw new MetaApiError(res.status, scrubSecrets(message), Number(err?.code ?? data.code) || undefined)
  }
  return data as T
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export type InstagramClient = ReturnType<typeof instagramClient>

export function instagramClient(fetchImpl: FetchFn = fetch) {
  const graph = (path: string) => `${GRAPH}/${GRAPH_VERSION}${path}`
  return {
    /** Short-lived user token from the OAuth code. */
    async exchangeCode(o: { appId: string; appSecret: string; redirectUri: string; code: string }) {
      const body = new URLSearchParams({
        client_id: o.appId,
        client_secret: o.appSecret,
        grant_type: 'authorization_code',
        redirect_uri: o.redirectUri,
        code: o.code.replace(/#_$/, ''),
      })
      const data = await request<Obj>(fetchImpl, OAUTH_TOKEN, { method: 'POST', body })
      const row = obj(arr(data.data)[0]) ?? data
      const accessToken = str(row.access_token)
      if (!accessToken) throw new MetaApiError(502, 'Instagram did not return an access token')
      const perms = row.permissions
      return {
        accessToken,
        userId: str(row.user_id),
        permissions: Array.isArray(perms) ? perms.map(String) : (str(perms)?.split(',') ?? []),
      }
    },
    /** Long-lived (60-day) token. */
    async longLivedToken(o: { appSecret: string; accessToken: string }) {
      const q = new URLSearchParams({
        grant_type: 'ig_exchange_token',
        client_secret: o.appSecret,
        access_token: o.accessToken,
      })
      const data = await request<Obj>(fetchImpl, `${GRAPH}/access_token?${q}`)
      const accessToken = str(data.access_token)
      if (!accessToken) throw new MetaApiError(502, 'Instagram did not return a long-lived token')
      return { accessToken, expiresIn: Number(data.expires_in) || 60 * 86_400 }
    },
    /** Extends a long-lived token (must be ≥ 24 h old and unexpired). */
    async refreshToken(accessToken: string) {
      const q = new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: accessToken })
      const data = await request<Obj>(fetchImpl, `${GRAPH}/refresh_access_token?${q}`)
      const next = str(data.access_token)
      if (!next) throw new MetaApiError(502, 'Instagram did not return a refreshed token')
      return { accessToken: next, expiresIn: Number(data.expires_in) || 60 * 86_400 }
    },
    async me(accessToken: string) {
      const data = await request<Obj>(fetchImpl, graph('/me?fields=user_id,username,profile_picture_url'), {
        token: accessToken,
      })
      const userId = str(data.user_id) ?? str(data.id)
      if (!userId) throw new MetaApiError(502, 'Instagram did not return the account id')
      return { userId, username: str(data.username), profilePictureUrl: str(data.profile_picture_url) }
    },
    /** Turns on message + comment webhooks for this account. */
    async subscribeWebhooks(accessToken: string) {
      await request(fetchImpl, graph('/me/subscribed_apps?subscribed_fields=messages,comments'), {
        method: 'POST',
        token: accessToken,
      })
    },
    /** Customer profile (needs a conversation with the account). */
    async userProfile(igsid: string, accessToken: string) {
      const data = await request<Obj>(
        fetchImpl,
        graph(`/${encodeURIComponent(igsid)}?fields=name,username`),
        { token: accessToken },
      )
      return { username: str(data.username), name: str(data.name) }
    },
    async sendMessage(o: { igUserId: string; recipientId: string; text: string; accessToken: string }) {
      const data = await request<Obj>(fetchImpl, graph(`/${encodeURIComponent(o.igUserId)}/messages`), {
        ...json({ recipient: { id: o.recipientId }, message: { text: o.text } }),
        token: o.accessToken,
      })
      return { messageId: str(data.message_id) }
    },
    async replyToComment(o: { commentId: string; text: string; accessToken: string }) {
      const data = await request<Obj>(fetchImpl, graph(`/${encodeURIComponent(o.commentId)}/replies`), {
        ...json({ message: o.text }),
        token: o.accessToken,
      })
      return { id: str(data.id) }
    },
    async createMediaContainer(o: { igUserId: string; imageUrl: string; caption: string; accessToken: string }) {
      const data = await request<Obj>(fetchImpl, graph(`/${encodeURIComponent(o.igUserId)}/media`), {
        ...json({ image_url: o.imageUrl, caption: o.caption }),
        token: o.accessToken,
      })
      const id = str(data.id)
      if (!id) throw new MetaApiError(502, 'Instagram did not create the media container')
      return { id }
    },
    async containerStatus(containerId: string, accessToken: string) {
      const data = await request<Obj>(
        fetchImpl,
        graph(`/${encodeURIComponent(containerId)}?fields=status_code`),
        { token: accessToken },
      )
      return str(data.status_code) ?? 'FINISHED'
    },
    async publishMedia(o: { igUserId: string; creationId: string; accessToken: string }) {
      const data = await request<Obj>(fetchImpl, graph(`/${encodeURIComponent(o.igUserId)}/media_publish`), {
        ...json({ creation_id: o.creationId }),
        token: o.accessToken,
      })
      const id = str(data.id)
      if (!id) throw new MetaApiError(502, 'Instagram did not return the published post id')
      return { id }
    },
  }
}

/** UTF-8 byte-safe truncation for DM text. */
export function clipBytes(text: string, max = MAX_DM_BYTES) {
  const enc = new TextEncoder()
  if (enc.encode(text).length <= max) return text
  let out = text
  while (out && enc.encode(`${out}…`).length > max) out = out.slice(0, -1)
  return `${out}…`
}

/** True while a DM reply is allowed (within 24 h of the customer's last message). */
export function dmWindowOpen(lastCustomerMsgAt: Date | null | undefined, now = new Date()) {
  return Boolean(lastCustomerMsgAt) && now.getTime() - lastCustomerMsgAt!.getTime() < DM_WINDOW_MS
}

/** Milliseconds left in the DM window (0 when closed). */
export function dmWindowLeftMs(lastCustomerMsgAt: Date | null | undefined, now = new Date()) {
  if (!lastCustomerMsgAt) return 0
  return Math.max(0, DM_WINDOW_MS - (now.getTime() - lastCustomerMsgAt.getTime()))
}
