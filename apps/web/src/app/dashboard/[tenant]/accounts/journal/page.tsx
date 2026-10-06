import { withTenant } from '@spa/db'
import { Download, ScrollText } from 'lucide-react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { appPath } from '@/lib/paths'
import { formatAed, formatDate } from '@/lib/utils'
import { can, requireMember } from '@/server/access'
import { journal, SOURCE_LABELS } from '../journal-data'
import { MonthNav, monthRange } from '../month'
import { AccountsTabs } from '../tabs'

export const metadata: Metadata = { title: 'Journal' }

export default async function JournalPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>
  searchParams: Promise<{ month?: string }>
}) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'accounting.view')) notFound()
  const range = monthRange((await searchParams).month)
  const slug = ctx.tenant.slug
  const entries = await withTenant(ctx.tenant.id, (tx) => journal(tx, range.from, range.to))
  const base = appPath(`/${slug}/accounts`)

  return (
    <>
      <PageHeader
        title="Journal"
        description="Every double-entry posting. Entries are never edited — mistakes are corrected with a reversal."
        actions={
          <>
            <MonthNav base={`${base}/journal`} range={range} />
            <Button variant="secondary" asChild>
              <a href={`${base}/export?month=${range.month}`} download>
                <Download /> Export CSV
              </a>
            </Button>
          </>
        }
      />
      <AccountsTabs base={base} month={range.month} active="journal" />
      <PageBody>
        {entries.length === 0 ? (
          <Card>
            <EmptyState
              icon={<ScrollText className="size-5" strokeWidth={1.5} />}
              title={`No entries in ${range.label}`}
              description="Sales, refunds and expenses appear here as they are recorded."
            />
          </Card>
        ) : (
          <div className="space-y-3">
            {entries.map((e) => (
              <Card key={e.id} className="px-5 py-4 sm:px-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Badge tone={e.reversesId ? 'warning' : 'neutral'}>
                      {SOURCE_LABELS[e.sourceType] ?? e.sourceType}
                    </Badge>
                    <span className="truncate text-sm font-medium">{e.memo}</span>
                  </div>
                  <span className="text-[13px] text-muted tabular-nums">{formatDate(e.entryDate)}</span>
                </div>
                <div className="mt-3 divide-y text-[13px]">
                  {e.lines.map((l) => (
                    <div key={l.id} className="grid grid-cols-[3rem_1fr_6rem_6rem] gap-2 py-1.5">
                      <span className="text-muted tabular-nums">{l.code}</span>
                      <span className={Number(l.credit) ? 'ps-4 text-muted sm:ps-6' : ''}>{l.name}</span>
                      <span className="text-right tabular-nums">
                        {Number(l.debit) ? formatAed(l.debit) : ''}
                      </span>
                      <span className="text-right tabular-nums">
                        {Number(l.credit) ? formatAed(l.credit) : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        )}
      </PageBody>
    </>
  )
}
