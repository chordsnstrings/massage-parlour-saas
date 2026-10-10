import type { BillingRules } from '@spa/core'
import { platformDb } from '@spa/db'
import {
  billingRules,
  billingStageSummary,
  isTenantSort,
  TENANT_SORTS,
  type TenantSort,
  type TenantUsageRow,
  tenantUsageList,
} from '@spa/services'
import { ArrowDown, ArrowDownUp, ArrowUp, Building2, ChevronRight, Search } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Badge, statusTone } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input, Select } from '@/components/ui/input'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { adminPath } from '@/lib/paths'
import { cn, formatDate } from '@/lib/utils'
import './tenants.css'

export const metadata: Metadata = { title: 'Spas' }

// F21 spa list, fitted to one screen (owner 2026-10-10: "all data in one page without go left/right"): merged
// columns Spa | Activity | Usage | AI this month | Plan, each listing its server sort keys; layout modes in tenants.css.

/** "3 h ago" / "5 d ago" / a date — the console list only needs a feel for recency. */
function ago(d: Date | null, now: number) {
  if (!d) return '—'
  const mins = Math.max(0, Math.round((now - d.getTime()) / 60_000))
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours} h ago`
  const days = Math.round(hours / 24)
  return days < 60 ? `${days} d ago` : formatDate(d)
}

function bytes(n: number) {
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

const STAGE_LABEL = { overdue: 'overdue', grace: 'grace', read_only: 'read-only (billing)' } as const
const DAY = 86_400_000
/** Dormancy cue (amber): no staff sign-in for 14+ days / no booking for 30+ days. */
const STALE = { signin: 14 * DAY, booking: 30 * DAY }

const SORT_LABEL: Record<TenantSort, string> = {
  name: 'Name',
  status: 'Status',
  plan: 'Plan',
  signin: 'Last staff sign-in',
  booking: 'Last booking',
  bookings30: 'Bookings 30\u00a0d',
  members: 'Team',
  storage: 'Storage',
  ai: 'AI this month',
  joined: 'Joined',
}
type SortKind = 'text' | 'date' | 'number'
const SORT_KIND: Record<TenantSort, SortKind> = {
  name: 'text',
  status: 'text',
  plan: 'text',
  signin: 'date',
  booking: 'date',
  joined: 'date',
  bookings30: 'number',
  members: 'number',
  storage: 'number',
  ai: 'number',
}
const DIR_LABEL: Record<SortKind, Record<'asc' | 'desc', string>> = {
  text: { asc: 'A → Z', desc: 'Z → A' },
  date: { asc: 'Oldest first', desc: 'Newest first' },
  number: { asc: 'Lowest first', desc: 'Highest first' },
}
const dirLabel = (key: TenantSort, d: 'asc' | 'desc') => DIR_LABEL[SORT_KIND[key]][d]
/** Screen-reader wording (no arrows). */
const dirWords = (key: TenantSort, d: 'asc' | 'desc') => dirLabel(key, d).replace(' → ', ' to ').toLowerCase()
/** Same defaults as tenantUsageList: text keys A → Z, the rest newest / highest first. */
const defaultDir = (key: TenantSort) => (SORT_KIND[key] === 'text' ? 'asc' : 'desc')

type Ctx = { sort: TenantSort; now: number; rules: BillingRules }
const on = (ctx: Ctx, key: TenantSort) => (ctx.sort === key ? true : undefined)
const live = (r: TenantUsageRow) => !r.deletedAt && r.status !== 'cancelled'

function StatusBadges({ r, ctx }: { r: TenantUsageRow; ctx: Ctx }) {
  const stage = r.deletedAt ? null : billingStageSummary(r, ctx.rules)
  return (
    <div className="tl-badges" data-key="status" data-on={on(ctx, 'status')}>
      {r.deletedAt ? (
        <Badge tone="danger">deleted</Badge>
      ) : (
        <Badge tone={statusTone(r.status)}>
          {r.status === 'read_only' ? 'paused' : r.status.replace('_', ' ')}
        </Badge>
      )}
      {stage && (
        <>
          <Badge tone={stage.stage === 'read_only' ? 'danger' : 'warning'}>{STAGE_LABEL[stage.stage]}</Badge>
          <span className="tl-note" data-tone={stage.stage === 'read_only' ? 'danger' : 'warning'}>
            {stage.stage === 'read_only'
              ? 'Read-only until paid'
              : `Read-only from ${formatDate(stage.readOnlyFrom)}`}
          </span>
        </>
      )}
    </div>
  )
}

function Line({
  ctx,
  k,
  label,
  value,
  title,
  stale,
}: {
  ctx: Ctx
  k: TenantSort
  label: string
  value: React.ReactNode
  title?: string
  stale?: boolean
}) {
  return (
    <div data-on={on(ctx, k)}>
      <span className="tl-lbl">{label}</span>{' '}
      <span className={cn('tl-val', stale && 'tl-stale')} data-key={k} title={title}>
        {value}
      </span>
    </div>
  )
}

/** Usage line: number first so the numbers right-align; the label after it may wrap on its own. */
function NumLine({ ctx, k, label, value }: { ctx: Ctx; k: TenantSort; label: string; value: string }) {
  return (
    <div data-on={on(ctx, k)}>
      <span className="tl-val" data-key={k}>
        {value}
      </span>{' '}
      <span className="tl-lbl">{label}</span>
    </div>
  )
}

function Activity({ r, ctx }: { r: TenantUsageRow; ctx: Ctx }) {
  const old = (d: Date | null, ms: number) => live(r) && !!d && ctx.now - d.getTime() > ms
  return (
    <div className="tl-kv">
      <Line
        ctx={ctx}
        k="signin"
        label="Sign-in"
        value={ago(r.lastSignInAt, ctx.now)}
        title={r.lastSignInAt?.toISOString()}
        stale={old(r.lastSignInAt, STALE.signin)}
      />
      <Line
        ctx={ctx}
        k="booking"
        label="Booking"
        value={ago(r.lastBookingAt, ctx.now)}
        title={r.lastBookingAt?.toISOString()}
        stale={old(r.lastBookingAt, STALE.booking)}
      />
      <Line ctx={ctx} k="joined" label="Joined" value={formatDate(r.createdAt)} />
    </div>
  )
}

function Usage({ r, ctx }: { r: TenantUsageRow; ctx: Ctx }) {
  return (
    <div className="tl-kv tl-nums">
      <NumLine
        ctx={ctx}
        k="bookings30"
        label={'bookings 30\u00a0d'}
        value={r.bookings30d.toLocaleString('en-US')}
      />
      <NumLine ctx={ctx} k="members" label="team" value={r.activeMembers.toLocaleString('en-US')} />
      <NumLine ctx={ctx} k="storage" label="storage" value={bytes(r.storageBytes)} />
    </div>
  )
}

function Ai({ r, ctx }: { r: TenantUsageRow; ctx: Ctx }) {
  const spend = Number(r.aiSpendUsd)
  const budget = Number(r.aiBudgetUsd)
  const pct = budget > 0 ? (spend / budget) * 100 : spend > 0 ? Number.POSITIVE_INFINITY : 0
  const level = pct >= 100 ? 'over' : pct >= 70 ? 'warn' : 'ok'
  const shown = Number.isFinite(pct) ? `${Math.round(pct)}%` : ''
  return (
    <div className="tl-ai" data-level={level} data-on={on(ctx, 'ai')}>
      <span className="tl-val" data-key="ai" title={`Budget USD ${budget.toFixed(2)}`}>
        <span className="tl-spend">${spend.toFixed(2)}</span>
        <span className="tl-dim"> / {budget.toFixed(0)}</span>
      </span>
      <span className="tl-meter" aria-hidden="true">
        <span style={{ width: `${Math.min(100, Number.isFinite(pct) ? pct : 100)}%` }} />
      </span>
      {level === 'over' ? (
        <span className="tl-pct">
          <strong>Over budget</strong>
          {shown && <span>{shown}</span>}
        </span>
      ) : (
        <span className="tl-pct">{shown} of budget</span>
      )}
    </div>
  )
}

function Plan({ r, ctx }: { r: TenantUsageRow; ctx: Ctx }) {
  const tier = r.featureTier ?? r.planTier
  return (
    <div className="tl-plan" data-on={on(ctx, 'plan')}>
      <span className={cn('tl-plan-name', !r.plan && 'tl-dim')} data-key="plan">
        {r.plan ?? 'No plan'}
      </span>{' '}
      {tier && (
        <span className="tl-dim">
          {tier === 'premium' ? 'Premium' : 'Standard'} tier
          {r.featureTier && (
            <span
              className="tl-tag"
              title={r.planTier ? `Super-admin override (plan tier: ${r.planTier})` : 'Super-admin override'}
            >
              override
            </span>
          )}
        </span>
      )}{' '}
      {r.periodEnd && (
        <span className="tl-dim" title="Current subscription period ends">
          Until {formatDate(r.periodEnd)}
        </span>
      )}
    </div>
  )
}

export default async function TenantsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; sort?: string; dir?: string }>
}) {
  const sp = await searchParams
  const q = sp.q?.trim() ?? ''
  const sort: TenantSort = isTenantSort(sp.sort) ? sp.sort : 'joined'
  const dir = sp.dir === 'asc' || sp.dir === 'desc' ? sp.dir : undefined
  const db = platformDb()
  const [rows, rules] = await Promise.all([tenantUsageList(db, { q, sort, dir }), billingRules(db)])
  const ctx: Ctx = { sort, now: Date.now(), rules }
  const activeDir = dir ?? defaultDir(sort)
  const flipped = activeDir === 'asc' ? 'desc' : 'asc'
  const href = (key: TenantSort, d?: 'asc' | 'desc') =>
    `${adminPath('/tenants')}?${new URLSearchParams({ ...(q ? { q } : {}), sort: key, ...(d ? { dir: d } : {}) })}`
  const DirIcon = activeDir === 'asc' ? ArrowUp : ArrowDown

  /** Header sort link (server-side; a second click flips the direction). The active one gets a pill + arrow. */
  const sortable = (key: TenantSort, label: string, className?: string) => {
    const active = sort === key
    return (
      <Link
        href={href(key, active ? flipped : undefined)}
        className={cn('tl-sort', className)}
        data-on={active || undefined}
      >
        <span className="sr-only">Sort by </span>
        {label}
        {active && (
          <>
            <DirIcon className="size-3" strokeWidth={2.25} aria-hidden="true" />
            <span className="sr-only"> (sorted, {dirWords(key, activeDir)})</span>
          </>
        )}
      </Link>
    )
  }
  /** aria-sort for a merged header: set when one of its keys is the active sort. */
  const ariaSort = (keys: TenantSort[]) =>
    keys.includes(sort) ? (activeDir === 'asc' ? 'ascending' : 'descending') : undefined
  const open = (r: TenantUsageRow) => adminPath(`/tenants/${r.id}`)

  return (
    <>
      <PageHeader
        title="Spas"
        description="Subscriptions, usage and access for every tenant. Usage is whole-spa totals only — no client data."
      />
      <PageBody>
        <div className="tl-toolbar flex flex-wrap items-center gap-x-3 gap-y-2 md:sticky md:top-0 md:z-20">
          <form className="relative min-w-0 flex-[1_1_16rem] sm:max-w-sm">
            <Search
              className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted"
              strokeWidth={1.5}
              aria-hidden="true"
            />
            {sort !== 'joined' && <input type="hidden" name="sort" value={sort} />}
            {dir && <input type="hidden" name="dir" value={dir} />}
            <Input
              name="q"
              type="search"
              defaultValue={q}
              placeholder="Search by name or address"
              aria-label="Search spas by name or address"
              className="ps-9"
            />
          </form>
          {/* No auto-submit (WCAG 3.2.2): pick a key, then Sort. A new key starts in its default direction. */}
          <form className="flex min-w-0 items-center gap-2">
            {q && <input type="hidden" name="q" value={q} />}
            <label htmlFor="tl-sort" className="shrink-0 text-[13px] text-muted">
              Sort by
            </label>
            <Select id="tl-sort" name="sort" defaultValue={sort} className="w-auto min-w-0 max-w-[13rem]">
              {TENANT_SORTS.map((k) => (
                <option key={k} value={k}>
                  {SORT_LABEL[k]}
                </option>
              ))}
            </Select>
            <Button type="submit" variant="secondary" size="sm">
              Sort
            </Button>
          </form>
          <Link
            href={href(sort, flipped)}
            className="tl-dir"
            aria-label={`Order: ${dirLabel(sort, activeDir).replace(' → ', ' to ')}. Switch to ${dirWords(sort, flipped)}`}
          >
            <ArrowDownUp className="size-4" strokeWidth={1.75} aria-hidden="true" />
            {dirLabel(sort, activeDir)}
          </Link>
          <p className="ms-auto text-[13px] text-muted tabular">
            {rows.length === 200
              ? 'First 200 spas — search to narrow'
              : `${rows.length} ${rows.length === 1 ? 'spa' : 'spas'}`}
          </p>
        </div>
        <Card className="tl-card" data-testid="spa-list">
          {rows.length === 0 ? (
            <EmptyState icon={<Building2 className="size-5" />} title={q ? 'No matches' : 'No spas yet'} />
          ) : (
            <>
              <table className="tl-table">
                <thead>
                  <tr>
                    <th scope="col" className="tl-c-spa" aria-sort={ariaSort(['name', 'status'])}>
                      <span className="tl-th-title">Spa</span>
                      <span className="tl-th-keys">
                        {sortable('name', 'Name')}
                        {sortable('status', 'Status')}
                        {sortable('plan', 'Plan', 'tl-compact-only')}
                      </span>
                    </th>
                    <th
                      scope="col"
                      className="tl-c-act"
                      aria-sort={ariaSort(['signin', 'booking', 'joined'])}
                    >
                      <span className="tl-th-title">Activity</span>
                      <span className="tl-th-keys">
                        {sortable('signin', 'Sign-in')}
                        {sortable('booking', 'Booking')}
                        {sortable('joined', 'Joined')}
                      </span>
                    </th>
                    <th
                      scope="col"
                      className="tl-c-use"
                      aria-sort={ariaSort(['bookings30', 'members', 'storage'])}
                    >
                      <span className="tl-th-title">Usage</span>
                      <span className="tl-th-keys">
                        {sortable('bookings30', 'Bookings 30\u00a0d')}
                        {sortable('members', 'Team')}
                        {sortable('storage', 'Storage')}
                      </span>
                    </th>
                    <th scope="col" className="tl-c-ai" aria-sort={ariaSort(['ai'])}>
                      {sortable('ai', 'AI this month', 'tl-th-title')}
                    </th>
                    <th scope="col" className="tl-c-plan" aria-sort={ariaSort(['plan'])}>
                      {sortable('plan', 'Plan', 'tl-th-title')}
                    </th>
                    <th scope="col" className="tl-c-open">
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Link href={open(r)} className="tl-name" data-key="name" data-on={on(ctx, 'name')}>
                          {r.name}
                        </Link>
                        <StatusBadges r={r} ctx={ctx} />
                        <div className="tl-slug">{r.slug}</div>
                        <div className="tl-compact-only tl-plan-inline">
                          <Plan r={r} ctx={ctx} />
                        </div>
                      </td>
                      <td>
                        <Activity r={r} ctx={ctx} />
                      </td>
                      <td>
                        <Usage r={r} ctx={ctx} />
                      </td>
                      <td>
                        <Ai r={r} ctx={ctx} />
                      </td>
                      <td className="tl-c-plan">
                        <Plan r={r} ctx={ctx} />
                      </td>
                      <td className="tl-open">
                        {/* Mouse target only; the name is the keyboard / screen-reader link. */}
                        <Link href={open(r)} className="tl-open-link" tabIndex={-1} aria-hidden="true">
                          <ChevronRight className="size-4" strokeWidth={1.75} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ul className="tl-list">
                {rows.map((r) => (
                  <li key={r.id} className="tl-item">
                    <div className="tl-item-head">
                      <div className="min-w-0">
                        <Link href={open(r)} className="tl-name" data-on={on(ctx, 'name')}>
                          {r.name}
                        </Link>
                        <StatusBadges r={r} ctx={ctx} />
                        <div className="tl-slug">{r.slug}</div>
                      </div>
                      <Link href={open(r)} className="tl-open-link" tabIndex={-1} aria-hidden="true">
                        <ChevronRight className="size-4" strokeWidth={1.75} />
                      </Link>
                    </div>
                    <dl className="tl-item-grid">
                      <div>
                        <dt>Activity</dt>
                        <dd>
                          <Activity r={r} ctx={ctx} />
                        </dd>
                      </div>
                      <div>
                        <dt>Usage</dt>
                        <dd>
                          <Usage r={r} ctx={ctx} />
                        </dd>
                      </div>
                      <div>
                        <dt data-on={on(ctx, 'ai')}>AI this month</dt>
                        <dd>
                          <Ai r={r} ctx={ctx} />
                        </dd>
                      </div>
                      <div>
                        <dt data-on={on(ctx, 'plan')}>Plan</dt>
                        <dd>
                          <Plan r={r} ctx={ctx} />
                        </dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
        <p className="text-xs text-muted">
          Sign-in = newest sign-in of an active team member. Booking = newest booking created. Joined = date
          the spa was created. Bookings 30 d = bookings created in the last 30 days (any source). Team =
          active members. Storage = uploaded files. AI = this Dubai month&apos;s spend (USD) / budget. Amber =
          no staff sign-in for 14+ days or no booking for 30+ days. Empty values sort last.
        </p>
      </PageBody>
    </>
  )
}
