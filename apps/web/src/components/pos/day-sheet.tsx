'use client'
import { RefreshCw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { createDaySheetPdfAction } from '@/app/dashboard/[tenant]/sales/actions'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { resultText, useI18n } from '@/i18n/client'

/** R32: "Create PDF" for a closed day whose stored day sheet is missing (the render at close failed). */
export function CreateDaySheetPdfButton({
  slug,
  branchId,
  date,
}: {
  slug: string
  branchId: string
  date: string
}) {
  const { t } = useI18n()
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <Button
      variant="secondary"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await createDaySheetPdfAction(slug, branchId, date)
          if (res?.ok) {
            toast.success(resultText(t, res) ?? t('sales.toast.pdfCreated'))
            router.refresh()
          } else toast.error((res && resultText(t, res)) || t('errors.generic'))
        })
      }
    >
      <RefreshCw className={pending ? 'animate-spin' : undefined} aria-hidden /> {t('sales.close.createPdf')}
    </Button>
  )
}
