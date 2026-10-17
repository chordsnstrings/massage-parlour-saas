'use server'
// Global search for the spa top bar (PLAN §14.7 B4). Read-only: requireMember + permission-built scope, then the
// tenant-scoped service. Phones are matched and shown only with `clients.phone`.
import { enumLabel } from '@spa/core/i18n'
import { withTenant } from '@spa/db'
import { globalSearch, SEARCH_KINDS, type SearchHit, type SearchKind, type SearchScope } from '@spa/services'
import { allowedBranches, ownStaffId } from '@/app/dashboard/[tenant]/calendar/data'
import { getI18n } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { can, requireMember } from '@/server/access'

export type SearchItem = { kind: SearchKind; id: string; href: string; title: string; sub: string | null }
export type SearchResultGroup = { kind: SearchKind; label: string; items: SearchItem[]; hasMore: boolean }
export type SearchResponse = { ok: true; groups: SearchResultGroup[] } | { ok: false; error: string }

const PATHS: Record<SearchKind, (id: string) => string> = {
  clients: (id) => `/clients/${id}`,
  bookings: (id) => `/bookings/${id}`,
  sales: (id) => `/sales/${id}`,
  staff: (id) => `/staff/${id}`,
  services: () => '/services',
}

export async function searchAction(
  slug: string,
  query: string,
  opts: { kind?: SearchKind; page?: number } = {},
): Promise<SearchResponse> {
  const ctx = await requireMember(slug)
  const { t, fmt } = await getI18n()
  if (typeof query !== 'string') return { ok: false, error: t('search.error') }
  const kind = SEARCH_KINDS.find((k) => k === opts.kind)
  const page = Number.isInteger(opts.page) && (opts.page ?? 0) > 0 ? opts.page : 1
  const groups = await withTenant(ctx.tenant.id, async (tx) => {
    const scope: SearchScope = {}
    if (can(ctx, 'clients.view')) scope.clients = { phone: can(ctx, 'clients.phone') }
    const needBranches = can(ctx, 'calendar.view') || can(ctx, 'pos.use')
    const branchIds = needBranches ? (await allowedBranches(tx, ctx)).map((b) => b.id) : []
    if (can(ctx, 'calendar.view')) {
      // Therapists (no calendar.manage) only find their own bookings, like the bookings list.
      const staffId = can(ctx, 'calendar.manage') ? null : await ownStaffId(tx, ctx)
      if (can(ctx, 'calendar.manage') || staffId) scope.bookings = { branchIds, staffId }
    }
    if (can(ctx, 'pos.use')) scope.sales = { branchIds }
    if (can(ctx, 'staff.view')) scope.staff = true
    if (can(ctx, 'services.manage')) scope.services = true
    return globalSearch(tx, query, scope, { kind, page, limit: 5 })
  })
  const base = `/${ctx.tenant.slug}`
  const walkIn = t('search.hit.walkIn')
  const sub = (h: SearchHit): string | null => {
    switch (h.kind) {
      case 'clients':
        return h.phone
          ? `+${h.phone}`
          : h.at
            ? t('search.hit.lastVisit', { date: fmt.date(h.at) })
            : t('search.hit.newClient')
      case 'bookings':
        return [
          h.clientName ?? walkIn,
          h.at ? fmt.dateTime(h.at) : null,
          enumLabel(t, 'bookingStatus', h.status ?? ''),
        ]
          .filter(Boolean)
          .join(' · ')
      case 'sales':
        return [h.clientName ?? walkIn, fmt.aed(h.totalAed ?? '0'), h.at ? fmt.date(h.at) : null]
          .filter(Boolean)
          .join(' · ')
      default:
        return null
    }
  }
  return {
    ok: true,
    groups: groups.map((g) => ({
      kind: g.kind,
      label: t(`search.group.${g.kind}`),
      hasMore: g.hasMore,
      items: g.hits.map((h) => ({
        kind: h.kind,
        id: h.id,
        href: appPath(`${base}${PATHS[h.kind](h.id)}`),
        title: h.kind === 'sales' ? t('search.hit.receipt', { number: h.number ?? h.title }) : h.title,
        sub: sub(h),
      })),
    })),
  }
}
