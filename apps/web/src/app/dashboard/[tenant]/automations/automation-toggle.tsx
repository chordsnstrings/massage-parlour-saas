'use client'
import { useState, useTransition } from 'react'
import { Toggle } from '@/components/crm'
import { toast } from '@/components/ui/toast'
import { resultText, useT } from '@/i18n/client'
import { setAutomationAction } from './actions'

/** One automation switch: flips optimistically, reverts if the server refuses. */
export function AutomationToggle({
  slug,
  id,
  label,
  on,
}: {
  slug: string
  id: string
  label: string
  on: boolean
}) {
  const t = useT()
  const [checked, setChecked] = useState(on)
  const [pending, start] = useTransition()
  return (
    <Toggle
      label={label}
      checked={checked}
      disabled={pending}
      onChange={(next) => {
        setChecked(next)
        start(async () => {
          const r = await setAutomationAction(slug, id, next)
          if (!r) return
          if (r.ok) toast.success(resultText(t, r) ?? '')
          else {
            setChecked(!next)
            toast.error(resultText(t, r) ?? '')
          }
        })
      }}
    />
  )
}
