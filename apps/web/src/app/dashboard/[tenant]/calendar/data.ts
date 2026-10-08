import { businessDateOf, dubaiInstant, type OpeningHours, openIntervals, whatsappLink } from '@spa/core'
import {
  bookingItems,
  bookings,
  branches,
  clients,
  services,
  serviceVariants,
  staff,
  type Tx,
  withTenant,
} from '@spa/db'
import { loadDay, rotationFor } from '@spa/services'
import { and, asc, desc, eq } from 'drizzle-orm'
import { formatPhone, maskPhone } from '@/components/calendar/time'
import type { BookingStatus, CalendarData, CalItem, RotationRow } from '@/components/calendar/types'
import { getI18n } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { can, type MemberContext } from '@/server/access'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const ACTIVE: BookingStatus[] = ['pending', 'confirmed', 'checked_in', 'in_service']

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

/** Branches this member may work in (all when the member is unrestricted). */
export async function allowedBranches(tx: Tx, ctx: MemberContext) {
  const rows = await tx
    .select()
    .from(branches)
    .where(eq(branches.active, true))
    .orderBy(desc(branches.isDefault), asc(branches.name))
  if (!ctx.member || ctx.member.allBranches) return rows
  return rows.filter((b) => ctx.member!.branchIds.includes(b.id))
}

/** The staff profile linked to the signed-in member (therapists see only their own bookings). */
export async function ownStaffId(tx: Tx, ctx: MemberContext) {
  if (!ctx.member) return null
  const [row] = await tx.select({ id: staff.id }).from(staff).where(eq(staff.memberId, ctx.member.id))
  return row?.id ?? null
}

export async function loadCalendar(
  ctx: MemberContext,
  q: { date?: string; branch?: string; view?: string; cancelled?: string },
): Promise<CalendarData | null> {
  const canManage = can(ctx, 'calendar.manage')
  const seePhone = can(ctx, 'clients.phone')
  const { t, fmt } = await getI18n()
  return withTenant(ctx.tenant.id, async (tx) => {
    const branchRows = await allowedBranches(tx, ctx)
    const branch = branchRows.find((b) => b.id === q.branch) ?? branchRows[0]
    if (!branch) return null
    const cutoff = branch.businessDayCutoff.slice(0, 5)
    const cutoffMin = toMin(cutoff)
    const now = new Date()
    const today = businessDateOf(now, cutoff)
    const date = q.date && DATE.test(q.date) ? q.date : today
    const dayStart = dubaiInstant(date, 0).getTime()
    const rel = (d: Date) => Math.round((d.getTime() - dayStart) / 60_000)

    const day = await loadDay(tx, branch.id, date)
    const myStaff = await ownStaffId(tx, ctx)
    const ownOnly = ctx.member?.roleKey === 'therapist' || (!canManage && myStaff !== null)

    const rows = await tx
      .select({ item: bookingItems, booking: bookings, client: clients })
      .from(bookingItems)
      .innerJoin(bookings, eq(bookings.id, bookingItems.bookingId))
      .leftJoin(clients, eq(clients.id, bookings.clientId))
      .where(and(eq(bookings.branchId, branch.id), eq(bookings.businessDate, date)))
      .orderBy(asc(bookingItems.startsAt))

    const allStaff = await tx
      .select({ id: staff.id, name: staff.displayName, color: staff.color })
      .from(staff)
      .orderBy(asc(staff.sort), asc(staff.displayName))
    const staffNames = Object.fromEntries(allStaff.map((s) => [s.id, { name: s.name, color: s.color }]))

    let items: CalItem[] = rows.map(({ item, booking, client }) => ({
      id: item.id,
      bookingId: booking.id,
      refCode: booking.refCode,
      status: booking.status,
      source: booking.source,
      startMin: rel(item.startsAt),
      endMin: rel(item.endsAt),
      staffIds: item.staffIds,
      roomId: item.roomId,
      serviceName: item.serviceName,
      durationMin: item.durationMin,
      priceAed: item.priceAed,
      // Anonymous walk-ins keep the name they gave in the notes.
      clientName: client?.name ?? (booking.notes?.startsWith('Walk-in: ') ? booking.notes.slice(9) : null),
      clientPhone: client?.phoneE164
        ? seePhone
          ? formatPhone(client.phoneE164)
          : maskPhone(client.phoneE164)
        : null,
      clientWhatsapp: client?.phoneE164 && seePhone ? whatsappLink(client.phoneE164, '', 'mobile') : null,
      notes: booking.notes,
      cancelReason: booking.cancelReason,
    }))

    // Shifts clipped to this business day (loadDay also returns the neighbouring days).
    const dayLo = cutoffMin
    const dayHi = cutoffMin + 1440
    let staffCols = day.staff.map((s) => ({
      id: s.id,
      name: s.name,
      color: s.color,
      shifts: s.shifts
        .map((sh) => ({ start: Math.max(rel(sh.start), dayLo), end: Math.min(rel(sh.end), dayHi) }))
        .filter((sh) => sh.end > sh.start),
    }))
    // Bookings with someone who is no longer bookable still need a column.
    for (const it of items)
      for (const sid of it.staffIds)
        if (!staffCols.some((c) => c.id === sid) && staffNames[sid])
          staffCols.push({ id: sid, name: staffNames[sid].name, color: staffNames[sid].color, shifts: [] })
    const roomCols = day.rooms.map((r) => ({ id: r.id, name: r.name }))

    if (ownOnly) {
      staffCols = staffCols.filter((c) => c.id === myStaff)
      items = items.filter((i) => myStaff !== null && i.staffIds.includes(myStaff))
    }

    // Grid spans opening hours, shifts and bookings, clamped to the business day.
    const spans: number[][] = openIntervals(date, branch.openingHours as OpeningHours).map((o) => [
      rel(o.start),
      rel(o.end),
    ])
    for (const c of staffCols) for (const s of c.shifts) spans.push([s.start, s.end])
    for (const i of items) spans.push([i.startMin, i.endMin])
    const lo = Math.max(dayLo, Math.min(...spans.map((s) => s[0]!), 10 * 60))
    const hi = Math.min(dayHi, Math.max(...spans.map((s) => s[1]!), lo + 8 * 60))
    const gridStart = Math.floor(lo / 60) * 60
    const gridEnd = Math.max(gridStart + 60, Math.ceil(hi / 60) * 60)

    const variants = (
      await tx
        .select({ variant: serviceVariants, service: services })
        .from(serviceVariants)
        .innerJoin(services, eq(services.id, serviceVariants.serviceId))
        .where(and(eq(services.active, true), eq(serviceVariants.active, true)))
        .orderBy(asc(services.sort), asc(serviceVariants.sort), asc(serviceVariants.durationMin))
    ).map(({ variant, service }) => ({
      id: variant.id,
      label: t('calendar.variant', {
        service: service.name.en,
        min: variant.durationMin,
        price: fmt.aed(variant.priceAed),
      }),
      durationMin: variant.durationMin,
      priceAed: variant.priceAed,
    }))

    let rotation: RotationRow[] | null = null
    if (canManage && !ownOnly && date === today) {
      const nowMin = rel(now)
      const entries = await rotationFor(tx, ctx.tenant.id, branch.id, date)
      rotation = entries.map((e) => {
        const col = staffCols.find((c) => c.id === e.staffId)
        const onShift = col?.shifts.some((s) => s.start <= nowMin && nowMin < s.end) ?? false
        const busy = items.some(
          (i) =>
            i.staffIds.includes(e.staffId) &&
            ACTIVE.includes(i.status) &&
            (i.status === 'in_service' || (i.startMin <= nowMin && nowMin < i.endMin)),
        )
        const status: RotationRow['status'] =
          e.status === 'break' || e.status === 'off' ? e.status : busy ? 'busy' : onShift ? 'free' : 'off'
        return {
          staffId: e.staffId,
          name: staffNames[e.staffId]?.name ?? t('calendar.details.therapist'),
          color: staffNames[e.staffId]?.color ?? '#5e7d6b',
          turns: e.turns,
          status,
        }
      })
    }

    return {
      slug: ctx.tenant.slug,
      date,
      today,
      branchId: branch.id,
      branches: branchRows.map((b) => ({ id: b.id, name: b.name })),
      view: q.view === 'rooms' && !ownOnly ? 'rooms' : 'staff',
      showCancelled: q.cancelled === '1',
      dayStartMs: dayStart,
      cutoffMin,
      gridStart,
      gridEnd,
      staff: staffCols,
      rooms: roomCols,
      staffNames,
      items,
      variants,
      rotation,
      canManage,
      canCheckout: can(ctx, 'pos.use'),
      ownOnly,
      checkoutBase: appPath(`/${ctx.tenant.slug}/sales/new`),
      calendarBase: appPath(`/${ctx.tenant.slug}/calendar`),
    }
  })
}
