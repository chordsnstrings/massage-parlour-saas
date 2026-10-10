import type { BillingRules } from '@spa/core'
import { createFormat } from '@spa/core/i18n/format'
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
import { ArrowDown, ArrowDownUp, ArrowUp, Building2, ChevronDown, Search } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Badge, statusTone } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { adminPath } from '@/lib/paths'
import { cn } from '@/lib/utils'
import './tenants.css'

export const metadata: Metadata = { title: 'Spas' }

// F21 spa list (owner 2026-10-10: "all data in one page", then "what is this mess … remove the big box"): a flat
// table on the page background, one value per cell, one header line per column (each a server sort link), Joined
// folded into the spa's second line, column definitions in a disclosure under the list. Layout modes: tenants.css.

const en = createFormat('en')
const year = (d: Date | string) => en.date(d).slice(-4)
/** "30 Oct", with the year only when it isn't this year. */
const shortDate = (d: Date | string, now: Date) => (year(d) === year(now) ? en.dateShort(d) : en.date(d))

/** "12 min ago" … "59 d ago", then the date ("10 Jun"; "Jun 2025" in an earlier year), so the activity columns stay
 *  narrow; the exact Dubai date + time (with the year) is in the title. */
function ago(d: Date | null, now: Date) {
  if (!d) return 'never'
  const mins = Math.max(0, Math.round((now.getTime() - d.getTime()) / 60_000))
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days < 60) return `${days} d ago`
  return year(d) === year(now) ? en.dateShort(d) : `${en.monthShort(d)} ${year(d)}`
}

function bytes(n: number) {
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

const DAY = 86_400_000
/** Dormancy cue (amber): no staff sign-in for 14+ days / no booking for 30+ days (never = counted from joining). */
const STALE = { signin: 14 * DAY, booking: 30 * DAY }

const SORT_LABEL: Record<TenantSort, string> = {
  name: 'Name',
  status: 'Status',
  plan: 'Plan',
  signin: 'Last staff sign-in',
  booking: 'Last booking',
  bookings30: 'Bookings 30 d',
  members: 'Team',
  storage: 'Storage',
  ai: 'AI this month',
  joined: 'Joined',
}
/** Column headings: the table headers, the card labels and the definitions list use the same words. */
const COLUMN: Record<TenantSort, string> = {
  name: 'Spa',
  joined: 'Joined',
  status: 'Status',
  plan: 'Plan',
  signin: 'Sign-in',
  booking: 'Booking',
  bookings30: 'Bookings 30 d',
  members: 'Team',
  storage: 'Storage',
  ai: 'AI this month',
}
/** Table order (Joined sits with the spa name). */
const COLUMN_ORDER = Object.keys(COLUMN) as TenantSort[]
/** What each column counts: the "What the columns count" list under the list (all widths) + header tooltips. */
const DEFINITION: Record<TenantSort, string> = {
  name: 'Spa name; below it the address and the date the spa joined',
  joined: 'Date the spa was created',
  status: 'Subscription status; a note when an invoice is late',
  plan: 'Subscribed plan and when the current period ends; a grey tag shows the feature tier when the name does not; a green → tag is a tier set by a super-admin (override)',
  signin: 'Newest sign-in of an active team member',
  booking: 'Newest booking created',
  bookings30: 'Bookings created in the last 30 days (any source)',
  members: 'Active team members',
  storage: 'Uploaded files',
  ai: "This Dubai month's AI spend (USD) / budget",
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

type Ctx = { now: Date; rules: BillingRules }
const live = (r: TenantUsageRow) => !r.deletedAt && r.status !== 'cancelled'
const tierName = (t: string) => (t === 'premium' ? 'Premium' : 'Standard')

/** Address + joined date: the slug truncates (full text in the title), the date never does. */
function SpaSub({ r }: { r: TenantUsageRow }) {
  return (
    <span className="sl-sub sl-spa-sub">
      <span className="sl-slug" title={r.slug}>
        {r.slug}
      </span>
      <span className="sl-sep" aria-hidden="true">
        ·
      </span>
      <span className="sr-only">, joined </span>
      <span data-key="joined" title={`Joined ${en.date(r.createdAt)}`}>
        {en.date(r.createdAt)}
      </span>
    </span>
  )
}

function StatusBadge({ r }: { r: TenantUsageRow }) {
  if (r.deletedAt) return <Badge tone="danger">deleted</Badge>
  return (
    <Badge tone={statusTone(r.status)}>
      {r.status === 'read_only' ? 'paused' : r.status.replace('_', ' ')}
    </Badge>
  )
}

/** One quiet line when an invoice is late: the stage and the day the spa turns read-only (full date in the title). */
function BillingNote({ r, ctx }: { r: TenantUsageRow; ctx: Ctx }) {
  const stage = r.deletedAt ? null : billingStageSummary(r, ctx.rules)
  if (!stage) return null
  if (stage.stage === 'read_only')
    return (
      <span
        className="sl-sub sl-billing"
        data-tone="danger"
        title="Read-only (billing) until the invoice is paid"
      >
        Read-only until paid
      </span>
    )
  const grace = stage.stage === 'grace'
  return (
    <span
      className="sl-sub sl-billing"
      data-tone="warning"
      title={`${grace ? 'Grace period' : 'Invoice overdue'}: read-only from ${en.date(stage.readOnlyFrom)}`}
    >
      {grace ? 'Grace' : 'Overdue'} · <span className="sl-nowrap">read-only</span>{' '}
      <span className="sl-nowrap">from {shortDate(stage.readOnlyFrom, ctx.now)}</span>
    </span>
  )
}

function Plan({ r, ctx }: { r: TenantUsageRow; ctx: Ctx }) {
  const tier = r.featureTier ?? r.planTier
  // The tier tag only when the plan name doesn't already say it ("Yearly (legacy)" → Premium); an override always.
  const tag = r.featureTier
    ? 'override'
    : tier && r.plan && !r.plan.toLowerCase().includes(tier)
      ? 'tier'
      : null
  return (
    <>
      <span className={cn('sl-plan', !r.plan && 'sl-muted')} data-key="plan">
        {r.plan ?? 'No plan'}
      </span>
      {(tag || r.periodEnd) && (
        <span className="sl-sub">
          {tier && tag === 'override' && (
            <span
              className="sl-tag"
              data-tone="override"
              title={
                r.planTier
                  ? `Feature tier set by a super-admin (plan tier: ${tierName(r.planTier)})`
                  : 'Feature tier set by a super-admin'
              }
            >
              <span aria-hidden="true">→ </span>
              {tierName(tier)}
              <span className="sr-only"> tier (override)</span>
            </span>
          )}
          {tier && tag === 'tier' && (
            <span className="sl-tag" title="Plan tier">
              {tierName(tier)}
              <span className="sr-only"> tier</span>
            </span>
          )}
          {r.periodEnd && (
            <span className="sl-until" title={`Current period ends ${en.date(r.periodEnd)}`}>
              until {shortDate(r.periodEnd, ctx.now)}
            </span>
          )}
        </span>
      )}
    </>
  )
}

function When({ r, ctx, k }: { r: TenantUsageRow; ctx: Ctx; k: 'signin' | 'booking' }) {
  const d = k === 'signin' ? r.lastSignInAt : r.lastBookingAt
  const stale = live(r) && ctx.now.getTime() - (d ?? r.createdAt).getTime() > STALE[k]
  return (
    <span
      data-key={k}
      className={cn(stale ? 'sl-stale' : !d && 'sl-quiet')}
      title={d ? `${en.date(d)}, ${en.time(d)}` : undefined}
    >
      {ago(d, ctx.now)}
    </span>
  )
}

function Num({ k, n, text }: { k: TenantSort; n: number; text?: string }) {
  return (
    <span data-key={k} className={cn(n === 0 && 'sl-quiet')}>
      {text ?? n.toLocaleString('en-US')}
    </span>
  )
}

function Ai({ r }: { r: TenantUsageRow }) {
  const spend = Number(r.aiSpendUsd)
  const budget = Number(r.aiBudgetUsd)
  const pct = budget > 0 ? (spend / budget) * 100 : spend > 0 ? Number.POSITIVE_INFINITY : 0
  const level = pct >= 100 ? 'over' : pct >= 70 ? 'warn' : 'ok'
  const share = Number.isFinite(pct) ? `${Math.round(pct)}% of budget` : 'no budget set'
  return (
    <>
      <span
        data-key="ai"
        data-level={level}
        className={cn('sl-ai', spend === 0 && 'sl-quiet')}
        title={`USD ${spend.toFixed(2)} of ${budget.toFixed(2)} (${share})`}
      >
        <span className="sl-spend">${spend.toFixed(2)}</span>
        <span className="sl-budget"> / {budget.toFixed(0)}</span>
      </span>
      {level !== 'ok' && (
        <span className="sl-sub sl-share" data-tone={level === 'over' ? 'danger' : 'warning'}>
          {share}
          {level === 'over' && <span className="sr-only"> (over budget)</span>}
        </span>
      )}
    </>
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
  const ctx: Ctx = { now: new Date(), rules }
  const activeDir = dir ?? defaultDir(sort)
  const flipped = activeDir === 'asc' ? 'desc' : 'asc'
  const href = (key: TenantSort, d?: 'asc' | 'desc') =>
    `${adminPath('/tenants')}?${new URLSearchParams({ ...(q ? { q } : {}), sort: key, ...(d ? { dir: d } : {}) })}`
  const ariaSort = activeDir === 'asc' ? 'ascending' : 'descending'

  /** Header sort link (server-side; a second click flips). Arrow in reserved space: solid when sorted, ghost on hover. */
  const sortLink = (key: TenantSort, label: string) => {
    const active = sort === key
    const Arrow = (active ? activeDir : defaultDir(key)) === 'asc' ? ArrowUp : ArrowDown
    return (
      <Link
        href={href(key, active ? flipped : undefined)}
        className="sl-sort"
        data-on={active || undefined}
        title={DEFINITION[key]}
      >
        <span className="sr-only">Sort by </span>
        {label}
        <Arrow className="sl-arrow" strokeWidth={2.25} aria-hidden="true" />
        {active && <span className="sr-only"> (sorted, {dirWords(key, activeDir)})</span>}
      </Link>
    )
  }
  const th = (key: TenantSort, num?: boolean) => (
    <th scope="col" className={cn(num && 'sl-num')} aria-sort={sort === key ? ariaSort : undefined}>
      {sortLink(key, COLUMN[key])}
    </th>
  )
  const open = (r: TenantUsageRow) => adminPath(`/tenants/${r.id}`)
  const count =
    rows.length === 200
      ? 'First 200 spas — search to narrow'
      : `${rows.length} ${rows.length === 1 ? 'spa' : 'spas'}`

  return (
    <>
      <PageHeader
        title="Spas"
        description="Subscriptions, usage and access for every tenant. Whole-spa totals only — no client data."
      />
      <PageBody>
        <div className="sl" data-testid="spa-list">
          <div className="sl-bar">
            <form className="sl-search">
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
                className="h-10 ps-9"
              />
            </form>
            {/* Cards only (the table headers sort on desktop). No auto-submit (WCAG 3.2.2): pick a key, then Sort. */}
            <div className="sl-sortctl">
              <form className="flex min-w-0 items-center gap-2">
                {q && <input type="hidden" name="q" value={q} />}
                <label htmlFor="sl-sort" className="shrink-0 text-[13px] text-muted">
                  Sort by
                </label>
                <Select
                  id="sl-sort"
                  name="sort"
                  defaultValue={sort}
                  className="h-9 w-auto min-w-0 max-w-[13rem]"
                >
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
                className="sl-dir"
                aria-label={`Order: ${dirLabel(sort, activeDir).replace(' → ', ' to ')}. Switch to ${dirWords(sort, flipped)}`}
              >
                <ArrowDownUp className="size-4" strokeWidth={1.75} aria-hidden="true" />
                {dirLabel(sort, activeDir)}
              </Link>
            </div>
            <p className="sl-count">{count}</p>
          </div>
          {rows.length === 0 ? (
            <EmptyState icon={<Building2 className="size-5" />} title={q ? 'No matches' : 'No spas yet'} />
          ) : (
            <>
              <table className="sl-table">
                <colgroup>
                  <col />
                  <col className="c-status" />
                  <col className="c-plan" />
                  <col className="c-when" />
                  <col className="c-when" />
                  <col className="c-b30" />
                  <col className="c-team" />
                  <col className="c-storage" />
                  <col className="c-ai" />
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col" aria-sort={sort === 'name' || sort === 'joined' ? ariaSort : undefined}>
                      <span className="sl-pair">
                        {sortLink('name', COLUMN.name)}
                        <span className="sl-sep" aria-hidden="true">
                          ·
                        </span>
                        {sortLink('joined', COLUMN.joined)}
                      </span>
                    </th>
                    {th('status')}
                    {th('plan')}
                    {th('signin')}
                    {th('booking')}
                    {th('bookings30', true)}
                    {th('members', true)}
                    {th('storage', true)}
                    {th('ai', true)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      {/* Row header: moving down any column, a screen reader names the spa. */}
                      <th scope="row">
                        <Link href={open(r)} className="sl-name" data-key="name">
                          {r.name}
                        </Link>
                        <SpaSub r={r} />
                      </th>
                      <td>
                        <StatusBadge r={r} />
                        <BillingNote r={r} ctx={ctx} />
                      </td>
                      <td>
                        <Plan r={r} ctx={ctx} />
                      </td>
                      <td className="sl-when">
                        <When r={r} ctx={ctx} k="signin" />
                      </td>
                      <td className="sl-when">
                        <When r={r} ctx={ctx} k="booking" />
                      </td>
                      <td className="sl-num">
                        <Num k="bookings30" n={r.bookings30d} />
                      </td>
                      <td className="sl-num">
                        <Num k="members" n={r.activeMembers} />
                      </td>
                      <td className="sl-num">
                        <Num k="storage" n={r.storageBytes} text={bytes(r.storageBytes)} />
                      </td>
                      <td className="sl-num">
                        <Ai r={r} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ul className="sl-cards">
                {rows.map((r) => (
                  <li key={r.id} className="sl-card">
                    <div className="sl-card-head">
                      <div className="min-w-0">
                        <Link href={open(r)} className="sl-name">
                          {r.name}
                        </Link>
                        <SpaSub r={r} />
                      </div>
                      <StatusBadge r={r} />
                    </div>
                    <BillingNote r={r} ctx={ctx} />
                    <dl className="sl-card-grid">
                      <div className="sl-card-plan">
                        <dt>{COLUMN.plan}</dt>
                        <dd>
                          <Plan r={r} ctx={ctx} />
                        </dd>
                      </div>
                      <div>
                        <dt>{COLUMN.signin}</dt>
                        <dd>
                          <When r={r} ctx={ctx} k="signin" />
                        </dd>
                      </div>
                      <div>
                        <dt>{COLUMN.booking}</dt>
                        <dd>
                          <When r={r} ctx={ctx} k="booking" />
                        </dd>
                      </div>
                      <div>
                        <dt>{COLUMN.bookings30}</dt>
                        <dd className="tabular">
                          <Num k="bookings30" n={r.bookings30d} />
                        </dd>
                      </div>
                      <div>
                        <dt>{COLUMN.members}</dt>
                        <dd className="tabular">
                          <Num k="members" n={r.activeMembers} />
                        </dd>
                      </div>
                      <div>
                        <dt>{COLUMN.storage}</dt>
                        <dd className="tabular">
                          <Num k="storage" n={r.storageBytes} text={bytes(r.storageBytes)} />
                        </dd>
                      </div>
                      <div>
                        <dt>{COLUMN.ai}</dt>
                        <dd className="tabular">
                          <Ai r={r} />
                        </dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="sl-legend">
            <span className="sl-dot" aria-hidden="true" />
            Amber: no staff sign-in for 14+ days or no booking for 30+ days (counted from joining when there
            has been none). Empty values sort last.
          </p>
          <details className="sl-defs">
            <summary>
              What the columns count
              <ChevronDown className="sl-chev" strokeWidth={2} aria-hidden="true" />
            </summary>
            <dl>
              {COLUMN_ORDER.map((k) => (
                <div key={k}>
                  <dt>{COLUMN[k]}</dt>
                  <dd>{DEFINITION[k]}</dd>
                </div>
              ))}
            </dl>
          </details>
        </div>
      </PageBody>
    </>
  )
}
