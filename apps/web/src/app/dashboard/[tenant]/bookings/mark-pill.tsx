import { bookingMark } from '@spa/core'
import { enumLabel } from '@spa/core/i18n'
import { Pill, type Tone } from '@/components/crm'
import type { getT } from '@/i18n/server'

const TONE: Record<string, Tone> = { pending: 'warn', completed: 'ok', cancelled: 'neutral' }

/** The staff-facing mark (Pending / Completed / Cancelled); finer statuses show as a small suffix. */
export function MarkPill({ status, t }: { status: string; t: Awaited<ReturnType<typeof getT>> }) {
  const mark = bookingMark(status)
  if (!mark)
    return (
      <Pill tone="bad" dot>
        {t('bookings.mark.noShow')}
      </Pill>
    )
  const detail = mark === 'pending' && status !== 'pending' ? enumLabel(t, 'bookingStatus', status) : null
  return (
    <Pill tone={TONE[mark]} dot title={detail ?? undefined}>
      {t(`bookings.mark.${mark}`)}
      {detail && <span className="crm-muted"> · {detail}</span>}
    </Pill>
  )
}
