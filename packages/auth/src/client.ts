'use client'
import { twoFactorClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

/** Browser auth client; uses the current origin (app or admin host). */
export const authClient = createAuthClient({
  plugins: [
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
