'use client'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { resultText, useT } from '@/i18n/client'
import type { ActionResult } from '@/lib/action'

/** Two-step void: the first tap asks for confirmation, the second posts the reversal. */
export function VoidButton({ action }: { action: () => Promise<ActionResult> }) {
  const t = useT()
  const [armed, setArmed] = useState(false)
  const [pending, start] = useTransition()
  return (
    <Button
      variant={armed ? 'danger' : 'ghost'}
      size="sm"
      pending={pending}
      onBlur={() => setArmed(false)}
      onClick={() => {
        if (!armed) return setArmed(true)
        start(async () => {
          const r = await action()
          if (r?.ok) toast.success(resultText(t, r) ?? '')
          else if (r) toast.error(resultText(t, r) ?? '')
          setArmed(false)
        })
      }}
    >
      {armed ? t('accounts.void.confirm') : t('accounts.void.void')}
    </Button>
  )
}
