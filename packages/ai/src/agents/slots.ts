import { addDays, businessDateOf, dubaiParts } from '@spa/core'
import { outbox, type Tx, tenants, withTenant } from '@spa/db'
import { loadDay, resolveSegment } from '@spa/services'
import { eq } from 'drizzle-orm'

/**
 * Idle therapist capacity per hour for a business date: hours where at least `minFree` therapists on shift are free.
 * Used by the slot-filler to suggest last-minute offers.
 */
export async function idleHours(
  tx: Tx,
  branchId: string,
  date: string,
  opts: { minFree?: number; now?: Date } = {},
) {
  const day = await loadDay(tx, branchId, date)
  const now = opts.now ?? new Date()
  const out: { start: Date; free: number }[] = []
  for (let t = day.window.start.getTime(); t < day.window.end.getTime(); t += 3600_000) {
    const start = new Date(t)
    if (start < now) continue
    const end = new Date(t + 3600_000)
    const free = day.staff.filter(
      (s) =>
        s.shifts.some((sh) => sh.start <= start && end <= sh.end) &&
        !s.busy.some((b) => b.start < end && start < b.end),
    ).length
    if (free >= (opts.minFree ?? 1)) out.push({ start, free })
  }
  return out
}

/**
 * Queues WhatsApp "free slot" offers (click-to-send) to past clients who haven't visited in 21+ days,
 * for the best idle hour today (or tomorrow). Returns how many messages were queued.
 */
export async function queueSlotOffers(opts: {
  tenantId: string
  branchId: string
  max?: number
  now?: Date
}) {
  const now = opts.now ?? new Date()
  return withTenant(opts.tenantId, async (tx) => {
    const today = businessDateOf(now)
    let idle = await idleHours(tx, opts.branchId, today, { minFree: 2, now })
    let day = today
    if (!idle.length) {
      day = addDays(today, 1)
      idle = await idleHours(tx, opts.branchId, day, { minFree: 2, now })
    }
    const best = idle.sort((a, b) => b.free - a.free || a.start.getTime() - b.start.getTime())[0]
    if (!best) return 0
    const [spa] = await tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, opts.tenantId))
    const people = (await resolveSegment(tx, opts.tenantId, [{ kind: 'lapsed', days: 21 }], now)).slice(
      0,
      opts.max ?? 15,
    )
    const p = dubaiParts(best.start)
    const time = `${String(Math.floor(p.minutes / 60)).padStart(2, '0')}:${String(p.minutes % 60).padStart(2, '0')}`
    const when = day === today ? 'today' : 'tomorrow'
    if (!people.length) return 0
    await tx.insert(outbox).values(
      people.map((c) => ({
        tenantId: opts.tenantId,
        branchId: opts.branchId,
        clientId: c.id,
        kind: 'slot_offer' as const,
        phoneE164: c.phone!,
        text:
          c.language === 'ar'
            ? `مرحباً ${c.name.split(' ')[0]}، لدينا موعد متاح ${when === 'today' ? 'اليوم' : 'غداً'} الساعة ${time} في ${spa?.name}. هل ترغب بحجزه؟`
            : `Hi ${c.name.split(' ')[0]}, we have a free slot ${when} at ${time} at ${spa?.name}. Would you like it?`,
      })),
    )
    return people.length
  })
}
