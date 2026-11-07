'use client'
import { CalendarCheck2, Send, Trash2 } from 'lucide-react'
import { useState, useTransition } from 'react'
import {
  removeBookButtonAction,
  setBookButtonAction,
  submitSitemapAction,
} from '@/app/api/integrations/google/actions'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { resultText, useT } from '@/i18n/client'
import type { ActionResult } from '@/lib/action'

const TOUCH = 'h-11 sm:h-10'

function useRun() {
  const t = useT()
  const [pending, start] = useTransition()
  const [busy, setBusy] = useState<string | null>(null)
  const run = (key: string, fn: () => Promise<ActionResult>) => {
    setBusy(key)
    start(async () => {
      const r = await fn()
      setBusy(null)
      if (!r) return
      if (r.ok) toast.success(resultText(t, r) ?? '')
      else toast.error(resultText(t, r) ?? '')
    })
  }
  return { pending, busy, run, t }
}

/** Add / update / remove the Google "Book" button (F17a). */
export function BookButtonActions({ slug, enabled }: { slug: string; enabled: boolean }) {
  const { pending, busy, run, t } = useRun()
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant={enabled ? 'secondary' : 'primary'}
        className={TOUCH}
        pending={busy === 'set'}
        disabled={pending}
        onClick={() => run('set', () => setBookButtonAction(slug))}
      >
        {busy !== 'set' && <CalendarCheck2 />}
        {enabled ? t('settings.integrations.google.book.update') : t('settings.integrations.google.book.add')}
      </Button>
      {enabled && (
        <Button
          variant="ghost"
          className={`${TOUCH} text-danger hover:text-danger`}
          pending={busy === 'remove'}
          disabled={pending}
          onClick={() => run('remove', () => removeBookButtonAction(slug))}
        >
          {busy !== 'remove' && <Trash2 />}
          {t('settings.integrations.google.book.remove')}
        </Button>
      )}
    </div>
  )
}

/** Submit the site's sitemap to Search Console now (F17b; publishing also queues it). */
export function SubmitSitemapButton({ slug }: { slug: string }) {
  const { busy, run, t } = useRun()
  return (
    <Button
      variant="secondary"
      className={TOUCH}
      pending={busy === 'sc'}
      onClick={() => run('sc', () => submitSitemapAction(slug))}
    >
      {busy !== 'sc' && <Send />}
      {t('settings.integrations.google.sc.submit')}
    </Button>
  )
}
