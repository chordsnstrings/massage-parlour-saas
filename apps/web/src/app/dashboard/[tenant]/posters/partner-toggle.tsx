'use client'
import { useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { resultText, useT } from '@/i18n/client'
import { setPartnerActiveAction } from './actions'

/** Pause / resume one partner link (F16). */
export function PartnerToggle({ slug, id, active }: { slug: string; id: string; active: boolean }) {
  const t = useT()
  const [pending, start] = useTransition()
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await setPartnerActiveAction(slug, id, !active)
          if (r?.ok) toast.success(resultText(t, r) ?? '')
          else if (r) toast.error(resultText(t, r) ?? '')
        })
      }
    >
      {active ? t('growth.poster.pause') : t('growth.poster.resume')}
    </Button>
  )
}
