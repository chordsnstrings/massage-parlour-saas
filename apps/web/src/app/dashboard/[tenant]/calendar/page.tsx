import { CalendarOff } from 'lucide-react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { CalendarView } from '@/components/calendar/calendar-view'
import { Card } from '@/components/ui/card'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { can, requireMember } from '@/server/access'
import { loadCalendar } from './data'

export const metadata: Metadata = { title: 'Calendar' }

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
    return (
      <>
        <PageHeader title="Calendar" />
        <PageBody>
          <Card>
            <EmptyState
              icon={<CalendarOff className="size-5" />}
              title="No branch to show"
              description="You haven’t been given access to a branch yet. Ask the owner to add you to one."
            />
          </Card>
        </PageBody>
      </>
    )
  }
  return <CalendarView data={data} />
}
