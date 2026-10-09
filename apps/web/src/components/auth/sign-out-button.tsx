'use client'
import { authClient } from '@spa/auth/client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { surfaceBaseOf } from '@/lib/paths'

/** Signs out and returns to the sign-in page of the current surface (applicant waiting page). */
export function SignOutButton({ label }: { label: string }) {
  const [pending, setPending] = useState(false)
  return (
    <Button
      variant="secondary"
      pending={pending}
      onClick={async () => {
        setPending(true)
        await authClient.signOut()
        window.location.href = `${surfaceBaseOf(window.location.pathname)}/login`
      }}
    >
      {label}
    </Button>
  )
}
