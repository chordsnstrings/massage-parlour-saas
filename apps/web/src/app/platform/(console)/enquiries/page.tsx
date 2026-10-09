import { platformDb } from '@spa/db'
import { type EnquiryFilter, enquiryCounts, listEnquiries } from '@spa/services'
import { Mail, Search } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { DataTable } from '@/components/ui/table'
import { adminPath } from '@/lib/paths'
import { cn, formatDateTime } from '@/lib/utils'
import { requirePlatformAdmin } from '@/server/access'
import { ENQUIRY_STATUS } from './status'

export const metadata: Metadata = { title: 'Enquiries' }

const FILTERS = [
  { key: 'new', label: 'New' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'closed', label: 'Closed' },
  { key: 'all', label: 'All' },
] as const

/** Messages from the marketing Contact form (PLAN §18.4), newest first. */
export default async function EnquiriesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>
}) {
  await requirePlatformAdmin()
  const sp = await searchParams
  const filter: EnquiryFilter = FILTERS.some((f) => f.key === sp.status)
    ? (sp.status as EnquiryFilter)
    : 'all'
  const q = sp.q?.trim().slice(0, 100) ?? ''
  const db = platformDb()
  const [rows, counts] = await Promise.all([listEnquiries(db, { status: filter, q }), enquiryCounts(db)])
  const href = (status: string) =>
    `${adminPath('/enquiries')}?status=${status}${q ? `&q=${encodeURIComponent(q)}` : ''}`
  return (
    <>
      <PageHeader
        title="Enquiries"
        description="Messages from the Contact page. Reply by phone, WhatsApp or email, then mark them contacted or closed."
      />
      <PageBody>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <nav aria-label="Filter by status" className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <Link
                key={f.key}
                href={href(f.key)}
                aria-current={f.key === filter ? 'page' : undefined}
                className={cn(
                  'rounded-full border px-3 py-1 text-sm transition-colors',
                  f.key === filter ? 'border-fg bg-fg text-surface' : 'text-muted hover:text-fg',
                )}
              >
                {f.label} <span className="tabular opacity-70">{counts[f.key]}</span>
              </Link>
            ))}
          </nav>
          <form className="relative w-full max-w-sm">
            <input type="hidden" name="status" value={filter} />
            <Search
              className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted"
              strokeWidth={1.5}
            />
            <Input
              name="q"
              type="search"
              defaultValue={q}
              placeholder="Search name, email or spa"
              aria-label="Search enquiries"
              className="ps-9"
            />
          </form>
        </div>
        <Card>
          <DataTable
            rows={rows}
            rowKey={(r) => r.id}
            empty={
              <EmptyState
                icon={<Mail className="size-5" />}
                title={
                  q
                    ? 'No enquiries match'
                    : filter === 'all'
                      ? 'No enquiries yet'
                      : `No ${ENQUIRY_STATUS[filter].label.toLowerCase()} enquiries`
                }
              />
            }
            columns={[
              {
                key: 'who',
                header: 'From',
                primary: true,
                cell: (r) => (
                  <Link href={adminPath(`/enquiries/${r.id}`)} className="group">
                    <span className="block font-medium group-hover:text-accent">{r.name}</span>
                    <span className="text-sm text-muted">{r.spaName}</span>
                  </Link>
                ),
              },
              {
                key: 'contact',
                header: 'Contact',
                cell: (r) => (
                  <span>
                    <span className="block break-all">{r.email}</span>
                    <span className="text-sm text-muted">{r.phone}</span>
                  </span>
                ),
              },
              {
                key: 'message',
                header: 'Message',
                hideOnMobile: true,
                cell: (r) => <span className="line-clamp-2 max-w-md text-muted">{r.message}</span>,
              },
              { key: 'sent', header: 'Sent', cell: (r) => formatDateTime(r.createdAt) },
              {
                key: 'status',
                header: 'Status',
                className: 'text-end',
                cell: (r) => (
                  <Badge tone={ENQUIRY_STATUS[r.status].tone}>{ENQUIRY_STATUS[r.status].label}</Badge>
                ),
              },
            ]}
          />
        </Card>
      </PageBody>
    </>
  )
}
