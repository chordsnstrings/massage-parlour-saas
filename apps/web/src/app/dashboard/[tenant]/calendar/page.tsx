import { CalendarOff } from 'lucide-react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { CalendarView } from '@/components/calendar/calendar-view'
import { Card } from '@/components/crm'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { getT } from '@/i18n/server'
import { can, requireMember } from '@/server/access'
import { loadCalendar } from './data'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('calendar.title') }
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

export default async function CalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'calendar.view')) notFound()
  const sp = await searchParams
  const data = await loadCalendar(ctx, {
    date: one(sp.date),
    branch: one(sp.branch),
    view: one(sp.view),
    cancelled: one(sp.cancelled),
  })
  if (!data) {
    const t = await getT()
    return (
      <>
        <PageHeader title={t('calendar.title')} />
        <PageBody>
          <Card>
            <EmptyState
              icon={<CalendarOff className="size-5" />}
              title={t('calendar.noBranchTitle')}
              description={t('calendar.noBranchText')}
            />
          </Card>
        </PageBody>
      </>
    )
  }
  return <CalendarView data={data} />
}
