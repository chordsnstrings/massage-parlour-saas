'use client'
import { enumLabel } from '@spa/core/i18n'
import { CheckCircle2, MessageSquarePlus, Send, Undo2 } from 'lucide-react'
import { useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/form'
import { FormSheet } from '@/components/ui/form-sheet'
import { Select, Textarea } from '@/components/ui/input'
import { toast } from '@/components/ui/toast'
import { resultText, useI18n, useT } from '@/i18n/client'
import {
  approveSiteAction,
  requestChangeAction,
  resolveChangeAction,
  setReviewAction,
} from './studio-actions'

/** Spa → studio: "please change …", optionally about one page. */
export function RequestChangeSheet({
  slug,
  pages,
  label,
}: {
  slug: string
  pages: { id: string; title: string }[]
  label?: string
}) {
  const t = useT()
  return (
    <FormSheet
      title={t('website.requestChange')}
      description={t('website.requestChangeSub')}
      trigger={
        <Button variant="secondary">
          <MessageSquarePlus /> {label ?? t('website.requestChange')}
        </Button>
      }
      action={requestChangeAction.bind(null, slug)}
      submitLabel={t('website.sendToStudio')}
    >
      {pages.length > 0 && (
        <Field label={t('website.pageOptional')} name="pageId">
          <Select id="pageId" name="pageId" defaultValue="">
            <option value="">{t('website.wholeSite')}</option>
            {pages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label={t('website.whatChange')} name="body" hint={t('website.whatChangeHint')}>
        <Textarea
          id="body"
          name="body"
          required
          minLength={3}
          maxLength={2000}
          placeholder={t('website.whatChangePh')}
        />
      </Field>
    </FormSheet>
  )
}

export function ApproveSiteSheet({ slug }: { slug: string }) {
  const t = useT()
  return (
    <FormSheet
      title={t('website.approveTitle')}
      description={t('website.approveSub')}
      trigger={
        <Button>
          <CheckCircle2 /> {t('website.approve')}
        </Button>
      }
      action={() => approveSiteAction(slug)}
      submitLabel={t('website.approveWebsite')}
    >
      <p className="text-sm text-muted">{t('website.approveNote')}</p>
    </FormSheet>
  )
}

/** Studio: hand the site to the spa for review, or pull it back. */
export function ReviewButton({ slug, review }: { slug: string; review: boolean }) {
  const t = useT()
  const [pending, start] = useTransition()
  return (
    <Button
      variant={review ? 'primary' : 'secondary'}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await setReviewAction(slug, review)
          if (r?.ok) toast.success(resultText(t, r) ?? t('common.saved'))
          else if (r) toast.error(resultText(t, r) ?? '')
        })
      }
    >
      {review ? <Send /> : <Undo2 />} {review ? t('website.sendReview') : t('website.withdrawReview')}
    </Button>
  )
}

export function ResolveRequestSheet({ slug, id }: { slug: string; id: string }) {
  const { t } = useI18n()
  return (
    <FormSheet
      title={t('website.closeTitle')}
      description={t('website.closeSub')}
      trigger={
        <Button variant="secondary" size="sm" className="h-10">
          {t('website.resolve')}
        </Button>
      }
      action={resolveChangeAction.bind(null, slug)}
      submitLabel={t('website.closeRequest')}
    >
      <input type="hidden" name="id" value={id} />
      <Field label={t('website.outcome')} name="status">
        <Select id="status" name="status" defaultValue="done">
          <option value="done">{enumLabel(t, 'changeRequestStatus', 'done')}</option>
          <option value="declined">{enumLabel(t, 'changeRequestStatus', 'declined')}</option>
        </Select>
      </Field>
      <Field label={t('website.noteToSpa')} name="response">
        <Textarea id="response" name="response" maxLength={2000} />
      </Field>
    </FormSheet>
  )
}
