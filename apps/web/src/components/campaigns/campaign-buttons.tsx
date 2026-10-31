'use client'
import { Archive, ArchiveRestore, Copy, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import {
  archiveCampaignAction,
  deleteSegmentAction,
  duplicateCampaignAction,
} from '@/app/dashboard/[tenant]/campaigns/actions'
import { ActionForm, SubmitButton } from '@/components/ui/form'
import { useT } from '@/i18n/client'
import type { ActionResult } from '@/lib/action'

type Action = (prev: ActionResult, fd: FormData) => Promise<ActionResult>

/** A one-button server-action form; follows `data.href` when the action returns one. */
function ActionButton({
  action,
  children,
  variant = 'secondary',
  confirm,
}: {
  action: Action
  children: React.ReactNode
  variant?: 'secondary' | 'ghost' | 'danger'
  confirm?: string
}) {
  const router = useRouter()
  return (
    <ActionForm
      action={async (prev, fd) => {
        if (confirm && !window.confirm(confirm)) return null
        return action(prev, fd)
      }}
      onSuccess={(r) => {
        const href = r.data?.href
        if (typeof href === 'string') router.push(href)
        else router.refresh()
      }}
    >
      <SubmitButton variant={variant} size="sm">
        {children}
      </SubmitButton>
    </ActionForm>
  )
}

export function DuplicateButton({ slug, id }: { slug: string; id: string }) {
  const t = useT()
  return (
    <ActionButton action={duplicateCampaignAction.bind(null, slug, id)}>
      <Copy /> {t('campaigns.buttons.duplicate')}
    </ActionButton>
  )
}

export function ArchiveButton({
  slug,
  id,
  archived,
  pending,
}: {
  slug: string
  id: string
  archived: boolean
  pending: number
}) {
  const t = useT()
  return archived ? (
    <ActionButton action={archiveCampaignAction.bind(null, slug, id, false)} variant="ghost">
      <ArchiveRestore /> {t('campaigns.buttons.restore')}
    </ActionButton>
  ) : (
    <ActionButton
      action={archiveCampaignAction.bind(null, slug, id, true)}
      variant="ghost"
      confirm={pending > 0 ? t('campaigns.buttons.archiveConfirm', { count: pending }) : undefined}
    >
      <Archive /> {t('campaigns.buttons.archive')}
    </ActionButton>
  )
}

export function DeleteSegmentButton({ slug, id }: { slug: string; id: string }) {
  const t = useT()
  return (
    <ActionButton
      action={deleteSegmentAction.bind(null, slug, id)}
      variant="ghost"
      confirm={t('campaigns.buttons.deleteSegmentConfirm')}
    >
      <Trash2 /> {t('common.delete')}
    </ActionButton>
  )
}
