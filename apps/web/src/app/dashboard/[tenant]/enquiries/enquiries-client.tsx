'use client'
// F15 Inbox → Enquiries row actions: "Reply on WhatsApp" opens a click-to-send wa.me link (the spa sends it from its
// own WhatsApp) and marks the enquiry replied; Mark replied / Close / Reopen.
import { Check, MessageCircle, RotateCcw, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/client'
import { useConfirmAction } from '../services/services-client'
import { setEnquiryStatusAction } from './actions'

export function EnquiryActions({
  slug,
  id,
  name,
  status,
  replyHref,
  canManage,
}: {
  slug: string
  id: string
  name: string
  status: 'new' | 'replied' | 'closed'
  /** wa.me link with the start of the reply (null without phone access). */
  replyHref: string | null
  canManage: boolean
}) {
  const t = useT()
  const router = useRouter()
  const { pending, run } = useConfirmAction()
  const move = (to: 'new' | 'replied' | 'closed') =>
    run(
      null,
      () => setEnquiryStatusAction(slug, id, to),
      () => router.refresh(),
    )
  return (
    <span className="flex flex-wrap justify-end gap-2">
      {replyHref && (
        <Button size="sm" asChild>
          <a
            href={replyHref}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t('enquiries.replyLabel', { name })}
            data-enquiry-reply=""
            onClick={() => {
              if (canManage && status === 'new') move('replied')
            }}
          >
            <MessageCircle /> {t('enquiries.reply')}
          </a>
        </Button>
      )}
      {canManage && status === 'new' && (
        <Button size="sm" variant="secondary" pending={pending} onClick={() => move('replied')}>
          <Check /> {t('enquiries.markReplied')}
        </Button>
      )}
      {canManage && status !== 'closed' && (
        <Button size="sm" variant="ghost" pending={pending} onClick={() => move('closed')}>
          <X /> {t('enquiries.close')}
        </Button>
      )}
      {canManage && status === 'closed' && (
        <Button size="sm" variant="ghost" pending={pending} onClick={() => move('new')}>
          <RotateCcw /> {t('enquiries.reopen')}
        </Button>
      )}
    </span>
  )
}
