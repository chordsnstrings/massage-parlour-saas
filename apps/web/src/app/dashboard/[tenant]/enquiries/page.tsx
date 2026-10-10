import { whatsappLink } from '@spa/core'
import { enumLabel } from '@spa/core/i18n'
import { withTenant } from '@spa/db'
import {
  listSiteEnquiries,
  SITE_ENQUIRY_STATUSES,
  type SiteEnquiryFilter,
  siteEnquiryReplyText,
} from '@spa/services'
import { Inbox, Search } from 'lucide-react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Card, Pill, Seg } from '@/components/crm'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { DataTable } from '@/components/ui/table'
import { getI18n, getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { can, requireMember } from '@/server/access'
import { EnquiryActions } from './enquiries-client'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('enquiries.title') }
}

const FILTERS = [...SITE_ENQUIRY_STATUSES, 'all'] as const
const TONE = { new: 'info', replied: 'ok', closed: 'neutral' } as const

/** F15 Inbox → Enquiries: leads from the website's enquiry form; replies are WhatsApp click-to-send. */
export default async function EnquiriesPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>
  searchParams: Promise<{ status?: string; q?: string }>
}) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'clients.view')) notFound()
  const sp = await searchParams
  const status: SiteEnquiryFilter = (FILTERS as readonly string[]).includes(sp.status ?? '')
    ? (sp.status as SiteEnquiryFilter)
    : 'new'
  const q = typeof sp.q === 'string' ? sp.q.slice(0, 80) : ''
  const seePhone = can(ctx, 'clients.phone')
  const canManage = can(ctx, 'clients.manage')
  const { t, fmt } = await getI18n()
  const list = await withTenant(ctx.tenant.id, (tx) => listSiteEnquiries(tx, { status, q }))
  const base = appPath(`/${ctx.tenant.slug}/enquiries`)
  const href = (s: string) => `${base}?status=${s}${q ? `&q=${encodeURIComponent(q)}` : ''}`
  const count = (s: (typeof FILTERS)[number]) =>
    s === 'all' ? list.counts.new + list.counts.replied + list.counts.closed : list.counts[s]

  return (
    <>
      <PageHeader title={t('enquiries.title')} description={t('enquiries.description')} />
      <PageBody>
        <Card flush>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Seg
              label={t('enquiries.filterLabel')}
              value={status}
              items={FILTERS.map((s) => ({
                value: s,
                href: href(s),
                label: (
                  <>
                    {t(`enquiries.filter.${s}`)}{' '}
                    <span className="crm-num crm-muted">{fmt.number(count(s))}</span>
                  </>
                ),
              }))}
            />
            <form action={base} className="flex min-w-0 flex-1 items-center gap-2 sm:max-w-sm">
              <input type="hidden" name="status" value={status} />
              <Input
                name="q"
                defaultValue={q}
                placeholder={t('enquiries.search')}
                aria-label={t('enquiries.search')}
              />
              <Button type="submit" variant="secondary" size="icon" aria-label={t('enquiries.searchButton')}>
                <Search />
              </Button>
            </form>
          </div>
          <div className="mt-3">
            <DataTable
              rows={list.rows}
              rowKey={(e) => e.id}
              empty={
                <EmptyState
                  icon={<Inbox className="size-5" />}
                  title={q || status !== 'new' ? t('enquiries.emptyFilter') : t('enquiries.emptyTitle')}
                  description={q || status !== 'new' ? undefined : t('enquiries.empty')}
                />
              }
              columns={[
                {
                  key: 'from',
                  header: t('enquiries.colFrom'),
                  primary: true,
                  cell: (e) => (
                    <span className="min-w-0" data-enquiry={e.id}>
                      {/* Names are as the guest typed them (never translated). */}
                      <span className="block truncate font-medium" dir="auto">
                        {e.name}
                      </span>
                      <span className="crm-muted crm-num block text-xs" dir="ltr">
                        {seePhone ? e.phone : t('enquiries.phoneHidden')}
                      </span>
                    </span>
                  ),
                },
                {
                  key: 'message',
                  header: t('enquiries.colMessage'),
                  cell: (e) => (
                    <span className="block max-w-xl">
                      <span className="line-clamp-4 whitespace-pre-line" dir="auto">
                        {e.message}
                      </span>
                      <span className="crm-muted mt-1 block text-xs">
                        {t('enquiries.fromPage', { page: e.page ? `/${e.page}` : t('enquiries.homePage') })}
                        {e.locale === 'ar' && ` · ${t('enquiries.arabic')}`}
                      </span>
                    </span>
                  ),
                },
                {
                  key: 'received',
                  header: t('enquiries.colReceived'),
                  cell: (e) => (
                    <span className="crm-num whitespace-nowrap text-sm">{fmt.dateTime(e.createdAt)}</span>
                  ),
                },
                {
                  key: 'status',
                  header: t('enquiries.colStatus'),
                  cell: (e) => (
                    <Pill tone={TONE[e.status]} dot={e.status === 'new'}>
                      {enumLabel(t, 'siteEnquiryStatus', e.status)}
                    </Pill>
                  ),
                },
                {
                  key: 'actions',
                  header: <span className="sr-only">{t('enquiries.reply')}</span>,
                  className: 'text-end',
                  cell: (e) => (
                    <EnquiryActions
                      slug={ctx.tenant.slug}
                      id={e.id}
                      name={e.name}
                      status={e.status}
                      canManage={canManage}
                      replyHref={
                        seePhone ? whatsappLink(e.phone, siteEnquiryReplyText(e, ctx.tenant.name)) : null
                      }
                    />
                  ),
                },
              ]}
            />
          </div>
          {list.total > list.rows.length && (
            <p className="crm-muted mt-3 text-sm">{t('enquiries.total', { count: list.total })}</p>
          )}
        </Card>
      </PageBody>
    </>
  )
}
