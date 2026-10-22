import { enumLabel } from '@spa/core/i18n/labels'
import type { Translator } from '@spa/core/i18n/translate'
import { Pill, statusTone } from '@/components/crm'

/** Sale status pill (staff-facing; the receipt hides it when printed). */
export function SaleStatusPill({
  t,
  status,
  partRefunded,
}: {
  t: Translator
  status: string
  partRefunded?: boolean
}) {
  if (status === 'paid' && partRefunded) return <Pill tone="warn">{t('sales.status.partRefunded')}</Pill>
  return (
    <Pill tone={status === 'refunded' ? 'bad' : statusTone(status)}>
      {enumLabel(t, 'saleStatus', status)}
    </Pill>
  )
}
