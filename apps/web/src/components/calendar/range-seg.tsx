'use client'
import { Seg } from '@/components/crm'
import { useT } from '@/i18n/client'
import type { CalRange } from './types'

/** Day / Week / Month switch (links, so the range lives in the URL: `?range=week|month`, Day = none). */
export function RangeSeg({
  value,
  href,
  className,
}: {
  value: CalRange
  href: (range: CalRange) => string
  className?: string
}) {
  const t = useT()
  return (
    <Seg
      className={className}
      label={t('calendar.range.label')}
      value={value}
      items={(['day', 'week', 'month'] as const).map((r) => ({
        value: r,
        label: t(`calendar.range.${r}`),
        href: href(r),
      }))}
    />
  )
}
