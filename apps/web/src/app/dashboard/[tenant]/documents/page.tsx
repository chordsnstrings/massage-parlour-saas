import { staff, withTenant } from '@spa/db'
import {
  BUSINESS_DOCUMENT_TYPES,
  DOCUMENT_STATUSES,
  type DocumentStatus,
  dubaiToday,
  filterDocuments,
  STAFF_DOCUMENT_TYPES,
  summarizeDocuments,
  type TrackedDocument,
  trackedDocuments,
} from '@spa/services'
import { asc, desc } from 'drizzle-orm'
import { FileBadge, Paperclip, Pencil, Plus } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Card, Grid, Pill, Stat, type Tone } from '@/components/crm'
import { DeleteDocumentButton, OwnerFilter } from '@/components/documents/controls'
import { DocumentSheet } from '@/components/documents/document-sheet'
import { docTypeLabel, expiryText } from '@/components/documents/labels'
import { Button } from '@/components/ui/button'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { type Column, DataTable } from '@/components/ui/table'
import { getI18n, getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { cn } from '@/lib/utils'
import { can, requireMember } from '@/server/access'
import { deleteDocumentAction, saveDocumentAction } from './actions'

export async function generateMetadata() {
  return { title: (await getT())('documents.title') }
}

const TONE: Record<DocumentStatus, Tone> = {
  expired: 'bad',
  due30: 'warn',
  due60: 'acc',
  ok: 'ok',
  none: 'neutral',
}
const TILES = ['expired', 'due30', 'due60', 'ok'] as const

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
  const { t, fmt } = await getI18n()
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
    { value: '', label: t('documents.filter.everyone') },
    { value: 'business', label: t('documents.filter.business') },
    ...data.people.map((p) => ({
      value: p.id,
      label: p.active ? p.name : t('documents.filter.inactive', { name: p.name }),
    })),
  ]
  const staffChoices = data.people.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name }))
  const sheet = {
    slug,
    action: saveDocumentAction.bind(null, slug),
    staff: staffChoices,
    staffTypes: STAFF_DOCUMENT_TYPES.map((d) => ({ key: d.key, label: docTypeLabel(t, d.key, d.label) })),
    businessTypes: BUSINESS_DOCUMENT_TYPES.map((d) => ({
      key: d.key,
      label: docTypeLabel(t, d.key, d.label),
    })),
  }

  const columns: Column<TrackedDocument>[] = [
    {
      key: 'doc',
      header: t('documents.col.document'),
      primary: true,
      cell: (d) => (
        <span className="flex flex-col">
          <span className="font-medium">{docTypeLabel(t, d.type, d.typeLabel)}</span>
          <span className="crm-muted text-xs">
            {d.scope === 'staff' ? d.owner : t('documents.business')}
            {d.ownerActive ? '' : ` ${t('documents.inactive')}`}
            {d.number ? ` · ${d.number}` : ''}
          </span>
        </span>
      ),
    },
    {
      key: 'expires',
      header: t('documents.col.expires'),
      cell: (d) =>
        d.expiresOn ? (
          <span className="flex flex-col">
            <span className="crm-num">{fmt.date(`${d.expiresOn}T12:00:00Z`)}</span>
            <span className={cn('text-xs', d.status === 'expired' ? 'text-danger' : 'crm-muted')}>
              {expiryText(t, d.days)}
            </span>
          </span>
        ) : (
          <span className="crm-muted">—</span>
        ),
    },
    {
      key: 'status',
      header: t('documents.col.status'),
      cell: (d) => (
        <Pill tone={TONE[d.status]} dot>
          {t(`documents.status.${d.status}`)}
        </Pill>
      ),
    },
    {
      key: 'file',
      header: t('documents.col.file'),
      hideOnMobile: true,
      cell: (d) =>
        d.fileUrl ? (
          <a
            href={d.fileUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-8 items-center gap-1.5 text-accent underline-offset-4 hover:underline"
          >
            <Paperclip className="size-3.5" /> {t('documents.view')}
          </a>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">{t('documents.col.actions')}</span>,
      className: 'text-end',
      cell: (d) => (
        <span className="inline-flex items-center justify-end gap-1">
          <DocumentSheet
            {...sheet}
            doc={{ ...d, typeLabel: docTypeLabel(t, d.type, d.typeLabel) }}
            trigger={
              <Button
                variant="ghost"
                size="sm"
                aria-label={t('documents.edit')}
                className="min-h-11 md:min-h-8"
              >
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
      defaultStaffId={staffChoices.some((s) => s.id === who) ? who : undefined}
      trigger={
        <Button>
          <Plus /> {t('documents.add')}
        </Button>
      }
    />
  )

  return (
    <>
      <PageHeader title={t('documents.title')} description={t('documents.description')} actions={addButton} />
      <PageBody>
        <Grid cols="g4">
          {TILES.map((s) => {
            const active = status === s
            return (
              <Link
                key={s}
                href={href({ status: active ? undefined : s, who })}
                scroll={false}
                aria-current={active ? 'true' : undefined}
                className={cn(
                  'block rounded-[var(--crm-radius)] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0',
                  active && 'ring-2 ring-accent',
                )}
              >
                <Stat
                  label={
                    <Pill tone={TONE[s]} dot>
                      {t(`documents.tile.${s}`)}
                    </Pill>
                  }
                  value={fmt.number(summary[s])}
                />
              </Link>
            )
          })}
        </Grid>

        <Card flush>
          <div className="flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <OwnerFilter
              value={who ?? ''}
              options={ownerOptions}
              hrefFor={Object.fromEntries(
                ownerOptions.map((o) => [o.value, href({ status, who: o.value || undefined })]),
              )}
            />
            <p className="crm-muted flex items-center gap-3 text-sm">
              {status ? `${t(`documents.status.${status}`)} · ` : ''}
              {t('documents.filter.count', {
                shown: fmt.number(rows.length),
                total: fmt.number(summary.total),
              })}
              {(status || who) && (
                <Link href={href({})} className="text-accent underline-offset-4 hover:underline">
                  {t('documents.filter.clear')}
                </Link>
              )}
            </p>
          </div>
          {data.docs.length === 0 ? (
            <EmptyState
              icon={<FileBadge className="size-5" strokeWidth={1.5} />}
              title={t('documents.empty.title')}
              description={t('documents.empty.body')}
              action={addButton}
            />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<FileBadge className="size-5" strokeWidth={1.5} />}
              title={t('documents.noMatch.title')}
              description={t('documents.noMatch.body')}
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
