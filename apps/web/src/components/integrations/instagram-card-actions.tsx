'use client'
import { useState, useTransition } from 'react'
import { connectInstagramAction, disconnectInstagramAction } from '@/app/api/integrations/meta/actions'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/sheet'
import { toast } from '@/components/ui/toast'
import { resultText, useT } from '@/i18n/client'
import { InstagramGlyph } from '../inbox/icons'

export function InstagramConnectButton({
  slug,
  label,
  variant = 'primary',
}: {
  slug: string
  label?: string
  variant?: 'primary' | 'secondary'
}) {
  const t = useT()
  const [pending, start] = useTransition()
  return (
    <Button
      variant={variant}
      className="min-h-11"
      pending={pending}
      onClick={() =>
        start(async () => {
          const r = await connectInstagramAction(slug)
          if (r?.ok && typeof r.data?.url === 'string') window.location.assign(r.data.url)
          else if (r && !r.ok) toast.error(resultText(t, r) ?? '')
        })
      }
    >
      {!pending && <InstagramGlyph />}
      {label ?? t('settings.integrations.ig.connect')}
    </Button>
  )
}

export function InstagramDisconnectButton({ slug, username }: { slug: string; username: string | null }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={t('settings.integrations.ig.disconnectTitle')}
      description={t('settings.integrations.ig.disconnectBody', {
        account: username ? `@${username}` : t('settings.integrations.ig.theAccount'),
      })}
      trigger={
        <Button variant="ghost" className="min-h-11 text-danger hover:text-danger">
          {t('settings.integrations.disconnect')}
        </Button>
      }
    >
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" className="min-h-11" onClick={() => setOpen(false)}>
          {t('settings.integrations.ig.keep')}
        </Button>
        <Button
          variant="danger"
          className="min-h-11"
          pending={pending}
          onClick={() =>
            start(async () => {
              const r = await disconnectInstagramAction(slug)
              if (r?.ok) {
                toast.success(resultText(t, r) ?? t('settings.integrations.ig.disconnected'))
                setOpen(false)
              } else if (r) toast.error(resultText(t, r) ?? '')
            })
          }
        >
          {t('settings.integrations.disconnect')}
        </Button>
      </div>
    </Sheet>
  )
}
