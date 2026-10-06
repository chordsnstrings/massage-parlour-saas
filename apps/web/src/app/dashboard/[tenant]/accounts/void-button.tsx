'use client'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import type { ActionResult } from '@/lib/action'

/** Two-step void: the first tap asks for confirmation, the second posts the reversal. */
export function VoidButton({ action }: { action: () => Promise<ActionResult> }) {
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
          if (r?.ok) toast.success(r.message ?? 'Voided')
          else if (r) toast.error(r.error)
          setArmed(false)
        })
      }}
    >
      {armed ? 'Confirm void' : 'Void'}
    </Button>
  )
}
