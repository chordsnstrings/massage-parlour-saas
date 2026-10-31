'use client'
import { Merge } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/client'
import { appPath } from '@/lib/paths'
import { useConfirmAction } from '../../services/services-client'
import { mergeClientsAction } from './actions'

export function MergeButton({
  slug,
  keepId,
  mergeId,
  keepName,
  mergeName,
}: {
  slug: string
  keepId: string
  mergeId: string
  keepName: string
  mergeName: string
}) {
  const t = useT()
  const router = useRouter()
  const { pending, run } = useConfirmAction()
  return (
    <Button
      variant="danger"
      pending={pending}
      onClick={() =>
        run(
          t('clientsMerge.preview.confirm', { merge: mergeName, keep: keepName }),
          () => mergeClientsAction(slug, keepId, mergeId),
          () => router.push(appPath(`/${slug}/clients/${keepId}`)),
        )
      }
    >
      <Merge /> {t('clientsMerge.preview.submit')}
    </Button>
  )
}
