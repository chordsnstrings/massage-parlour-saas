// Google Business Profile: OAuth 2.0 (PKCE S256 + HMAC-signed state), token exchange/refresh and the Business Profile
// APIs (account management, business information, v4 reviews + local posts). Pure helpers and fetch calls only —
// no database access here (see ../gbp.ts and ../reviews.ts). Never log or return tokens: errors carry only the HTTP
// status and Google's own message.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/business.manage'
export const GOOGLE_ENDPOINTS = {
  authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  revoke: 'https://oauth2.googleapis.com/revoke',
  accounts: 'https://mybusinessaccountmanagement.googleapis.com/v1/accounts',
  businessInfo: 'https://mybusinessbusinessinformation.googleapis.com/v1',
  v4: 'https://mybusiness.googleapis.com/v4',
} as const
const STATE_TTL_MS = 10 * 60_000

type Env = Record<string, string | undefined>
type FetchFn = typeof fetch

// ── Configuration ───────────────────────────────────────────────────────────

export const GOOGLE_ENV = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] as const
export type GoogleConfig = { clientId: string; clientSecret: string }

/** The OAuth client, or null while GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are missing. */
export function googleConfig(env: Env = process.env): GoogleConfig | null {
  const clientId = env.GOOGLE_CLIENT_ID?.trim()
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim()
  return clientId && clientSecret ? { clientId, clientSecret } : null
}

/** `{APP_URL}/api/integrations/google/callback` (API routes are served at the app origin in both routing modes). */
export const googleRedirectUri = (env: Env = process.env) =>
  `${(env.APP_URL ?? 'http://app.localhost:3000').replace(/\/$/, '')}/api/integrations/google/callback`

// ── OAuth state + PKCE ──────────────────────────────────────────────────────

export type GoogleOAuthState = { tenantId: string; userId: string; nonce: string; exp: number }

const hmac = (secret: string, data: string) => createHmac('sha256', secret).update(data).digest()
const safeEqual = (a: Buffer, b: Buffer) => a.length === b.length && a.length > 0 && timingSafeEqual(a, b)

export const newGoogleNonce = () => randomBytes(16).toString('base64url')

/** `base64url(json).base64url(hmac-sha256)` binding tenant, user and a cookie nonce to one connect attempt (10 min). */
export function signGoogleState(
  input: { tenantId: string; userId: string; nonce: string },
  secret: string,
  now = Date.now(),
) {
  if (!secret) throw new Error('OAuth state needs a signing secret')
  const body: GoogleOAuthState = { ...input, exp: now + STATE_TTL_MS }
  const payload = Buffer.from(JSON.stringify(body)).toString('base64url')
  return `${payload}.${hmac(secret, payload).toString('base64url')}`
}

/** The state when the signature matches and it hasn't expired; null otherwise. */
export function verifyGoogleState(
  state: string | null | undefined,
  secret: string,
  now = Date.now(),
): GoogleOAuthState | null {
  if (!state || !secret) return null
  const [payload, sig, extra] = state.split('.')
  if (!payload || !sig || extra !== undefined) return null
  if (!safeEqual(Buffer.from(sig, 'base64url'), hmac(secret, payload))) return null
  try {
    const d = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<GoogleOAuthState>
    if (typeof d.tenantId !== 'string' || typeof d.userId !== 'string' || typeof d.nonce !== 'string')
      return null
    if (typeof d.exp !== 'number' || d.exp < now) return null
    return { tenantId: d.tenantId, userId: d.userId, nonce: d.nonce, exp: d.exp }
  } catch {
    return null
  }
}

/** Constant-time comparison of two strings (hashed first so lengths don't leak). */
export function sameSecret(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b) return false
  const h = (s: string) => createHash('sha256').update(s).digest()
  return timingSafeEqual(h(a), h(b))
}

/** RFC 7636 S256 challenge for a verifier. */
export const pkceChallenge = (verifier: string) => createHash('sha256').update(verifier).digest('base64url')

/** A fresh PKCE pair (43-char verifier from 32 random bytes). */
export function createPkce() {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: pkceChallenge(verifier) }
}

export function googleAuthorizeUrl(opts: {
  clientId: string
  redirectUri: string
  state: string
  codeChallenge: string
}) {
  const q = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: opts.state,
    code_challenge: opts.codeChallenge,
    code_challenge_method: 'S256',
  })
  return `${GOOGLE_ENDPOINTS.authorize}?${q.toString()}`
}

// ── Errors ──────────────────────────────────────────────────────────────────

export class GoogleApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Google's machine reason, e.g. `invalid_grant`, `PERMISSION_DENIED`. */
    readonly reason?: string,
  ) {
    super(message)
    this.name = 'GoogleApiError'
  }
  /** The token is unusable (expired, revoked or invalid) — refresh or reconnect. */
  get isAuth() {
    return this.status === 401 || this.reason === 'invalid_grant' || this.reason === 'UNAUTHENTICATED'
  }
}

/** Plain-language explanation of a Google failure for staff (never includes tokens). */
export function describeGoogleError(e: unknown): string {
  if (e instanceof GoogleApiError) {
    if (e.isAuth)
      return 'Google sign-in expired or was revoked. Reconnect Google Business Profile in Settings.'
    if (e.status === 403 || e.status === 429)
      return `Google refused the request (${e.status}): ${e.message}. API access may still be awaiting Google's approval.`
    if (e.status === 404) return 'Google could not find this review or location any more.'
    if (e.status === 0) return "Couldn't reach Google. Please try again in a moment."
    return `Google returned an error (${e.status}): ${e.message}`
  }
  return 'Something went wrong talking to Google. Please try again.'
}

async function call<T>(
  fetchFn: FetchFn,
  url: string,
  init: RequestInit & { token?: string; json?: unknown } = {},
): Promise<T> {
  const { token, json, ...rest } = init
  const headers = new Headers(rest.headers)
  if (token) headers.set('authorization', `Bearer ${token}`)
  if (json !== undefined) headers.set('content-type', 'application/json')
  let res: Response
  try {
    res = await fetchFn(url, {
      ...rest,
      headers,
      body: json !== undefined ? JSON.stringify(json) : rest.body,
      signal: rest.signal ?? AbortSignal.timeout(20_000),
    })
  } catch {
    throw new GoogleApiError('network error', 0)
  }
  const text = await res.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = null
  }
  if (!res.ok) {
    const b = body as {
      error?: string | { message?: string; status?: string }
      error_description?: string
    } | null
    const err = b?.error
    const reason = typeof err === 'string' ? err : err?.status
    const message =
      (typeof err === 'string' ? b?.error_description || err : err?.message) || res.statusText || 'error'
    throw new GoogleApiError(message.slice(0, 300), res.status, reason)
  }
  return body as T
}

// ── Tokens ──────────────────────────────────────────────────────────────────

export type GoogleTokens = {
  accessToken: string
  /** Only on the first consent (or with prompt=consent); refreshes keep the original refresh token. */
  refreshToken: string | null
  expiresIn: number
  scopes: string[]
}

type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string }

function toTokens(r: TokenResponse): GoogleTokens {
  if (!r.access_token) throw new GoogleApiError('no access token returned', 502)
  return {
    accessToken: r.access_token,
    refreshToken: r.refresh_token ?? null,
    expiresIn: Number(r.expires_in ?? 3600),
    scopes: (r.scope ?? GOOGLE_SCOPE).split(' ').filter(Boolean),
  }
}

export async function exchangeGoogleCode(opts: {
  cfg: GoogleConfig
  code: string
  verifier: string
  redirectUri: string
  fetch?: FetchFn
}) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: opts.code,
    code_verifier: opts.verifier,
    client_id: opts.cfg.clientId,
    client_secret: opts.cfg.clientSecret,
    redirect_uri: opts.redirectUri,
  })
  return toTokens(
    await call<TokenResponse>(opts.fetch ?? fetch, GOOGLE_ENDPOINTS.token, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    }),
  )
}

export async function refreshGoogleToken(opts: { cfg: GoogleConfig; refreshToken: string; fetch?: FetchFn }) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: opts.refreshToken,
    client_id: opts.cfg.clientId,
    client_secret: opts.cfg.clientSecret,
  })
  return toTokens(
    await call<TokenResponse>(opts.fetch ?? fetch, GOOGLE_ENDPOINTS.token, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    }),
  )
}

/** Best-effort revocation on disconnect (Google revokes the whole grant for either token). */
export async function revokeGoogleToken(token: string, fetchFn: FetchFn = fetch) {
  try {
    await call(fetchFn, GOOGLE_ENDPOINTS.revoke, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    })
    return true
  } catch {
    return false
  }
}

// ── Accounts + locations ────────────────────────────────────────────────────

export type GbpAccount = { name: string; accountName: string; type: string }
export type GbpLocation = { name: string; title: string; address: string }

type RawAddress = { addressLines?: string[]; locality?: string; administrativeArea?: string }
const formatAddress = (a?: RawAddress) =>
  [...(a?.addressLines ?? []), a?.locality, a?.administrativeArea].filter(Boolean).join(', ')

const MAX_PAGES = 20

export async function listGbpAccounts(accessToken: string, fetchFn: FetchFn = fetch): Promise<GbpAccount[]> {
  const out: GbpAccount[] = []
  let pageToken: string | undefined
  for (let i = 0; i < MAX_PAGES; i++) {
    const q = new URLSearchParams({ pageSize: '20' })
    if (pageToken) q.set('pageToken', pageToken)
    const r = await call<{
      accounts?: { name: string; accountName?: string; type?: string }[]
      nextPageToken?: string
    }>(fetchFn, `${GOOGLE_ENDPOINTS.accounts}?${q}`, { token: accessToken })
    for (const a of r?.accounts ?? [])
      out.push({ name: a.name, accountName: a.accountName ?? a.name, type: a.type ?? '' })
    pageToken = r?.nextPageToken
    if (!pageToken) break
  }
  return out
}

/** Locations of one account (`accounts/123`): `locations/456` names with title + one-line address. */
export async function listGbpLocations(
  accessToken: string,
  accountName: string,
  fetchFn: FetchFn = fetch,
): Promise<GbpLocation[]> {
  const out: GbpLocation[] = []
  let pageToken: string | undefined
  for (let i = 0; i < MAX_PAGES; i++) {
    const q = new URLSearchParams({ readMask: 'name,title,storefrontAddress', pageSize: '100' })
    if (pageToken) q.set('pageToken', pageToken)
    const r = await call<{
      locations?: { name: string; title?: string; storefrontAddress?: RawAddress }[]
      nextPageToken?: string
    }>(fetchFn, `${GOOGLE_ENDPOINTS.businessInfo}/${accountName}/locations?${q}`, { token: accessToken })
    for (const l of r?.locations ?? [])
      out.push({ name: l.name, title: l.title ?? l.name, address: formatAddress(l.storefrontAddress) })
    pageToken = r?.nextPageToken
    if (!pageToken) break
  }
  return out
}

// ── Reviews ─────────────────────────────────────────────────────────────────

export const STAR_RATINGS = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 } as const

export type GoogleReview = {
  name: string
  reviewId?: string
  reviewer?: { displayName?: string; isAnonymous?: boolean; profilePhotoUrl?: string }
  starRating?: string
  comment?: string
  createTime?: string
  updateTime?: string
  reviewReply?: { comment?: string; updateTime?: string }
}

/** `FIVE` → 5; unknown / STAR_RATING_UNSPECIFIED → null. */
export const starRatingToNumber = (v: string | undefined | null): number | null =>
  v && v in STAR_RATINGS ? STAR_RATINGS[v as keyof typeof STAR_RATINGS] : null

export type MappedReview = {
  externalId: string
  author: string | null
  rating: number
  text: string | null
  reviewedAt: Date | null
  replyText: string | null
  repliedAt: Date | null
}

const date = (s?: string) => {
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

/** A v4 review → our row shape; null when it has no usable star rating. */
export function mapGoogleReview(r: GoogleReview): MappedReview | null {
  const rating = starRatingToNumber(r.starRating)
  if (!r.name || rating === null) return null
  const reply = r.reviewReply?.comment?.trim() || null
  return {
    externalId: r.name,
    author: r.reviewer?.isAnonymous ? null : r.reviewer?.displayName?.trim() || null,
    rating,
    text: r.comment?.trim() || null,
    reviewedAt: date(r.createTime),
    replyText: reply,
    repliedAt: reply ? date(r.reviewReply?.updateTime) : null,
  }
}

export type ReviewsPage = {
  reviews: GoogleReview[]
  nextPageToken?: string
  averageRating?: number
  totalReviewCount?: number
}

/** All reviews of `accounts/{a}/locations/{l}` (newest first, 50 per page, at most 20 pages). */
export async function listGbpReviews(
  accessToken: string,
  parent: string,
  fetchFn: FetchFn = fetch,
): Promise<Omit<ReviewsPage, 'nextPageToken'>> {
  const reviews: GoogleReview[] = []
  let meta: Pick<ReviewsPage, 'averageRating' | 'totalReviewCount'> = {}
  let pageToken: string | undefined
  for (let i = 0; i < MAX_PAGES; i++) {
    const q = new URLSearchParams({ pageSize: '50', orderBy: 'updateTime desc' })
    if (pageToken) q.set('pageToken', pageToken)
    const r = await call<ReviewsPage>(fetchFn, `${GOOGLE_ENDPOINTS.v4}/${parent}/reviews?${q}`, {
      token: accessToken,
    })
    reviews.push(...(r?.reviews ?? []))
    if (i === 0) meta = { averageRating: r?.averageRating, totalReviewCount: r?.totalReviewCount }
    pageToken = r?.nextPageToken
    if (!pageToken) break
  }
  return { reviews, ...meta }
}

/** Creates or replaces the owner reply on a review (`accounts/…/locations/…/reviews/…`). */
export async function putGbpReply(
  accessToken: string,
  reviewName: string,
  comment: string,
  fetchFn: FetchFn = fetch,
) {
  const r = await call<{ comment?: string; updateTime?: string }>(
    fetchFn,
    `${GOOGLE_ENDPOINTS.v4}/${reviewName}/reply`,
    { method: 'PUT', token: accessToken, json: { comment } },
  )
  return { comment: r?.comment ?? comment, updateTime: date(r?.updateTime) }
}

// ── Local posts ─────────────────────────────────────────────────────────────

/** Google's limit for a local post summary. */
export const LOCAL_POST_MAX = 1500

export type LocalPostBody = {
  languageCode: string
  summary: string
  topicType: 'STANDARD'
  callToAction: { actionType: 'BOOK'; url: string }
  media?: { mediaFormat: 'PHOTO'; sourceUrl: string }[]
}

/** A STANDARD post with a "Book" button; the photo is attached only when it's a public https URL. */
export function buildLocalPost(opts: { summary: string; bookingUrl: string; imageUrl?: string | null }) {
  const summary = opts.summary.trim()
  const body: LocalPostBody = {
    languageCode: 'en',
    summary: summary.length > LOCAL_POST_MAX ? `${summary.slice(0, LOCAL_POST_MAX - 1)}…` : summary,
    topicType: 'STANDARD',
    callToAction: { actionType: 'BOOK', url: opts.bookingUrl },
  }
  if (opts.imageUrl && isPublicHttpsUrl(opts.imageUrl))
    body.media = [{ mediaFormat: 'PHOTO', sourceUrl: opts.imageUrl }]
  return body
}

/** https and not a local / private host (Google must be able to fetch it). */
export function isPublicHttpsUrl(url: string) {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return false
    const h = u.hostname
    return !(
      h === 'localhost' ||
      h.endsWith('.localhost') ||
      h.endsWith('.local') ||
      /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(h) ||
      h === '[::1]'
    )
  } catch {
    return false
  }
}

export async function createGbpLocalPost(
  accessToken: string,
  parent: string,
  post: LocalPostBody,
  fetchFn: FetchFn = fetch,
) {
  const r = await call<{ name?: string; searchUrl?: string }>(
    fetchFn,
    `${GOOGLE_ENDPOINTS.v4}/${parent}/localPosts`,
    { method: 'POST', token: accessToken, json: post },
  )
  return { name: r?.name ?? null, searchUrl: r?.searchUrl ?? null }
}
