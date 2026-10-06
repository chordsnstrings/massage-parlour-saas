import { sendStaffEmail } from '@spa/core'
import { account, platformDb, session, twoFactor, user, verification } from '@spa/db'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { nextCookies } from 'better-auth/next-js'
import { twoFactor as twoFactorPlugin } from 'better-auth/plugins'

function createAuth() {
  const appUrl = process.env.APP_URL ?? 'http://app.localhost:3000'
  return betterAuth({
    appName: 'spamanagement.ae',
    baseURL: appUrl,
    secret: process.env.BETTER_AUTH_SECRET,
    trustedOrigins: [appUrl, process.env.ADMIN_URL ?? 'http://admin.localhost:3000'],
    database: drizzleAdapter(platformDb(), {
      provider: 'pg',
      schema: { user, session, account, verification, twoFactor },
    }),
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
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: true, maxAge: 300 },
    },
    rateLimit: { enabled: true, window: 60, max: 100 },
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
