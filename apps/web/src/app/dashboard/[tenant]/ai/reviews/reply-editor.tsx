'use client'
import { AlertCircle, Send, Sparkles } from 'lucide-react'
import { useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { ActionForm, FieldError, SubmitButton } from '@/components/ui/form'
import { Checkbox, Textarea } from '@/components/ui/input'
import { toast } from '@/components/ui/toast'
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
  const [drafting, start] = useTransition()
  const status = review.replyStatus
  const open = status === 'none' || status === 'draft'
  const draft = () =>
    start(async () => {
      const r = await draftReplyAction(slug, review.id)
      if (r?.ok) toast.success('Reply drafted')
      else if (r) toast.error(r.error)
    })

  return (
    <ActionForm action={saveReviewReplyAction.bind(null, slug)} className="space-y-3">
      <input type="hidden" name="reviewId" value={review.id} />
      <Textarea
        name="reply"
        defaultValue={review.replyText ?? ''}
        dir="auto"
        aria-label="Reply"
        placeholder="Write a reply, or let the AI draft one"
        className="min-h-24"
      />
      <FieldError name="reply" />
      {status === 'failed' && review.replyError && (
        <p role="alert" className="flex items-start gap-2 text-[13px] text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
          <span>Couldn't post to Google: {review.replyError}</span>
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
            {!drafting && <Sparkles />} Draft with AI
          </Button>
        )}
        <span className="ms-auto flex flex-wrap items-center justify-end gap-2">
          {mode === 'manual' ? (
            <>
              <label className="flex min-h-11 items-center gap-2 text-sm text-muted sm:min-h-9">
                <Checkbox name="posted" defaultChecked={status === 'posted'} /> Posted on Google
              </label>
              <SubmitButton size="sm" name="intent" value="manual" className={TOUCH}>
                Save
              </SubmitButton>
            </>
          ) : open ? (
            <>
              <SubmitButton size="sm" variant="secondary" name="intent" value="draft" className={TOUCH}>
                Save draft
              </SubmitButton>
              <SubmitButton size="sm" name="intent" value="approve" className={TOUCH}>
                Approve
              </SubmitButton>
            </>
          ) : status === 'posted' ? (
            <SubmitButton size="sm" variant="secondary" name="intent" value="post" className={TOUCH}>
              <Send /> Update on Google
            </SubmitButton>
          ) : (
            <>
              <SubmitButton size="sm" variant="secondary" name="intent" value="approve" className={TOUCH}>
                Save
              </SubmitButton>
              <SubmitButton size="sm" name="intent" value="post" className={TOUCH}>
                <Send /> Post reply
              </SubmitButton>
            </>
          )}
        </span>
      </div>
    </ActionForm>
  )
}
