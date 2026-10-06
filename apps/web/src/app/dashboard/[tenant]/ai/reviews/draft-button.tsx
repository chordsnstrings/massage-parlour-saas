'use client'
import { Sparkles } from 'lucide-react'
import { useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { draftReplyAction } from '../actions'

export function DraftReplyButton({ slug, reviewId }: { slug: string; reviewId: string }) {
  const [pending, start] = useTransition()
  return (
    <Button
      size="sm"
      variant="secondary"
      pending={pending}
      onClick={() =>
        start(async () => {
          const r = await draftReplyAction(slug, reviewId)
          if (r?.ok) toast.success('Reply drafted')
          else if (r) toast.error(r.error)
        })
      }
    >
      {!pending && <Sparkles />} Draft reply
    </Button>
  )
}
