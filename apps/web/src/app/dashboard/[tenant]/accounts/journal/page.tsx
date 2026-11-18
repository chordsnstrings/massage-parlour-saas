import { withTenant } from '@spa/db'
import { Download, ScrollText } from 'lucide-react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Card, Pill, Stack } from '@/components/crm'
import { Button } from '@/components/ui/button'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { getI18n, getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { can, requireMember } from '@/server/access'
import { journal } from '../journal-data'
import { accountName, sourceLabel } from '../labels'
import { MonthNav, monthLabel, monthRange } from '../month'
import { AccountsTabs } from '../tabs'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('accounts.journal.title') }
}

export default async function JournalPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>
  searchParams: Promise<{ month?: string }>
}) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'accounting.view')) notFound()
  const { t, fmt } = await getI18n()
  const range = monthRange((await searchParams).month)
  const slug = ctx.tenant.slug
  const entries = await withTenant(ctx.tenant.id, (tx) => journal(tx, range.from, range.to))
  const base = appPath(`/${slug}/accounts`)

  return (
    <>
      <PageHeader
        title={t('accounts.journal.title')}
        description={t('accounts.journal.description')}
        actions={
          <>
            <MonthNav base={`${base}/journal`} range={range} />
            <Button variant="secondary" asChild>
              <a href={`${base}/export?month=${range.month}`} download>
                <Download /> {t('accounts.journal.export')}
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
              title={t('accounts.journal.emptyTitle', { month: monthLabel(fmt, range.month) })}
              description={t('accounts.journal.emptyBody')}
            />
          </Card>
        ) : (
          <Stack>
            {entries.map((e) => (
              <Card key={e.id} as="article">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Pill tone={e.reversesId ? 'warn' : 'neutral'}>{sourceLabel(t, e.sourceType)}</Pill>
                    <span className="truncate text-sm font-medium">{e.memo}</span>
                  </div>
                  <span className="crm-muted crm-num text-[13px]">
                    {fmt.date(`${e.entryDate}T12:00:00Z`)}
                  </span>
                </div>
                <div className="mt-3 divide-y text-[13px]">
                  <div className="crm-muted grid grid-cols-[3rem_1fr_5.5rem_5.5rem] gap-2 pb-1 text-[11.5px]">
                    <span />
                    <span>{t('accounts.journal.account')}</span>
                    <span className="text-end">{t('accounts.journal.debit')}</span>
                    <span className="text-end">{t('accounts.journal.credit')}</span>
                  </div>
                  {e.lines.map((l) => (
                    <div key={l.id} className="grid grid-cols-[3rem_1fr_5.5rem_5.5rem] gap-2 py-1.5">
                      <span className="crm-muted crm-num">{l.code}</span>
                      <span className={Number(l.credit) ? 'crm-muted ps-4 sm:ps-6' : ''}>
                        {accountName(t, l.code, l.name)}
                      </span>
                      <span className="crm-num text-end">{Number(l.debit) ? fmt.aed(l.debit) : ''}</span>
                      <span className="crm-num text-end">{Number(l.credit) ? fmt.aed(l.credit) : ''}</span>
                    </div>
                  ))}
                </div>
              </Card>
            ))}
          </Stack>
        )}
      </PageBody>
    </>
  )
}
