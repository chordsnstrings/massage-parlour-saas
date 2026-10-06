'use client'
import { twoFactorClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

/** Browser auth client; uses the current origin (app or admin host). */
export const authClient = createAuthClient({
  plugins: [
    twoFactorClient({
      onTwoFactorRedirect() {
        window.location.href = `/two-factor${window.location.search}`
      },
    }),
  ],
})
