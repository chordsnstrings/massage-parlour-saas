'use client'
import { useState, useTransition } from 'react'
import { InstagramGlyph } from '@/components/inbox/icons'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/toast'
import { resultText, useT } from '@/i18n/client'
import { setPostStatusAction } from '../actions'
import { publishToInstagramAction } from './publish-actions'

export function PostActions({
  slug,
  postId,
  status,
  caption,
  publishBlocker,
}: {
  slug: string
  postId: string
  status: string
  caption: string
  /** Why "Publish to Instagram" can't run (null = ready). Only approved / failed posts get the button. */
  publishBlocker?: string | null
}) {
  const t = useT()
  const [pending, start] = useTransition()
  const [when, setWhen] = useState('')
  const run = (s: 'scheduled' | 'draft' | 'published', at?: string) =>
    start(async () => {
      const r = await setPostStatusAction(slug, postId, s, at)
      if (r?.ok) toast.success(resultText(t, r) ?? t('common.saved'))
      else if (r) toast.error(resultText(t, r) ?? '')
    })
  const canPublish = status === 'scheduled' || status === 'failed'
  return (
    <div className="space-y-3">
      {canPublish && (
        <PublishButton
          slug={slug}
          postId={postId}
          blocker={publishBlocker ?? null}
          retry={status === 'failed'}
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <CopyButton value={caption} label={t('marketing.copyCaption')} />
        {status !== 'published' && (
          <>
            <Input
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              className="h-8 w-auto text-[13px]"
              aria-label={t('marketing.scheduleFor')}
            />
            <Button
              size="sm"
              pending={pending}
              onClick={() => run('scheduled', when ? new Date(`${when}:00+04:00`).toISOString() : undefined)}
            >
              {t('marketing.approve')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => run('published')}>
              {t('marketing.markPosted')}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

function PublishButton({
  slug,
  postId,
  blocker,
  retry,
}: {
  slug: string
  postId: string
  blocker: string | null
  retry: boolean
}) {
  const t = useT()
  const [pending, start] = useTransition()
  return (
    <div className="space-y-1.5">
      <Button
        className="min-h-11 w-full sm:min-h-10"
        pending={pending}
        disabled={Boolean(blocker)}
        onClick={() =>
          start(async () => {
            const r = await publishToInstagramAction(slug, postId)
            if (r?.ok) toast.success(resultText(t, r) ?? t('common.saved'))
            else if (r) toast.error(resultText(t, r) ?? '')
          })
        }
      >
        {!pending && <InstagramGlyph />}
        {pending
          ? t('marketing.publishingNow')
          : retry
            ? t('marketing.retryPublish')
            : t('marketing.publishIg')}
      </Button>
      {blocker && <p className="crm-muted text-xs">{blocker}</p>}
    </div>
  )
}
