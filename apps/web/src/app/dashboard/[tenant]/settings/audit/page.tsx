// Owner-facing audit log (X5, PLAN §14.7 B4): read-only, tenant-scoped (withTenant + audit_log tenant policy),
// filters by person, action and Dubai date range, paginated. Permission `audit.view` (owner + manager by default).
import { withTenant } from '@spa/db'
import { auditFilterOptions, listAuditLog } from '@spa/services'
import { SearchX } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Card, Stack } from '@/components/crm'
import { Button } from '@/components/ui/button'
import { Input, Label, Select } from '@/components/ui/input'
import { EmptyState, PageHeader } from '@/components/ui/page'
import { getI18n, getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { can, requireMember } from '@/server/access'
import { SettingsTabs } from '../settings-tabs'
import { actorLabel } from './labels'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('audit.title') }
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
const DATE = /^\d{4}-\d{2}-\d{2}$/
const PAGE_SIZE = 30

export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'audit.view')) notFound()
  const { t, fmt } = await getI18n()
  const sp = await searchParams
  const date = (v: string | undefined) => (v && DATE.test(v) ? v : undefined)
  const filter = {
    actorUserId: one(sp.actor) || undefined,
    action: one(sp.action) || undefined,
    from: date(one(sp.from)),
    to: date(one(sp.to)),
    page: Math.max(Number.parseInt(one(sp.page) ?? '1', 10) || 1, 1),
    pageSize: PAGE_SIZE,
  }
  const { list, options } = await withTenant(ctx.tenant.id, async (tx) => ({
    list: await listAuditLog(tx, filter),
    options: await auditFilterOptions(tx),
  }))
  const base = appPath(`/${ctx.tenant.slug}/settings/audit`)
  const pages = Math.max(Math.ceil(list.total / list.pageSize), 1)
  const query = (page: number) => {
    const q = new URLSearchParams()
    if (filter.actorUserId) q.set('actor', filter.actorUserId)
    if (filter.action) q.set('action', filter.action)
    if (filter.from) q.set('from', filter.from)
    if (filter.to) q.set('to', filter.to)
    if (page > 1) q.set('page', String(page))
    const s = q.toString()
    return s ? `${base}?${s}` : base
  }
  const col = {
    when: t('audit.col.when'),
    actor: t('audit.col.actor'),
    action: t('audit.col.action'),
    record: t('audit.col.record'),
    ip: t('audit.col.ip'),
  }

  return (
    <>
      <PageHeader title={t('audit.title')} description={t('audit.description')} />
      <SettingsTabs ctx={ctx} value="audit" />
      <Stack>
        <Card>
          <form method="get" action={base} aria-label={t('audit.filter.label')}>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="space-y-1.5">
                <Label htmlFor="actor">{t('audit.filter.actor')}</Label>
                <Select id="actor" name="actor" defaultValue={filter.actorUserId ?? ''}>
                  <option value="">{t('audit.filter.everyone')}</option>
                  {options.actors.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="action">{t('audit.filter.action')}</Label>
                <Select id="action" name="action" defaultValue={filter.action ?? ''}>
                  <option value="">{t('audit.filter.allActions')}</option>
                  {options.actions.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="from">{t('audit.filter.from')}</Label>
                <Input id="from" name="from" type="date" defaultValue={filter.from ?? ''} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="to">{t('audit.filter.to')}</Label>
                <Input id="to" name="to" type="date" defaultValue={filter.to ?? ''} />
              </div>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="ghost" asChild>
                <Link href={base}>{t('audit.filter.reset')}</Link>
              </Button>
              <Button type="submit">{t('audit.filter.apply')}</Button>
            </div>
          </form>
        </Card>

        <Card flush title={t('audit.title')} sub={t('audit.count', { count: list.total })}>
          {list.entries.length === 0 ? (
            <EmptyState
              icon={<SearchX className="size-5" />}
              title={t('audit.empty.title')}
              description={t('audit.empty.body')}
            />
          ) : (
            <div className="crm-tbl-wrap px-[var(--crm-pad-card)] pb-2">
              <table className="crm-tbl" data-stack="true">
                <thead>
                  <tr>
                    <th>{col.when}</th>
                    <th>{col.actor}</th>
                    <th>{col.action}</th>
                    <th>{col.record}</th>
                    <th>{col.ip}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.entries.map((e) => (
                    <tr key={e.id}>
                      <td data-label={col.when} className="whitespace-nowrap">
                        {fmt.dateTime(e.at)}
                      </td>
                      <td data-label={col.actor}>{actorLabel(t, e)}</td>
                      <td data-label={col.action}>
                        <code className="text-[12.5px]">{e.action}</code>
                      </td>
                      <td data-label={col.record} className="crm-muted">
                        {e.entity ? `${e.entity}${e.entityId ? ` · ${e.entityId.slice(0, 8)}` : ''}` : '—'}
                      </td>
                      <td data-label={col.ip} className="crm-muted">
                        {e.ip ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {list.total > list.pageSize && (
            <nav
              className="flex items-center justify-between gap-2 px-[var(--crm-pad-card)] pb-[var(--crm-pad-card)]"
              aria-label={t('audit.pager.label')}
            >
              <span className="crm-muted text-[length:var(--crm-fs-sub)]">
                {t('audit.pager.page', { page: list.page, pages })}
              </span>
              <span className="flex gap-2">
                {list.page > 1 && (
                  <Button variant="secondary" size="sm" asChild>
                    <Link href={query(list.page - 1)}>{t('audit.pager.prev')}</Link>
                  </Button>
                )}
                {list.page < pages && (
                  <Button variant="secondary" size="sm" asChild>
                    <Link href={query(list.page + 1)}>{t('audit.pager.next')}</Link>
                  </Button>
                )}
              </span>
            </nav>
          )}
        </Card>
      </Stack>
    </>
  )
}
