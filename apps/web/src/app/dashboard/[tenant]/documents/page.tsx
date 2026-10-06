import { staff, withTenant } from '@spa/db'
import {
  BUSINESS_DOCUMENT_TYPES,
  DOCUMENT_STATUSES,
  type DocumentStatus,
  dubaiToday,
  expiryPhrase,
  filterDocuments,
  STAFF_DOCUMENT_TYPES,
  summarizeDocuments,
  type TrackedDocument,
  trackedDocuments,
} from '@spa/services'
import { asc, desc } from 'drizzle-orm'
import { FileBadge, Paperclip, Pencil, Plus } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { DeleteDocumentButton, OwnerFilter } from '@/components/documents/controls'
import { DocumentSheet } from '@/components/documents/document-sheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Stagger, StaggerItem } from '@/components/ui/motion'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { type Column, DataTable } from '@/components/ui/table'
import { appPath } from '@/lib/paths'
import { cn, formatDate } from '@/lib/utils'
import { can, requireMember } from '@/server/access'
import { deleteDocumentAction, saveDocumentAction } from './actions'

export const metadata: Metadata = { title: 'Documents' }

const STATUS: Record<
  DocumentStatus,
  { label: string; tile: string; tone: 'danger' | 'warning' | 'accent' | 'success' | 'neutral'; dot: string }
> = {
  expired: { label: 'Expired', tile: 'Expired', tone: 'danger', dot: 'bg-danger' },
  due30: { label: 'Due in 30 days', tile: 'Within 30 days', tone: 'warning', dot: 'bg-warning' },
  due60: { label: 'Due in 60 days', tile: 'Within 60 days', tone: 'accent', dot: 'bg-accent' },
  ok: { label: 'OK', tile: 'Up to date', tone: 'success', dot: 'bg-success' },
  none: { label: 'No expiry', tile: 'No expiry', tone: 'neutral', dot: 'bg-border' },
}
const TILES: DocumentStatus[] = ['expired', 'due30', 'due60', 'ok']

export default async function DocumentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>
  searchParams: Promise<{ status?: string; who?: string }>
}) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'staff.manage')) notFound()
  const slug = ctx.tenant.slug
  const sp = await searchParams
  const today = dubaiToday()

  const data = await withTenant(ctx.tenant.id, async (tx) => ({
    docs: await trackedDocuments(tx, today),
    people: await tx
      .select({ id: staff.id, name: staff.displayName, active: staff.active })
      .from(staff)
      .orderBy(desc(staff.active), asc(staff.sort), asc(staff.displayName)),
  }))
  const status = DOCUMENT_STATUSES.find((s) => s === sp.status)
  const who =
    sp.who === 'business' || data.people.some((p) => p.id === sp.who) ? (sp.who as string) : undefined
  const summary = summarizeDocuments(data.docs)
  const rows = filterDocuments(data.docs, { status, staffId: who })

  const href = (next: { status?: string; who?: string }) => {
    const q = new URLSearchParams()
    if (next.status) q.set('status', next.status)
    if (next.who) q.set('who', next.who)
    const qs = q.toString()
    return appPath(`/${slug}/documents${qs ? `?${qs}` : ''}`)
  }
  const ownerOptions = [
    { value: '', label: 'Everyone' },
    { value: 'business', label: 'The business' },
    ...data.people.map((p) => ({ value: p.id, label: p.active ? p.name : `${p.name} (inactive)` })),
  ]
  const staffChoices = data.people.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name }))
  const sheet = {
    slug,
    action: saveDocumentAction.bind(null, slug),
    staff: staffChoices,
    staffTypes: [...STAFF_DOCUMENT_TYPES],
    businessTypes: [...BUSINESS_DOCUMENT_TYPES],
  }

  const columns: Column<TrackedDocument>[] = [
    {
      key: 'doc',
      header: 'Document',
      primary: true,
      cell: (d) => (
        <span className="flex flex-col">
          <span className="font-medium">{d.typeLabel}</span>
          <span className="text-xs text-muted">
            {d.scope === 'staff' ? d.owner : 'Business'}
            {d.number ? ` · ${d.number}` : ''}
          </span>
        </span>
      ),
    },
    {
      key: 'expires',
      header: 'Expires',
      cell: (d) =>
        d.expiresOn ? (
          <span className="flex flex-col">
            <span className="tabular-nums">{formatDate(d.expiresOn)}</span>
            <span className={cn('text-xs', d.status === 'expired' ? 'text-danger' : 'text-muted')}>
              {expiryPhrase(d.days)}
            </span>
          </span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (d) => <Badge tone={STATUS[d.status].tone}>{STATUS[d.status].label}</Badge>,
    },
    {
      key: 'file',
      header: 'File',
      hideOnMobile: true,
      cell: (d) =>
        d.fileUrl ? (
          <a
            href={d.fileUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-8 items-center gap-1.5 text-accent underline-offset-4 hover:underline"
          >
            <Paperclip className="size-3.5" /> View
          </a>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      cell: (d) => (
        <span className="inline-flex items-center justify-end gap-1">
          <DocumentSheet
            {...sheet}
            doc={d}
            trigger={
              <Button variant="ghost" size="sm" aria-label="Edit document" className="min-h-11 md:min-h-8">
                <Pencil />
              </Button>
            }
          />
          <DeleteDocumentButton action={deleteDocumentAction.bind(null, slug, d.scope, d.id)} />
        </span>
      ),
    },
  ]

  const addButton = (
    <DocumentSheet
      {...sheet}
      defaultStaffId={who && who !== 'business' ? who : undefined}
      trigger={
        <Button>
          <Plus /> Add document
        </Button>
      }
    />
  )

  return (
    <>
      <PageHeader
        title="Documents"
        description="Visas, Emirates IDs, health cards and licences in one place — with reminders before anything expires."
        actions={addButton}
      />
      <PageBody>
        <Stagger className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 lg:gap-6">
          {TILES.map((s) => {
            const active = status === s
            return (
              <StaggerItem key={s}>
                <Link
                  href={href({ status: active ? undefined : s, who })}
                  scroll={false}
                  aria-current={active ? 'true' : undefined}
                  className={cn(
                    'group block rounded-xl border bg-surface p-4 transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:shadow-soft sm:p-5',
                    active && 'border-accent ring-4 ring-accent/10',
                  )}
                >
                  <span className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.06em] text-muted">
                    <span className={cn('size-1.5 rounded-full', STATUS[s].dot)} />
                    {STATUS[s].tile}
                  </span>
                  <span className="mt-2 block text-[26px] font-semibold tracking-tight tabular-nums">
                    {summary[s]}
                  </span>
                </Link>
              </StaggerItem>
            )
          })}
        </Stagger>

        <Card>
          <div className="flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <OwnerFilter
              value={who ?? ''}
              options={ownerOptions}
              hrefFor={Object.fromEntries(
                ownerOptions.map((o) => [o.value, href({ status, who: o.value || undefined })]),
              )}
            />
            <p className="flex items-center gap-3 text-sm text-muted">
              {status ? `${STATUS[status].label} · ` : ''}
              {rows.length} of {summary.total}
              {(status || who) && (
                <Link href={href({})} className="text-accent underline-offset-4 hover:underline">
                  Clear filters
                </Link>
              )}
            </p>
          </div>
          {data.docs.length === 0 ? (
            <EmptyState
              icon={<FileBadge className="size-5" strokeWidth={1.5} />}
              title="No documents yet"
              description="Add each therapist's visa, Emirates ID and health card, plus your trade licence and Ejari. We'll remind you before they expire."
              action={addButton}
            />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<FileBadge className="size-5" strokeWidth={1.5} />}
              title="Nothing matches these filters"
              description="Try another status or person."
            />
          ) : (
            <div className="py-2">
              <DataTable columns={columns} rows={rows} rowKey={(d) => d.id} />
            </div>
          )}
        </Card>
      </PageBody>
    </>
  )
}
