import type { CellKind } from '@spa/services/xlsx'
import { notFound } from 'next/navigation'
import { xlsxDownload } from '@/components/data/server'
import { getT } from '@/i18n/server'
import { can, requireMember } from '@/server/access'
import { loadReports } from '../data'

const pct = (v: number | null) => (v === null ? '' : Math.round(v * 1000) / 10)
const hours = (minutes: number) => Math.round((minutes / 60) * 10) / 10

/** The Reports page as .xlsx (one sheet per KPI, same filters and permissions; headers in the viewer's language). */
export async function GET(req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'reports.view')) notFound()
  const q = Object.fromEntries(new URL(req.url).searchParams)
  const t = await getT()
  const d = await loadReports(ctx, q)
  const subtitle = t('reports.sheet.subtitle', {
    from: d.range.from,
    to: d.range.to,
    branch: d.branchName ?? t('reports.allBranches'),
  })
  const sheet = (name: string, title: string, rows: unknown[][], kinds: CellKind[], sub = subtitle) => ({
    name,
    title: `${ctx.tenant.name} — ${title}`,
    subtitle: sub,
    rows,
    kinds,
  })
  const rb = d.rebooking
  const sheets = [
    sheet(
      t('reports.sheet.rebooking'),
      `${t('reports.rebook.title')} (${t('reports.rebook.window', { days: rb.windowDays })})`,
      [
        [
          t('reports.therapist'),
          t('reports.rebook.visits'),
          t('reports.rebook.rebooked'),
          t('reports.sheet.ratePct'),
        ],
        ...rb.byTherapist.map((r) => [r.name, r.visits, r.rebooked, pct(r.rate)]),
        [t('reports.allTherapists'), rb.visits, rb.rebooked, pct(rb.rate)],
      ],
      ['text', 'integer', 'integer', 'percent'],
    ),
  ]
  if (d.rev)
    sheets.push(
      sheet(
        t('reports.sheet.revPath'),
        t('reports.revPath.title'),
        [
          [
            t('reports.therapist'),
            t('reports.sheet.revenueAed'),
            t('reports.revPath.hours'),
            t('reports.sheet.revPathAed'),
            t('reports.revPath.source'),
          ],
          ...d.rev.byTherapist.map((r) => [
            r.name,
            r.revenue,
            r.hours,
            r.revPath ?? '',
            r.source === 'shifts'
              ? t('reports.revPath.sourceShifts')
              : r.source === 'timeclock'
                ? t('reports.revPath.sourceTimeclock')
                : '',
          ]),
          [t('reports.allTherapists'), d.rev.revenue, d.rev.hours, d.rev.revPath ?? '', ''],
        ],
        ['text', 'money', 'number', 'money', 'text'],
      ),
    )
  sheets.push(
    sheet(
      t('reports.sheet.rooms'),
      t('reports.rooms.title'),
      [
        [
          t('reports.sheet.branch'),
          t('reports.rooms.room'),
          t('reports.rooms.booked'),
          t('reports.rooms.open'),
          t('reports.sheet.utilisationPct'),
        ],
        ...d.rooms.branches.flatMap((b) => [
          ...b.rooms.map((r) => [
            b.name,
            r.name,
            hours(r.bookedMinutes),
            hours(r.openMinutes),
            pct(r.utilisation),
          ]),
          [
            b.name,
            t('reports.liability.total'),
            hours(b.bookedMinutes),
            hours(b.openMinutes),
            pct(b.utilisation),
          ],
        ]),
        [
          t('reports.allBranches'),
          t('reports.liability.total'),
          hours(d.rooms.bookedMinutes),
          hours(d.rooms.openMinutes),
          pct(d.rooms.utilisation),
        ],
      ],
      ['text', 'text', 'number', 'number', 'percent'],
    ),
    sheet(
      t('reports.sheet.retention'),
      t('reports.cohorts.title'),
      [
        [
          t('reports.cohorts.cohort'),
          t('reports.cohorts.clients'),
          ...[1, 2, 3, 4, 5, 6].map((n) => t('reports.sheet.monthPct', { n })),
        ],
        ...d.cohorts.map((c) => [
          c.month,
          c.size,
          ...c.returning.map((r) => (r === null || !c.size ? '' : pct(r / c.size))),
        ]),
      ],
      ['text', 'integer', 'percent', 'percent', 'percent', 'percent', 'percent', 'percent'],
    ),
  )
  const li = d.liability
  if (li)
    sheets.push(
      sheet(
        t('reports.sheet.liability'),
        t('reports.liability.title'),
        [
          [
            t('reports.liability.item'),
            t('reports.liability.count'),
            t('reports.sheet.outstandingAed'),
            t('reports.sheet.ledgerAed'),
            t('reports.sheet.differenceAed'),
          ],
          [
            t('reports.liability.giftCards'),
            li.giftCards.count,
            li.giftCards.value,
            li.ledger.giftCards,
            li.difference.giftCards,
          ],
          [t('reports.sheet.packages'), li.packages.count, li.packages.value, '', ''],
          [t('reports.sheet.memberships'), li.memberships.count, li.memberships.value, '', ''],
          [
            t('reports.liability.packagesMemberships'),
            li.packages.count + li.memberships.count,
            li.packages.value + li.memberships.value,
            li.ledger.packagesMemberships,
            li.difference.packagesMemberships,
          ],
          [t('reports.liability.total'), '', li.total, li.ledger.total, li.difference.total],
        ],
        ['text', 'integer', 'money', 'money', 'money'],
        t('reports.sheet.asOf', { date: li.asOf }),
      ),
    )
  return xlsxDownload(`reports-${ctx.tenant.slug}-${d.range.from}-${d.range.to}.xlsx`, {
    title: t('reports.sheet.title', { spa: ctx.tenant.name }),
    sheets,
  })
}
