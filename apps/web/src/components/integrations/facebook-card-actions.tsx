'use client'
import { useState, useTransition } from 'react'
import {
  chooseFacebookPageAction,
  connectFacebookAction,
  disconnectFacebookAction,
} from '@/app/api/integrations/meta/facebook-actions'
import { Button } from '@/components/ui/button'
import { ActionForm, FieldError, SubmitButton } from '@/components/ui/form'
import { Sheet } from '@/components/ui/sheet'
import { toast } from '@/components/ui/toast'
import { resultText, useT } from '@/i18n/client'

/** Sends the browser to Facebook Login for Business (signed state + nonce cookie). */
export function FacebookConnectButton({ slug, label }: { slug: string; label: string }) {
  const t = useT()
  const [pending, start] = useTransition()
  return (
    <Button
      className="min-h-11"
      pending={pending}
      onClick={() =>
        start(async () => {
          const r = await connectFacebookAction(slug)
          if (r?.ok && typeof r.data?.url === 'string') window.location.assign(r.data.url)
          else if (r && !r.ok) toast.error(resultText(t, r) ?? '')
        })
      }
    >
      {label}
    </Button>
  )
}

/** The Pages of the Facebook login: the one linked to the Instagram professional account is usually the right one. */
export function ChoosePageForm({
  slug,
  pages,
}: {
  slug: string
  pages: { id: string; name: string; instagram: string | null }[]
}) {
  const t = useT()
  const first = pages.find((p) => p.instagram) ?? pages[0]
  return (
    <ActionForm action={chooseFacebookPageAction.bind(null, slug)} className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">{t('settings.integrations.fb.whichPage')}</legend>
        {pages.map((p) => (
          <label
            key={p.id}
            className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border px-3.5 py-3 transition-colors hover:bg-subtle has-[:checked]:border-accent has-[:checked]:bg-accent-soft/50"
          >
            <input
              type="radio"
              name="page"
              value={p.id}
              defaultChecked={p.id === first?.id}
              className="mt-1 size-4 accent-[var(--accent)]"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{p.name}</span>
              <span className="block truncate text-[13px] text-muted">
                {p.instagram
                  ? t('settings.integrations.fb.linkedIg', {
                      account: /^\d+$/.test(p.instagram) ? p.instagram : `@${p.instagram}`,
                    })
                  : t('settings.integrations.fb.noIg')}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      <FieldError name="page" />
      <SubmitButton className="h-11 sm:h-10">{t('settings.integrations.fb.usePage')}</SubmitButton>
    </ActionForm>
  )
}

export function FacebookDisconnectButton({ slug, name }: { slug: string; name: string | null }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={t('settings.integrations.fb.disconnectTitle')}
      description={t('settings.integrations.fb.disconnectBody', {
        page: name ?? t('settings.integrations.mcp.pageNoName'),
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
              const r = await disconnectFacebookAction(slug)
              if (r?.ok) {
                toast.success(resultText(t, r) ?? '')
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
