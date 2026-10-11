// F19: the spa's Facebook Page (Facebook Login for Business). One `social_accounts` row, platform `facebook`:
// while a Page is being chosen `external_id = 'pending'` holds the long-lived *user* token (encrypted) to list the
// Pages; once chosen `external_id` = Page id, token = Page access token (encrypted), meta = Page name, the linked
// Instagram professional account (igUserId → also used for Instagram publishing / private replies when there is no
// Instagram Login connection, see social.ts getInstagramSender), fbUserId (deauthorize / data deletion) and expiry.
import { type Db, platformDb, socialAccounts, type Tx, tenants, withTenant } from '@spa/db'
import { and, desc, eq, inArray, ne } from 'drizzle-orm'
import { DomainError } from './errors'
import {
  type FacebookPageChoice,
  type FacebookTokenInfo,
  facebookLoginClient,
  MetaApiError,
  metaConfig,
} from './integrations/meta'
import { decryptSecret, encryptSecret } from './secrets'

export const FB_PENDING_ID = 'pending'
/** The card warns this long before Meta's data access (or a token) runs out. */
export const FB_WARN_MS = 14 * 86_400_000
const LIVE = ['trial', 'active', 'past_due', 'read_only'] as const

type Row = typeof socialAccounts.$inferSelect

const unseal = (sealed: string | null) => {
  if (!sealed) return null
  try {
    return decryptSecret(sealed)
  } catch {
    return null
  }
}
const iso = (s: string | undefined) => {
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

/** The newest Facebook row that matters for the card (pending choice, connected or expired). */
export async function getFacebookAccount(tx: Tx) {
  const [row] = await tx
    .select()
    .from(socialAccounts)
    .where(
      and(
        eq(socialAccounts.platform, 'facebook'),
        inArray(socialAccounts.status, ['pending_page', 'connected', 'expired']),
      ),
    )
    .orderBy(desc(socialAccounts.updatedAt))
    .limit(1)
  return row ?? null
}

export type FacebookView = {
  status: 'pending_page' | 'connected' | 'expired'
  pageId: string | null
  pageName: string | null
  igUserId: string | null
  igUsername: string | null
  igPicture: string | null
  connectedAt: Date
  /** The Page token's own expiry (null = doesn't expire). */
  tokenExpiresAt: Date | null
  /** Meta's data-access expiry (renewed whenever someone reconnects). */
  dataAccessExpiresAt: Date | null
  /** Earliest of the two when it is within FB_WARN_MS — the card asks to reconnect before then. */
  expiresSoon: Date | null
  webhooks: string | null
}

/** Token-free view for the integrations card. */
export function facebookView(row: Row | null, now = new Date()): FacebookView | null {
  if (!row) return null
  const m = row.meta ?? {}
  const dataAccess = iso(m.dataAccessExpiresAt)
  const ends = [row.tokenExpiresAt, dataAccess].filter((d): d is Date => Boolean(d))
  const first = ends.sort((a, b) => a.getTime() - b.getTime())[0] ?? null
  const expired = row.status === 'expired' || Boolean(first && first <= now)
  return {
    status: row.status === 'pending_page' ? 'pending_page' : expired ? 'expired' : 'connected',
    pageId: row.externalId === FB_PENDING_ID ? null : row.externalId,
    pageName: row.username,
    igUserId: m.igUserId ?? null,
    igUsername: m.igUsername ?? null,
    igPicture: m.igPicture ?? null,
    connectedAt: row.createdAt,
    tokenExpiresAt: row.tokenExpiresAt,
    dataAccessExpiresAt: dataAccess,
    expiresSoon: first && first.getTime() - now.getTime() < FB_WARN_MS ? first : null,
    webhooks: m.webhooks ?? null,
  }
}

/** After Facebook Login: keeps the long-lived user token (encrypted) on a pending row until a Page is chosen. */
export async function saveFacebookLogin(
  tx: Tx,
  tenantId: string,
  login: { fbUserId: string; userToken: string; expiresIn: number; scopes?: string[] },
  now = new Date(),
) {
  const values = {
    tokenEnc: encryptSecret(login.userToken),
    tokenExpiresAt: new Date(now.getTime() + login.expiresIn * 1000),
    refreshTokenEnc: null,
    username: null,
    scopes: login.scopes ?? [],
    status: 'pending_page',
    meta: { fbUserId: login.fbUserId, loginAt: now.toISOString() },
  }
  const [row] = await tx
    .insert(socialAccounts)
    .values({ tenantId, platform: 'facebook', externalId: FB_PENDING_ID, ...values })
    .onConflictDoUpdate({
      target: [socialAccounts.tenantId, socialAccounts.platform, socialAccounts.externalId],
      set: values,
    })
    .returning({ id: socialAccounts.id })
  return row!.id
}

/** The pending login's user token (to list Pages), or null when there is none / it can't be read. */
export async function pendingFacebookToken(tx: Tx) {
  const [row] = await tx
    .select()
    .from(socialAccounts)
    .where(
      and(
        eq(socialAccounts.platform, 'facebook'),
        eq(socialAccounts.externalId, FB_PENDING_ID),
        eq(socialAccounts.status, 'pending_page'),
      ),
    )
    .limit(1)
  return row ? { row, token: unseal(row.tokenEnc) } : null
}

/**
 * Saves the chosen Page (its token encrypted) and the linked Instagram account; any other Facebook row of the spa is
 * disconnected and the pending user token is deleted (only Page tokens are kept).
 */
export async function chooseFacebookPage(
  tx: Tx,
  tenantId: string,
  c: {
    page: FacebookPageChoice
    info: FacebookTokenInfo | null
    fbUserId: string | null
    webhooks: 'subscribed' | 'failed'
  },
  now = new Date(),
) {
  const { page, info } = c
  const meta: Record<string, string> = {
    pageId: page.id,
    pageName: page.name.slice(0, 200),
    tokenIssuedAt: now.toISOString(),
    webhooks: c.webhooks,
  }
  if (c.fbUserId) meta.fbUserId = c.fbUserId
  if (page.tasks.length) meta.tasks = page.tasks.join(',')
  if (page.instagram) {
    meta.igUserId = page.instagram.id
    if (page.instagram.username) meta.igUsername = page.instagram.username
    if (page.instagram.profilePictureUrl) meta.igPicture = page.instagram.profilePictureUrl
  }
  if (info?.dataAccessExpiresAt) meta.dataAccessExpiresAt = info.dataAccessExpiresAt.toISOString()
  const values = {
    username: page.name.slice(0, 200),
    tokenEnc: encryptSecret(page.accessToken),
    tokenExpiresAt: info?.expiresAt ?? null,
    refreshTokenEnc: null,
    scopes: info?.scopes ?? [],
    status: 'connected',
    meta,
  }
  await tx
    .update(socialAccounts)
    .set({ status: 'disconnected', tokenEnc: null, tokenExpiresAt: null })
    .where(
      and(
        eq(socialAccounts.platform, 'facebook'),
        ne(socialAccounts.externalId, page.id),
        ne(socialAccounts.externalId, FB_PENDING_ID),
      ),
    )
  await tx
    .delete(socialAccounts)
    .where(and(eq(socialAccounts.platform, 'facebook'), eq(socialAccounts.externalId, FB_PENDING_ID)))
  const [row] = await tx
    .insert(socialAccounts)
    .values({ tenantId, platform: 'facebook', externalId: page.id, ...values })
    .onConflictDoUpdate({
      target: [socialAccounts.tenantId, socialAccounts.platform, socialAccounts.externalId],
      set: values,
    })
    .returning({ id: socialAccounts.id })
  return row!.id
}

/** Disconnects every Facebook row of the spa (tokens wiped); returns the Page tokens to best-effort uninstall. */
export async function disconnectFacebook(tx: Tx) {
  const rows = await tx
    .select()
    .from(socialAccounts)
    .where(and(eq(socialAccounts.platform, 'facebook'), ne(socialAccounts.status, 'disconnected')))
  if (!rows.length) return []
  await tx
    .delete(socialAccounts)
    .where(and(eq(socialAccounts.platform, 'facebook'), eq(socialAccounts.externalId, FB_PENDING_ID)))
  await tx
    .update(socialAccounts)
    .set({ status: 'disconnected', tokenEnc: null, tokenExpiresAt: null, refreshTokenEnc: null })
    .where(and(eq(socialAccounts.platform, 'facebook'), ne(socialAccounts.status, 'disconnected')))
  return rows
    .filter((r) => r.externalId !== FB_PENDING_ID)
    .map((r) => ({ pageId: r.externalId, token: unseal(r.tokenEnc) }))
}

/** Tenants that have this Page connected (platform lookup for the "already in use" check). */
export async function facebookPageTenants(pageId: string, o: { platform?: Db } = {}) {
  const rows = await (o.platform ?? platformDb())
    .select({ tenantId: socialAccounts.tenantId })
    .from(socialAccounts)
    .where(
      and(
        eq(socialAccounts.platform, 'facebook'),
        eq(socialAccounts.externalId, pageId),
        eq(socialAccounts.status, 'connected'),
      ),
    )
  return [...new Set(rows.map((r) => r.tenantId))]
}

/** Lists the Pages of the pending login (DomainError when the login is gone and someone must reconnect). */
export async function pendingFacebookPages(
  tenantId: string,
  o: { app?: Db; fetch?: typeof fetch } = {},
): Promise<FacebookPageChoice[]> {
  const pending = await withTenant(tenantId, (tx) => pendingFacebookToken(tx), o.app)
  if (!pending?.token) throw new DomainError('Sign in with Facebook again to choose a Page.')
  return facebookLoginClient(o.fetch).pages(pending.token)
}

/**
 * Worker (daily, with the Instagram token refresh): checks every connected Page token with debug_token, stores
 * Meta's data-access expiry for the card's warning and marks invalid tokens expired (the card asks to reconnect).
 * Page tokens can't be renewed without someone signing in again.
 */
export async function checkFacebookPageTokens(
  o: {
    platform?: Db
    app?: Db
    fetch?: typeof fetch
    env?: Record<string, string | undefined>
    now?: Date
  } = {},
) {
  const result = { checked: 0, expired: 0, failed: 0 }
  const cfg = metaConfig(o.env)
  if (!cfg) return result
  const rows = await (o.platform ?? platformDb())
    .select({ id: socialAccounts.id, tenantId: socialAccounts.tenantId })
    .from(socialAccounts)
    .innerJoin(tenants, eq(tenants.id, socialAccounts.tenantId))
    .where(
      and(
        eq(socialAccounts.platform, 'facebook'),
        eq(socialAccounts.status, 'connected'),
        inArray(tenants.status, [...LIVE]),
      ),
    )
  const client = facebookLoginClient(o.fetch)
  for (const r of rows) {
    const row = await withTenant(
      r.tenantId,
      async (tx) => (await tx.select().from(socialAccounts).where(eq(socialAccounts.id, r.id)))[0],
      o.app,
    )
    const token = unseal(row?.tokenEnc ?? null)
    if (!row || !token) continue
    result.checked++
    let patch: Partial<typeof socialAccounts.$inferInsert> | null = null
    try {
      const info = await client.debugToken({ appId: cfg.appId, appSecret: cfg.appSecret, token })
      if (!info.isValid) patch = { status: 'expired' }
      else {
        const meta: Record<string, string> = { ...row.meta, checkedAt: (o.now ?? new Date()).toISOString() }
        if (info.dataAccessExpiresAt) meta.dataAccessExpiresAt = info.dataAccessExpiresAt.toISOString()
        patch = { meta, tokenExpiresAt: info.expiresAt }
      }
    } catch (e) {
      if (e instanceof MetaApiError && e.code === 190) patch = { status: 'expired' }
      else result.failed++
    }
    if (patch?.status === 'expired') result.expired++
    if (patch)
      await withTenant(
        r.tenantId,
        (tx) => tx.update(socialAccounts).set(patch).where(eq(socialAccounts.id, r.id)),
        o.app,
      )
  }
  return result
}
