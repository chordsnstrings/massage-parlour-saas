'use client'
import { Download, RefreshCw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { resultText, useI18n } from '@/i18n/client'
import { regenerateIntakePdfAction } from '../../../actions'

/** F27: download the stored signed PDF; staff with clients.manage can (re)create it. */
export function IntakePdfActions({
  slug,
  clientId,
  submissionId,
  pdfUrl,
  canGenerate,
}: {
  slug: string
  clientId: string
  submissionId: string
  pdfUrl: string | null
  canGenerate: boolean
}) {
  const { t } = useI18n()
  const router = useRouter()
  const [pending, start] = useTransition()
  const generate = () =>
    start(async () => {
      const res = await regenerateIntakePdfAction(slug, clientId, submissionId)
      if (res?.ok) {
        toast.success(resultText(t, res) ?? t('clients.intake.pdfReady'))
        router.refresh()
      } else toast.error((res && resultText(t, res)) || t('errors.generic'))
    })
  return (
    <>
      {pdfUrl && (
        <Button asChild>
          <a href={pdfUrl} download data-testid="intake-pdf-download">
            <Download /> {t('clients.intake.downloadPdf')}
          </a>
        </Button>
      )}
      {canGenerate && (
        <Button variant={pdfUrl ? 'ghost' : 'primary'} onClick={generate} disabled={pending}>
          <RefreshCw className={pending ? 'animate-spin' : undefined} />{' '}
          {pdfUrl ? t('clients.intake.regeneratePdf') : t('clients.intake.generatePdf')}
        </Button>
      )}
    </>
  )
}
