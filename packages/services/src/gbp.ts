// Google Business Profile connection of one spa: its social_accounts row (platform 'gbp'), encrypted tokens with
// refresh on expiry, location choice, disconnect and local posts. Google calls happen outside tenant transactions.
import { type Db, platformDb, socialAccounts, socialPosts, type Tx, withTenant } from '@spa/db'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { DomainError, pgCode, pgConstraint } from './errors'
import { integrationEnv } from './integration-settings'
import {
  buildLocalPost,
  createGbpLocalPost,
  describeGoogleError,
  GoogleApiError,
  type GoogleTokens,
  googleConfig,
  refreshGoogleToken,
  revokeGoogleToken,
} from './integrations/google'
import { decryptSecret, encryptSecret } from './secrets'

export type GbpAccountRow = typeof socialAccounts.$inferSelect
/** `external_id` of the row until a location is chosen. */
export const GBP_PENDING_ID = 'pending'

/** Options shared by the Google-calling service functions (tests pass `db`, `platform`, `fetch`, `now`, `env`). */
export type GbpOpts = {
  tenantId: string
  db?: Db
  /** Platform role for the cross-tenant lookups (shared Google account, location already taken). */
  platform?: Db
  fetch?: typeof fetch
  now?: Date
  env?: Record<string, string | undefined>
}

/** R29: meta keys of the signed-in Google account (`sub` + email from the ID token), kept across location changes. */
const ACCOUNT_KEYS = ['googleSub', 'googleEmail'] as const
const accountMeta = (m: Record<string, string> | null | undefined): Record<string, string> =>
  Object.fromEntries(ACCOUNT_KEYS.flatMap((k) => (m?.[k] ? [[k, m[k]]] : [])))

/** Rows that hold a chosen location (0057 social_accounts_gbp_location: one spa per location). */
const LOCATION_HELD = ['connected', 'error']

/** Spas whose Google connection holds this location (platform lookup across tenants). */
export async function gbpLocationTenants(locationName: string, o: { platform?: Db } = {}) {
  const rows = await (o.platform ?? platformDb())
    .select({ tenantId: socialAccounts.tenantId })
    .from(socialAccounts)
    .where(
      and(
        eq(socialAccounts.platform, 'gbp'),
        eq(socialAccounts.externalId, locationName),
        inArray(socialAccounts.status, LOCATION_HELD),
      ),
    )
  return [...new Set(rows.map((r) => r.tenantId))]
}

/** Spas with a Google connection (any state: choosing a location, connected, needs reconnect) of this Google account. */
export async function gbpGoogleAccountTenants(sub: string, o: { platform?: Db } = {}) {
  const rows = await (o.platform ?? platformDb())
    .select({ tenantId: socialAccounts.tenantId })
    .from(socialAccounts)
    .where(and(eq(socialAccounts.platform, 'gbp'), sql`${socialAccounts.meta} ->> 'googleSub' = ${sub}`))
  return [...new Set(rows.map((r) => r.tenantId))]
}

/** Spas with a Google connection of an unknown Google account (saved before `openid email`): possibly any account. */
export async function gbpUnknownAccountTenants(o: { platform?: Db } = {}) {
  const rows = await (o.platform ?? platformDb())
    .select({ tenantId: socialAccounts.tenantId })
    .from(socialAccounts)
    .where(and(eq(socialAccounts.platform, 'gbp'), sql`${socialAccounts.meta} ->> 'googleSub' is null`))
  return [...new Set(rows.map((r) => r.tenantId))]
}

/** R29: the location is already another spa's (the check before saving, or the unique index on a race). */
export const gbpLocationInUse = () =>
  new DomainError('This Business Profile is already connected to another spa.', 'invalid', {
    key: 'errors.domain.gbpLocationInUse',
  })
const isLocationIndexViolation = (e: unknown) =>
  pgCode(e) === '23505' && pgConstraint(e) === 'social_accounts_gbp_location'

/** The stored Google sign-in can't be used any more — someone has to reconnect. */
export class GbpAuthError extends Error {
  constructor(
    message = 'Google sign-in expired or was revoked. Reconnect Google Business Profile in Settings.',
  ) {
    super(message)
    this.name = 'GbpAuthError'
  }
}

const RECONNECT = new GbpAuthError().message

export async function getGbpAccount(tx: Tx, tenantId: string): Promise<GbpAccountRow | null> {
  const [row] = await tx
    .select()
    .from(socialAccounts)
    .where(and(eq(socialAccounts.tenantId, tenantId), eq(socialAccounts.platform, 'gbp')))
    .orderBy(desc(socialAccounts.updatedAt))
    .limit(1)
  return row ?? null
}

export type GbpConnection = {
  status: 'pending_location' | 'connected' | 'error'
  hasLocation: boolean
  accountName: string | null
  locationName: string | null
  title: string | null
  address: string | null
  lastSyncAt: Date | null
  lastError: string | null
  connectedAt: Date
  /** R29: "Connected as {email}" (null for connections made before the ID token was requested). */
  googleEmail: string | null
}

/** Token-free view of the connection for the dashboard. */
export function gbpConnectionView(row: GbpAccountRow | null): GbpConnection | null {
  if (!row) return null
  const m = row.meta ?? {}
  const hasLocation = row.externalId !== GBP_PENDING_ID && Boolean(m.accountName && m.locationName)
  const status = row.status === 'error' ? 'error' : hasLocation ? 'connected' : 'pending_location'
  const synced = m.lastSyncAt ? new Date(m.lastSyncAt) : null
  return {
    status,
    hasLocation,
    accountName: m.accountName ?? null,
    locationName: m.locationName ?? null,
    title: m.title ?? null,
    address: m.address || null,
    lastSyncAt: synced && !Number.isNaN(synced.getTime()) ? synced : null,
    lastError: m.lastError || null,
    connectedAt: row.createdAt,
    googleEmail: m.googleEmail || null,
  }
}

/** `accounts/{a}/locations/{l}` — the v4 parent for reviews and local posts. */
export function gbpParent(row: GbpAccountRow) {
  const { accountName, locationName } = row.meta ?? {}
  if (row.externalId === GBP_PENDING_ID || !accountName || !locationName)
    throw new DomainError('Choose your Google Business Profile location first.')
  return `${accountName}/${locationName}`
}

async function patchMeta(tx: Tx, row: GbpAccountRow, patch: Record<string, string | null>) {
  const meta = { ...(row.meta ?? {}) }
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete meta[k]
    else meta[k] = v
  }
  await tx.update(socialAccounts).set({ meta }).where(eq(socialAccounts.id, row.id))
  return meta
}

/** Records the outcome of the last Google call on the connection (shown on the integrations card). */
export async function setGbpSyncState(
  opts: GbpOpts,
  patch: { lastSyncAt?: Date; lastError?: string | null; needsReconnect?: boolean },
) {
  await withTenant(
    opts.tenantId,
    async (tx) => {
      const row = await getGbpAccount(tx, opts.tenantId)
      if (!row) return
      await patchMeta(tx, row, {
        ...(patch.lastSyncAt ? { lastSyncAt: patch.lastSyncAt.toISOString() } : {}),
        ...(patch.lastError !== undefined ? { lastError: patch.lastError } : {}),
      })
      if (patch.needsReconnect)
        await tx.update(socialAccounts).set({ status: 'error' }).where(eq(socialAccounts.id, row.id))
    },
    opts.db,
  )
}

/**
 * Stores the tokens of a fresh OAuth grant (encrypted). One Google connection per spa: a reconnect keeps the chosen
 * location (and the old refresh token when Google doesn't send a new one). R29: the grant's Google account (ID token)
 * replaces the stored one; without an ID token it is cleared, so a disconnect never revokes on a stale guess.
 */
export async function saveGbpTokens(tx: Tx, tenantId: string, tokens: GoogleTokens, now = new Date()) {
  const refreshTokenEnc = tokens.refreshToken ? encryptSecret(tokens.refreshToken) : null
  const values = {
    tokenEnc: encryptSecret(tokens.accessToken),
    tokenExpiresAt: new Date(now.getTime() + tokens.expiresIn * 1000),
    scopes: tokens.scopes,
  }
  const account = tokens.account
    ? accountMeta({ googleSub: tokens.account.sub, googleEmail: tokens.account.email ?? '' })
    : {}
  const meta = sql`(${socialAccounts.meta} - array['lastError', 'googleSub', 'googleEmail']::text[]) || ${JSON.stringify(account)}::jsonb`
  const existing = await getGbpAccount(tx, tenantId)
  if (existing && existing.externalId !== GBP_PENDING_ID) {
    // The row (with its location) exists: a plain update by id has nothing to race on.
    await tx
      .update(socialAccounts)
      .set({ ...values, ...(refreshTokenEnc ? { refreshTokenEnc } : {}), meta, status: 'connected' })
      .where(eq(socialAccounts.id, existing.id))
    return { id: existing.id, needsLocation: false }
  }
  // R29: first connect (or again before a location was chosen) is one atomic upsert on the per-tenant key, so two
  // concurrent first callbacks end on the same row instead of one failing on social_accounts_unique.
  const [row] = await tx
    .insert(socialAccounts)
    .values({
      tenantId,
      platform: 'gbp',
      externalId: GBP_PENDING_ID,
      status: 'pending_location',
      meta: account,
      refreshTokenEnc,
      ...values,
    })
    .onConflictDoUpdate({
      target: [socialAccounts.tenantId, socialAccounts.platform, socialAccounts.externalId],
      set: {
        ...values,
        refreshTokenEnc: sql`coalesce(excluded.refresh_token_enc, ${socialAccounts.refreshTokenEnc})`,
        meta,
        status: 'pending_location',
      },
    })
    .returning({ id: socialAccounts.id })
  return { id: row!.id, needsLocation: true }
}

const ACCOUNT_RE = /^accounts\/[\w-]{1,64}$/
const LOCATION_RE = /^locations\/[\w-]{1,64}$/

/**
 * Points the connection at one location (`external_id` = location name). `meta.importedAt` is the cutoff for AI drafts
 * and autopilot: reviews written on Google before it are history, whether or not the first import succeeds. R29: one
 * spa per location — throws `gbpLocationInUse()` when another spa holds it (checked first; the unique index catches a
 * race).
 */
export async function chooseGbpLocation(
  tx: Tx,
  tenantId: string,
  loc: { accountName: string; locationName: string; title: string; address?: string },
  now = new Date(),
  o: { platform?: Db } = {},
) {
  if (!ACCOUNT_RE.test(loc.accountName) || !LOCATION_RE.test(loc.locationName))
    throw new DomainError('That location is not valid.')
  const row = await getGbpAccount(tx, tenantId)
  if (!row) throw new DomainError('Connect Google Business Profile first.', 'not_found')
  if ((await gbpLocationTenants(loc.locationName, o)).some((id) => id !== tenantId)) throw gbpLocationInUse()
  try {
    await tx
      .update(socialAccounts)
      .set({
        externalId: loc.locationName,
        username: loc.title.slice(0, 200),
        status: 'connected',
        meta: {
          ...accountMeta(row.meta),
          accountName: loc.accountName,
          locationName: loc.locationName,
          title: loc.title.slice(0, 200),
          address: (loc.address ?? '').slice(0, 300),
          importedAt: now.toISOString(),
        },
      })
      .where(eq(socialAccounts.id, row.id))
  } catch (e) {
    if (isLocationIndexViolation(e)) throw gbpLocationInUse()
    throw e
  }
}

/** Back to the location picker (tokens and the signed-in Google account kept). */
export async function resetGbpLocation(tx: Tx, tenantId: string) {
  const row = await getGbpAccount(tx, tenantId)
  if (!row) return false
  await tx
    .update(socialAccounts)
    .set({
      externalId: GBP_PENDING_ID,
      username: null,
      status: 'pending_location',
      meta: accountMeta(row.meta),
    })
    .where(eq(socialAccounts.id, row.id))
  return true
}

/**
 * Deletes the connection (reviews stay; Google-sourced ones expire after 30 days, reviews.ts) after a best-effort revoke
 * at Google. R29: Google's revoke removes the whole grant of that Google account for our project, which would also cut
 * off every other spa connected with the same account (an owner of two spas, a shared manager account). So it revokes
 * only when no other spa has a Google connection of this account (`meta.googleSub`, platform lookup) and no other spa
 * has one of an unknown account (saved before `openid email` was requested: it may be this same account). When this
 * spa's own account is unknown it never revokes, only deletes: the grant then stays in that Google account's
 * third-party access list until its owner removes it (or Google expires it unused).
 */
export async function disconnectGbp(opts: GbpOpts) {
  const row = await withTenant(opts.tenantId, (tx) => getGbpAccount(tx, opts.tenantId), opts.db)
  if (!row) return false
  const sub = row.meta?.googleSub
  const sealed = row.refreshTokenEnc ?? row.tokenEnc
  // Unknown account (no sub) here or on any other spa's row: never revoke — it may be shared, and we can't tell.
  const others = async () =>
    [...(await gbpGoogleAccountTenants(sub!, opts)), ...(await gbpUnknownAccountTenants(opts))].some(
      (id) => id !== opts.tenantId,
    )
  const revoke = Boolean(sealed && sub) && !(await others())
  if (sealed && revoke) {
    try {
      await revokeGoogleToken(decryptSecret(sealed), opts.fetch)
    } catch {
      // undecryptable token: nothing to revoke
    }
  }
  await withTenant(
    opts.tenantId,
    (tx) =>
      tx
        .delete(socialAccounts)
        .where(and(eq(socialAccounts.tenantId, opts.tenantId), eq(socialAccounts.platform, 'gbp'))),
    opts.db,
  )
  return true
}

const unseal = (sealed: string | null) => {
  if (!sealed) return null
  try {
    return decryptSecret(sealed)
  } catch {
    return null
  }
}

/**
 * A usable access token: the stored one while it's valid for another minute, otherwise refreshed with the refresh
 * token (and saved). Throws GbpAuthError — and flags the connection — when the grant is gone.
 */
export async function gbpAccessToken(opts: GbpOpts & { force?: boolean }) {
  const now = opts.now ?? new Date()
  const account = await withTenant(opts.tenantId, (tx) => getGbpAccount(tx, opts.tenantId), opts.db)
  if (!account) throw new GbpAuthError('Google Business Profile is not connected.')
  const current = unseal(account.tokenEnc)
  if (
    !opts.force &&
    current &&
    account.tokenExpiresAt &&
    account.tokenExpiresAt.getTime() > now.getTime() + 60_000
  )
    return { token: current, account }

  const refreshToken = unseal(account.refreshTokenEnc)
  if (!refreshToken) {
    await setGbpSyncState(opts, { lastError: RECONNECT, needsReconnect: true })
    throw new GbpAuthError()
  }
  const cfg = googleConfig(opts.env ?? (await integrationEnv()))
  if (!cfg)
    throw new GbpAuthError("Google isn't configured on this server yet, so the sign-in can't be renewed.")
  let tokens: GoogleTokens
  try {
    tokens = await refreshGoogleToken({ cfg, refreshToken, fetch: opts.fetch })
  } catch (e) {
    if (e instanceof GoogleApiError && e.isAuth) {
      await setGbpSyncState(opts, { lastError: RECONNECT, needsReconnect: true })
      throw new GbpAuthError()
    }
    throw e
  }
  const updated = await withTenant(
    opts.tenantId,
    async (tx) => {
      const [row] = await tx
        .update(socialAccounts)
        .set({
          tokenEnc: encryptSecret(tokens.accessToken),
          tokenExpiresAt: new Date(now.getTime() + tokens.expiresIn * 1000),
          ...(tokens.refreshToken ? { refreshTokenEnc: encryptSecret(tokens.refreshToken) } : {}),
          status: account.externalId === GBP_PENDING_ID ? 'pending_location' : 'connected',
        })
        .where(eq(socialAccounts.id, account.id))
        .returning()
      return row ?? account
    },
    opts.db,
  )
  return { token: tokens.accessToken, account: updated }
}

/** Runs `fn` with a valid token; a 401 triggers one forced refresh and retry. */
export async function withGbpToken<T>(
  opts: GbpOpts,
  fn: (token: string, account: GbpAccountRow) => Promise<T>,
): Promise<T> {
  const first = await gbpAccessToken(opts)
  try {
    return await fn(first.token, first.account)
  } catch (e) {
    if (!(e instanceof GoogleApiError && e.status === 401)) throw e
    const again = await gbpAccessToken({ ...opts, force: true })
    return fn(again.token, again.account)
  }
}

/** Staff-facing message for any failure of a Google call. */
export const gbpErrorMessage = (e: unknown) =>
  e instanceof GbpAuthError || e instanceof DomainError ? e.message : describeGoogleError(e)

/**
 * Publishes an approved AI-studio post as a Google local post ("Book" button → the spa's booking page) and records it
 * as a `gbp_post` row. Returns the error text instead of throwing for Google failures.
 */
export async function publishGbpLocalPost(
  opts: GbpOpts & { postId: string; bookingUrl: string; createdBy?: string | null },
): Promise<{ ok: true; name: string | null } | { ok: false; error: string }> {
  const now = opts.now ?? new Date()
  const post = await withTenant(
    opts.tenantId,
    async (tx) => {
      const [p] = await tx.select().from(socialPosts).where(eq(socialPosts.id, opts.postId))
      if (!p) return null
      const [dupe] = await tx
        .select({ id: socialPosts.id })
        .from(socialPosts)
        .where(
          and(
            eq(socialPosts.platform, 'gbp'),
            eq(socialPosts.status, 'published'),
            eq(socialPosts.caption, p.caption),
          ),
        )
        .limit(1)
      return { ...p, alreadyOnGoogle: Boolean(dupe) }
    },
    opts.db,
  )
  if (!post) return { ok: false, error: 'Post not found.' }
  if (post.platform === 'gbp') return { ok: false, error: 'This is already a Google post.' }
  if (post.status !== 'scheduled' && post.status !== 'published')
    return { ok: false, error: 'Approve the post before posting it to Google.' }
  if (post.alreadyOnGoogle) return { ok: false, error: 'This post is already on Google.' }
  const body = buildLocalPost({
    summary: post.caption,
    bookingUrl: opts.bookingUrl,
    imageUrl: post.media[0]?.url,
  })
  let res: Awaited<ReturnType<typeof createGbpLocalPost>>
  try {
    res = await withGbpToken(opts, (token, account) =>
      createGbpLocalPost(token, gbpParent(account), body, opts.fetch),
    )
  } catch (e) {
    return { ok: false, error: gbpErrorMessage(e) }
  }
  // Outside the Google try/catch: a failed insert must surface as a server error (with the created post's name),
  // not as "try again" — a retry would publish the post on Google twice.
  try {
    await withTenant(
      opts.tenantId,
      (tx) =>
        tx.insert(socialPosts).values({
          tenantId: opts.tenantId,
          platform: 'gbp',
          type: 'gbp_post',
          caption: post.caption,
          media: body.media ? [{ url: body.media[0]!.sourceUrl, alt: post.media[0]?.alt }] : [],
          status: 'published',
          publishedAt: now,
          externalId: res.name,
          aiRunId: post.aiRunId,
          createdBy: opts.createdBy ?? null,
        }),
      opts.db,
    )
  } catch (e) {
    throw new Error(`Google local post ${res.name ?? '(unnamed)'} was created but could not be recorded`, {
      cause: e,
    })
  }
  return { ok: true, name: res.name }
}
