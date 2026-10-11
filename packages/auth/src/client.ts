'use client'
import { oauthProviderClient } from '@better-auth/oauth-provider/client'
import { twoFactorClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

/** Browser auth client; uses the current origin (app or admin host). */
export const authClient = createAuthClient({
  plugins: [
    // Claude connector (OAuth): on the sign-in / 2FA / consent pages it sends the signed authorization query along,
    // so a sign-in resumes the authorization (the response then carries `url` to continue to).
    oauthProviderClient(),
    twoFactorClient({
      onTwoFactorRedirect() {
        // Path routing (single host) prefixes surfaces with /app or /admin; see apps/web/src/lib/paths.ts.
        const base =
          process.env.NEXT_PUBLIC_ROUTING === 'path'
            ? window.location.pathname.startsWith('/admin')
              ? '/admin'
              : '/app'
            : ''
        window.location.href = `${base}/two-factor${window.location.search}`
      },
    }),
  ],
})
