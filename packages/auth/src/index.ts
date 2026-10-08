import { parseRoots, sendStaffEmail } from '@spa/core'
import { isLocale } from '@spa/core/i18n'
import { account, platformDb, session, twoFactor, user, verification } from '@spa/db'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { nextCookies } from 'better-auth/next-js'
import { twoFactor as twoFactorPlugin } from 'better-auth/plugins'

function createAuth() {
  // Every platform domain (ROOT_DOMAIN + EXTRA_ROOT_DOMAINS) signs people in on itself: the base URL follows the request
  // Host when it is one of ours and is the canonical APP_URL otherwise — so a forged Host or a spa's custom domain can
  // never shape reset links. Only the hosts that serve sign-in are allowed: the bare domain with path routing, app. and
  // admin. with host routing (dev ports included; Better Auth matches host:port exactly).
  const roots = parseRoots(process.env.ROOT_DOMAIN ?? 'localhost:3000', process.env.EXTRA_ROOT_DOMAINS)
  const pathRouting = process.env.NEXT_PUBLIC_ROUTING === 'path'
  const canonical = new URL(process.env.APP_URL ?? 'http://app.localhost:3000').origin
  return betterAuth({
    appName: 'spamanagement.ae',
    baseURL: {
      allowedHosts: pathRouting ? roots : roots.flatMap((r) => [`app.${r}`, `admin.${r}`]),
      fallback: canonical,
      protocol: canonical.startsWith('https:') ? 'https' : 'http',
    },
    secret: process.env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(platformDb(), {
      provider: 'pg',
      schema: { user, session, account, verification, twoFactor },
    }),
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
      sendResetPassword: async ({ user: u, url }) => {
        await sendStaffEmail({
          to: u.email,
          subject: 'Reset your spamanagement.ae password',
          text: `Hi ${u.name},\n\nReset your password here: ${url}\n\nIf you didn't ask for this, ignore this email.`,
        })
      },
    },
    // Behind Cloudflare / DO App Platform the client IP arrives in these headers (first match wins).
    advanced: {
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip', 'do-connecting-ip', 'x-forwarded-for'] },
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
      },
    },
    plugins: [twoFactorPlugin({ issuer: 'spamanagement.ae' }), nextCookies()],
  })
}

export type Auth = ReturnType<typeof createAuth>

let instance: Auth | undefined
/** Lazily created so builds and imports don't need runtime env. */
export function getAuth(): Auth {
  instance ??= createAuth()
  return instance
}
