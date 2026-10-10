import { mcp } from '@better-auth/mcp'
import { CLIENT_IP_HEADER, clientIpFrom, parseRoots, sendStaffEmail } from '@spa/core'
import { isLocale } from '@spa/core/i18n'
import {
  account,
  auditLog,
  jwks,
  oauthAccessToken,
  oauthClient,
  oauthClientAssertion,
  oauthClientResource,
  oauthConsent,
  oauthRefreshToken,
  oauthResource,
  platformDb,
  session,
  siteAiEditorStatus,
  spaApplications,
  twoFactor,
  user,
  verification,
} from '@spa/db'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api'
import { nextCookies } from 'better-auth/next-js'
import { jwt, twoFactor as twoFactorPlugin } from 'better-auth/plugins'
import { and, desc, eq } from 'drizzle-orm'
import { createLocalJWKSet, jwtVerify } from 'jose'
import { isAllowedMcpRedirectUri, MCP_SCOPE, mcpOAuthPages, mcpResourceUrl } from './mcp'

export { verifyOAuthQueryParams } from '@better-auth/oauth-provider'
export * from './mcp'

/** Endpoints that store a client's redirect URIs (open DCR + the session-based client admin API). */
const CLIENT_WRITE_PATHS = new Set(['/oauth2/register', '/oauth2/create-client', '/oauth2/update-client'])
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v])

/**
 * The connector is only for Claude: a client may only register Claude's callbacks (see mcpRedirectUris), else
 * anyone could register "Claude" with their own redirect and phish an owner's consent (or use authorize as an open
 * redirector).
 */
function assertClientRedirects(path: string, body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>
  const meta = (path === '/oauth2/update-client' ? b.update : b) as Record<string, unknown> | undefined
  const redirects = list(meta?.redirect_uris)
  const all = [...redirects, ...list(meta?.post_logout_redirect_uris)]
  if ((path !== '/oauth2/update-client' && !redirects.length) || !all.every(isAllowedMcpRedirectUri))
    throw new APIError('BAD_REQUEST', {
      error: 'invalid_redirect_uri',
      error_description: 'This server only accepts the Claude connector callback as a redirect URI.',
    })
}

/** Audit row for a granted Claude connector consent (the console card lists the client; revoke is audited there). */
async function auditConsentGranted(ctx: Parameters<Parameters<typeof createAuthMiddleware>[0]>[0]) {
  const returned = ctx.context.returned as { url?: unknown } | undefined
  if ((ctx.body as { accept?: unknown } | undefined)?.accept !== true || returned instanceof APIError) return
  if (typeof returned?.url !== 'string') return
  let back: URL
  try {
    back = new URL(returned.url)
  } catch {
    return
  }
  if (!back.searchParams.has('code')) return
  const current = await getSessionFromCtx(ctx)
  if (!current) return
  const query = new URLSearchParams(String((ctx.body as { oauth_query?: unknown }).oauth_query ?? ''))
  const clientId = query.get('client_id')
  const [client] = clientId
    ? await platformDb()
        .select({ name: oauthClient.name })
        .from(oauthClient)
        .where(eq(oauthClient.clientId, clientId))
        .limit(1)
    : []
  const h = ctx.headers
  await platformDb()
    .insert(auditLog)
    .values({
      actorUserId: current.user.id,
      action: 'platform.mcp.client_authorized',
      entity: 'oauth_client',
      entityId: clientId ?? undefined,
      data: {
        clientId,
        client: client?.name ?? null,
        redirectHost: back.host,
        scopes: (query.get('scope') ?? '').split(' ').filter(Boolean),
      },
      ip: clientIpFrom(h),
    })
}

/**
 * Spa applications (PLAN §18.3): a login whose application was rejected is disabled (`user.disabled_at`). No new
 * session is created for it (password sign-in, email-verification auto sign-in); the error carries the rejection
 * reason when the owner chose to share it, for the sign-in page's "not approved" notice.
 */
async function refuseDisabled(userId: string) {
  const db = platformDb()
  const [row] = await db.select({ disabledAt: user.disabledAt }).from(user).where(eq(user.id, userId))
  if (!row?.disabledAt) return
  const [app] = await db
    .select({ reason: spaApplications.rejectionReason, share: spaApplications.shareReason })
    .from(spaApplications)
    .where(and(eq(spaApplications.userId, userId), eq(spaApplications.status, 'rejected')))
    .orderBy(desc(spaApplications.reviewedAt))
    .limit(1)
  throw new APIError('FORBIDDEN', {
    code: 'ACCOUNT_DISABLED',
    message: 'This account is closed.',
    ...(app?.share && app.reason ? { reason: app.reason } : {}),
  })
}

function createAuth() {
  // Every platform domain (ROOT_DOMAIN + EXTRA_ROOT_DOMAINS) signs people in on itself: the base URL follows the request
  // Host when it is one of ours and is the canonical APP_URL otherwise — so a forged Host or a spa's custom domain can
  // never shape reset links. Only the hosts that serve sign-in are allowed: the bare domain with path routing, app. and
  // admin. with host routing (dev ports included; Better Auth matches host:port exactly).
  const roots = parseRoots(process.env.ROOT_DOMAIN ?? 'localhost:3000', process.env.EXTRA_ROOT_DOMAINS)
  const pathRouting = process.env.NEXT_PUBLIC_ROUTING === 'path'
  const canonical = new URL(process.env.APP_URL ?? 'http://app.localhost:3000').origin
  return betterAuth({
    appName: 'spamanagement.co',
    baseURL: {
      allowedHosts: pathRouting ? roots : roots.flatMap((r) => [`app.${r}`, `admin.${r}`]),
      fallback: canonical,
      protocol: canonical.startsWith('https:') ? 'https' : 'http',
    },
    secret: process.env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(platformDb(), {
      provider: 'pg',
      schema: {
        user,
        session,
        account,
        verification,
        twoFactor,
        // OAuth 2.1 provider for the Claude MCP connector (/api/mcp) + the jwt plugin's signing keys.
        jwks,
        oauthClient,
        oauthResource,
        oauthClientResource,
        oauthRefreshToken,
        oauthAccessToken,
        oauthConsent,
        oauthClientAssertion,
      },
    }),
    // The jwt plugin's session-JWT endpoint isn't used (it only signs the MCP access tokens). Nor is the OAuth
    // provider's client admin API: Claude registers itself (/oauth2/register) and the console revokes consents.
    disabledPaths: [
      '/token',
      '/oauth2/create-client',
      '/oauth2/update-client',
      '/oauth2/client/rotate-secret',
      '/oauth2/delete-client',
      '/oauth2/get-client',
      '/oauth2/get-clients',
    ],
    user: {
      additionalFields: {
        // Spa-dashboard language (docs/PLAN.md §14.6); the top-bar toggle saves it through updateUser.
        locale: {
          type: 'string',
          required: false,
          defaultValue: 'en',
          input: true,
          validator: {
            input: {
              '~standard': {
                version: 1,
                vendor: 'spa',
                validate: (value: unknown) =>
                  isLocale(value) ? { value } : { issues: [{ message: 'Unsupported language' }] },
              },
            },
          },
        },
      },
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      // A reset is how someone takes their account back: sign the login out everywhere (getSession also reads the
      // session row, so the cookie cache can't keep a revoked one alive).
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user: u, url }) => {
        await sendStaffEmail({
          to: u.email,
          subject: 'Reset your spamanagement.co password',
          text: `Hi ${u.name},\n\nReset your password here: ${url}\n\nIf you didn't ask for this, ignore this email.`,
        })
      },
    },
    // G2: verify addresses (needed before a PLATFORM_ADMIN_EMAILS user gets super-admin). Sign-in is NOT gated on it,
    // so spa sign-ups keep working; a failed send is logged, never blocks sign-up. Google sign-ins arrive verified.
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user: u, url }) => {
        try {
          await sendStaffEmail({
            to: u.email,
            subject: 'Confirm your spamanagement.co email',
            text: `Hi ${u.name},\n\nConfirm your email address here: ${url}\n\nIf you didn't sign up, ignore this email.`,
          })
        } catch (error) {
          console.error('[auth] verification email failed', { to: u.email, error: String(error) })
        }
      },
    },
    // F26: only the header Caddy overwrites on every request (@spa/core clientIpFrom; deploy/droplet/Caddyfile).
    // IPv6 is limited per /64, the same buckets as the app's own limits (`ipRateLimitKey`).
    advanced: {
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER], ipv6Subnet: 64 },
    },
    databaseHooks: {
      session: {
        create: {
          before: async (s) => refuseDisabled(s.userId),
          // F21: "last staff sign-in" in the console's spa list (sessions are deleted on sign-out, so stamp it).
          after: async (s) => {
            try {
              await platformDb().update(user).set({ lastSignInAt: new Date() }).where(eq(user.id, s.userId))
            } catch (error) {
              console.error('last sign-in stamp failed', error)
            }
          },
        },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: true, maxAge: 300 },
    },
    rateLimit: {
      // Production only: dev/e2e servers sign up many accounts from one IP (e2e on a production build sets AUTH_RATE_LIMIT=off).
      enabled: process.env.NODE_ENV === 'production' && process.env.AUTH_RATE_LIMIT !== 'off',
      window: 60,
      max: 100,
      // Brute-force guard on credential endpoints (per client IP).
      customRules: {
        '/sign-in/email': { window: 60, max: 8 },
        '/sign-up/email': { window: 600, max: 5 },
        '/request-password-reset': { window: 600, max: 5 },
        '/forget-password': { window: 600, max: 5 },
        '/two-factor/verify-totp': { window: 60, max: 8 },
        '/two-factor/verify-backup-code': { window: 60, max: 5 },
        // Claude connector: open dynamic client registration + token endpoint.
        '/oauth2/register': { window: 600, max: 10 },
        '/oauth2/token': { window: 60, max: 30 },
      },
    },
    // Claude MCP connector: only SITE_AI_EDITOR_EMAILS super-admins with 2FA may grant a client access. Checked on
    // authorize + consent here, and again by /api/mcp on every call (consent row + allow-list, read fresh).
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (CLIENT_WRITE_PATHS.has(ctx.path)) return assertClientRedirects(ctx.path, ctx.body)
        if (ctx.path !== '/oauth2/consent' && ctx.path !== '/oauth2/authorize') return
        const current = await getSessionFromCtx(ctx)
        if (!current) return
        if ((await siteAiEditorStatus(platformDb(), current.user.id)) === 'ok') return
        // A browser starting the flow sees why on the consent page; the consent API itself refuses.
        if (ctx.path === '/oauth2/authorize')
          throw ctx.redirect(`${mcpOAuthPages().consentPage}?not_enabled=1`)
        throw new APIError('FORBIDDEN', {
          error: 'access_denied',
          message: 'Connecting Claude is not enabled for this account.',
        })
      }),
      after: createAuthMiddleware(async (ctx) => {
        // The consent row already exists: a failed audit write is logged, never turned into a failed sign-in.
        if (ctx.path === '/oauth2/consent')
          await auditConsentGranted(ctx).catch((error) =>
            console.error('[auth] consent audit failed', { error: String(error) }),
          )
      }),
    },
    plugins: [
      twoFactorPlugin({ issuer: 'spamanagement.co' }),
      jwt({ disableSettingJwtHeader: true }),
      mcp({
        ...mcpOAuthPages(),
        resource: mcpResourceUrl(),
        scopes: ['openid', 'profile', 'email', 'offline_access', MCP_SCOPE],
        // Claude registers itself (RFC 7591, public client + PKCE); registering grants nothing — a listed
        // super-admin still has to sign in with 2FA and approve it on the consent page.
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        // Only Claude's callbacks (registration is held to the same list in hooks.before): a client registered with
        // anything else can't get a code — nor an authorize error redirect — sent anywhere.
        validateRedirectUri: (uri, _registered, matched) => matched && isAllowedMcpRedirectUri(uri),
        // A signed-in caller of the client endpoints (DCR with a session) must be a listed super-admin with 2FA.
        clientPrivileges: async ({ user: u }) =>
          Boolean(u) && (await siteAiEditorStatus(platformDb(), u!.id)) === 'ok',
        accessTokenExpiresIn: 60 * 60,
      }),
      nextCookies(),
    ],
  })
}

export type Auth = ReturnType<typeof createAuth>

let instance: Auth | undefined
/** Lazily created so builds and imports don't need runtime env. */
export function getAuth(): Auth {
  instance ??= createAuth()
  return instance
}

export type McpTokenClaims = {
  userId: string
  clientId: string
  scopes: string[]
  tokenId: string
  exp: number
}

type KeySet = Parameters<typeof createLocalJWKSet>[0]
let keyCache: { at: number; keys: KeySet } | null = null
async function signingKeys(force = false) {
  if (!force && keyCache && Date.now() - keyCache.at < 5 * 60_000) return keyCache.keys
  const keys = (await getAuth().api.getJwks()) as unknown as KeySet
  keyCache = { at: Date.now(), keys }
  return keys
}

/**
 * Verifies a Claude connector access token locally (our own JWKS, no HTTP): signature, expiry and audience = the MCP
 * resource. Returns the user + OAuth client, or null. The caller still checks the allow-list and the consent row.
 */
export async function verifyMcpAccessToken(token: string | null | undefined): Promise<McpTokenClaims | null> {
  if (!token || token.length > 4096) return null
  const attempt = async (force: boolean) =>
    (await jwtVerify(token, createLocalJWKSet(await signingKeys(force)), { audience: mcpResourceUrl() }))
      .payload
  let payload: Awaited<ReturnType<typeof attempt>>
  try {
    payload = await attempt(false)
  } catch (e) {
    // A key rotated since the cache was filled: refetch once.
    if ((e as { code?: string }).code !== 'ERR_JWKS_NO_MATCHING_KEY') return null
    try {
      payload = await attempt(true)
    } catch {
      return null
    }
  }
  const clientId = (payload.azp ?? payload.client_id) as unknown
  if (typeof payload.sub !== 'string' || typeof clientId !== 'string' || typeof payload.exp !== 'number')
    return null
  return {
    userId: payload.sub,
    clientId,
    scopes: typeof payload.scope === 'string' ? payload.scope.split(' ').filter(Boolean) : [],
    tokenId: typeof payload.jti === 'string' ? payload.jti : `${payload.sub}:${payload.iat ?? payload.exp}`,
    exp: payload.exp,
  }
}
