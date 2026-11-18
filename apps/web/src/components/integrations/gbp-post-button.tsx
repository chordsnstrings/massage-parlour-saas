'use client'
import { Send } from 'lucide-react'
import { useTransition } from 'react'
import { postToGoogleAction } from '@/app/api/integrations/google/actions'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { resultText, useT } from '@/i18n/client'

/** "Post to Google" for an approved AI-studio post (Google local post with a Book button). */
export function GbpPostButton({ slug, postId }: { slug: string; postId: string }) {
  const t = useT()
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
          if (r?.ok) toast.success(resultText(t, r) ?? t('common.saved'))
          else if (r) toast.error(resultText(t, r) ?? '')
        })
      }
    >
      {!pending && <Send />} {t('marketing.postToGoogle')}
    </Button>
  )
}
