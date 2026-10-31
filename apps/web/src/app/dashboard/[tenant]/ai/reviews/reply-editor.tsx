'use client'
import { AlertCircle, Send, Sparkles } from 'lucide-react'
import { useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { ActionForm, FieldError, SubmitButton } from '@/components/ui/form'
import { Checkbox, Textarea } from '@/components/ui/input'
import { toast } from '@/components/ui/toast'
import { resultText, useT } from '@/i18n/client'
import { draftReplyAction } from '../actions'
import { saveReviewReplyAction } from './actions'

const TOUCH = 'h-11 sm:h-9'

type Props = {
  slug: string
  review: { id: string; replyText: string | null; replyStatus: string; replyError: string | null }
  /** `google`: approve + post through the API · `manual`: copy into Google and tick "Posted". */
  mode: 'google' | 'manual'
}

export function ReplyEditor({ slug, review, mode }: Props) {
  const t = useT()
  const [drafting, start] = useTransition()
  const status = review.replyStatus
  const open = status === 'none' || status === 'draft'
  const draft = () =>
    start(async () => {
      const r = await draftReplyAction(slug, review.id)
      if (r?.ok) toast.success(resultText(t, r) ?? t('ai.replyDrafted'))
      else if (r) toast.error(resultText(t, r) ?? '')
    })

  return (
    <ActionForm action={saveReviewReplyAction.bind(null, slug)} className="space-y-3">
      <input type="hidden" name="reviewId" value={review.id} />
      <Textarea
        name="reply"
        defaultValue={review.replyText ?? ''}
        dir="auto"
        aria-label={t('reviews.reply')}
        placeholder={t('reviews.replyPh')}
        className="min-h-24"
      />
      <FieldError name="reply" />
      {status === 'failed' && review.replyError && (
        <p role="alert" className="flex items-start gap-2 text-[13px] text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
          <span>{t('reviews.postFailed', { error: review.replyError })}</span>
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {open && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className={TOUCH}
            pending={drafting}
            onClick={draft}
          >
            {!drafting && <Sparkles />} {t('reviews.draftAi')}
          </Button>
        )}
        <span className="ms-auto flex flex-wrap items-center justify-end gap-2">
          {mode === 'manual' ? (
            <>
              <label className="flex min-h-11 items-center gap-2 text-sm text-muted sm:min-h-9">
                <Checkbox name="posted" defaultChecked={status === 'posted'} /> {t('reviews.postedOnGoogle')}
              </label>
              <SubmitButton size="sm" name="intent" value="manual" className={TOUCH}>
                {t('reviews.save')}
              </SubmitButton>
            </>
          ) : open ? (
            <>
              <SubmitButton size="sm" variant="secondary" name="intent" value="draft" className={TOUCH}>
                {t('reviews.saveDraft')}
              </SubmitButton>
              <SubmitButton size="sm" name="intent" value="approve" className={TOUCH}>
                {t('reviews.approve')}
              </SubmitButton>
            </>
          ) : status === 'posted' ? (
            <SubmitButton size="sm" variant="secondary" name="intent" value="post" className={TOUCH}>
              <Send /> {t('reviews.updateOnGoogle')}
            </SubmitButton>
          ) : (
            <>
              <SubmitButton size="sm" variant="secondary" name="intent" value="approve" className={TOUCH}>
                {t('reviews.save')}
              </SubmitButton>
              <SubmitButton size="sm" name="intent" value="post" className={TOUCH}>
                <Send /> {t('reviews.postReply')}
              </SubmitButton>
            </>
          )}
        </span>
      </div>
    </ActionForm>
  )
}
