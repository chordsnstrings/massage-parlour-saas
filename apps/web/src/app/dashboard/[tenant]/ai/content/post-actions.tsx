'use client'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/toast'
import { setPostStatusAction } from '../actions'

export function PostActions({
  slug,
  postId,
  status,
  caption,
}: {
  slug: string
  postId: string
  status: string
  caption: string
}) {
  const [pending, start] = useTransition()
  const [when, setWhen] = useState('')
  const run = (s: 'scheduled' | 'draft' | 'published', at?: string) =>
    start(async () => {
      const r = await setPostStatusAction(slug, postId, s, at)
      if (r?.ok) toast.success(r.message ?? 'Saved')
      else if (r) toast.error(r.error)
    })
  return (
    <div className="flex flex-wrap items-center gap-2">
      <CopyButton value={caption} label="Copy caption" />
      {status !== 'published' && (
        <>
          <Input
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            className="h-8 w-auto text-[13px]"
            aria-label="Schedule for"
          />
          <Button
            size="sm"
            pending={pending}
            onClick={() => run('scheduled', when ? new Date(`${when}:00+04:00`).toISOString() : undefined)}
          >
            Approve
          </Button>
          <Button size="sm" variant="ghost" onClick={() => run('published')}>
            Mark posted
          </Button>
        </>
      )}
    </div>
  )
}
