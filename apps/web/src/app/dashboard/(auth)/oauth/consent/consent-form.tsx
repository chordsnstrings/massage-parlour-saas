'use client'
import { authClient } from '@spa/auth/client'
import { useState } from 'react'
import { authErrorText, useAuthT } from '@/components/auth/errors'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'

/** Allow / Deny: posts to Better Auth's /oauth2/consent (the client plugin adds the signed query) and follows on. */
export function ConsentForm() {
  const t = useAuthT()
  const [pending, setPending] = useState<'allow' | 'deny' | null>(null)
  const answer = async (accept: boolean) => {
    setPending(accept ? 'allow' : 'deny')
    try {
      const res = await authClient.$fetch<{ redirect?: boolean; url?: string }>('/oauth2/consent', {
        method: 'POST',
        body: { accept },
      })
      if (res.error || !res.data?.url) {
        toast.error(authErrorText(t, res.error ?? {}))
        return
      }
      window.location.href = res.data.url
    } finally {
      setPending(null)
    }
  }
  return (
    <div className="flex gap-3">
      <Button
        variant="secondary"
        className="flex-1"
        onClick={() => answer(false)}
        pending={pending === 'deny'}
      >
        {t('auth.oauth.deny')}
      </Button>
      <Button className="flex-1" onClick={() => answer(true)} pending={pending === 'allow'}>
        {t('auth.oauth.allow')}
      </Button>
    </div>
  )
}
