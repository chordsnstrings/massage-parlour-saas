'use client'
import { Send } from 'lucide-react'
import { useTransition } from 'react'
import { postToGoogleAction } from '@/app/api/integrations/google/actions'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'

/** "Post to Google" for an approved AI-studio post (Google local post with a Book button). */
export function GbpPostButton({ slug, postId }: { slug: string; postId: string }) {
  const [pending, start] = useTransition()
  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      className="h-11 sm:h-8"
      pending={pending}
      onClick={() =>
        start(async () => {
          const r = await postToGoogleAction(slug, postId)
          if (r?.ok) toast.success(r.message ?? 'Posted to Google')
          else if (r) toast.error(r.error)
        })
      }
    >
      {!pending && <Send />} Post to Google
    </Button>
  )
}
