// Booking checkout prefill (R32 Finish; R45 Complete & pay pop-up): one line per item × therapist with the agreed fee,
// the client, and the commission per therapist paid per booking. Shared by /sales/new and the pay pop-up.
import { bookingItems, type bookings, clients, sales, staff, type Tx } from '@spa/db'
import { commissionTotals, isDayClosed, lastBookingTerms } from '@spa/services'
import { and, asc, eq, inArray, ne } from 'drizzle-orm'
import { maskPhone } from '@/components/calendar/time'
import type { CheckoutCommission, CheckoutLine } from '@/components/pos/checkout'
import { can, type MemberContext } from '@/server/access'

/** R32 (D7): a booking the therapist completed (G14) or whose sale was voided is finished too. */
export const CHECKOUT_OK = ['confirmed', 'checked_in', 'in_service', 'completed']

export type BookingPrefill = {
  bookingId: string
  ref: string
  status: string
  /** R32: already finished (a live sale is linked) — checkout is refused. */
  paid: boolean
  /** R32 (D6): the booking's business day is closed and this member may not change it. */
  dayLocked: boolean
  client: { id: string; name: string; phone: string | null } | null
  lines: CheckoutLine[]
  commissions: CheckoutCommission[]
}

export async function bookingPrefill(
  tx: Tx,
  ctx: MemberContext,
  booking: typeof bookings.$inferSelect,
): Promise<BookingPrefill> {
  const seePhone = can(ctx, 'clients.phone')
  const items = await tx
    .select()
    .from(bookingItems)
    .where(eq(bookingItems.bookingId, booking.id))
    .orderBy(asc(bookingItems.startsAt))
  const [client] = booking.clientId
    ? await tx
        .select({ id: clients.id, name: clients.name, phone: clients.phoneE164 })
        .from(clients)
        .where(eq(clients.id, booking.clientId))
    : []
  const [live] = await tx
    .select({ id: sales.id })
    .from(sales)
    .where(and(eq(sales.bookingId, booking.id), ne(sales.status, 'void')))
  // Commission per item × therapist (same rules as finishBooking): only therapists paid per booking get a field
  // (sales %, salary and booking-fee staff get none); prefilled with what is already recorded (a voided sale, a
  // legacy completion), else the planned amount, else the last typed for the treatment, else blank.
  const last = await lastBookingTerms(
    tx,
    items.flatMap((it) => (it.serviceVariantId ? [it.serviceVariantId] : [])),
  )
  const recorded = await commissionTotals(tx, booking.id)
  const ids = [...new Set(items.flatMap((it) => it.staffIds))]
  const people = new Map(
    (ids.length
      ? await tx
          .select({ id: staff.id, name: staff.displayName, payType: staff.payType })
          .from(staff)
          .where(inArray(staff.id, ids))
      : []
    ).map((p) => [p.id, p]),
  )
  const commissions: CheckoutCommission[] = items.flatMap((it) =>
    it.staffIds.flatMap((sid) => {
      const person = people.get(sid)
      if (person && person.payType !== 'booking_commission') return []
      const had = recorded.get(`${it.id}:${sid}`)
      const planned =
        had !== undefined
          ? had / 100
          : it.commissionAed != null
            ? Number(it.commissionAed)
            : (last.get(it.serviceVariantId ?? '')?.commissionAed ?? null)
      return [
        {
          bookingItemId: it.id,
          staffId: sid,
          name: person?.name ?? '—',
          service: it.serviceName,
          amountAed: planned ?? '',
        },
      ]
    }),
  )
  const dayLocked =
    !can(ctx, 'pos.correct') && (await isDayClosed(tx, booking.branchId, booking.businessDate))
  return {
    bookingId: booking.id,
    ref: booking.refCode,
    status: booking.status,
    paid: Boolean(live),
    dayLocked,
    commissions,
    client: client
      ? {
          id: client.id,
          name: client.name,
          phone: client.phone ? (seePhone ? `+${client.phone}` : maskPhone(client.phone)) : null,
        }
      : null,
    // One line per therapist so tips and commission land with the right person.
    lines: items.flatMap((it) => {
      const people = it.staffIds.length ? it.staffIds : [null]
      // "Price on request" (R4): no list price — every therapist's line is typed at checkout.
      const priceless = it.priceAed == null
      const total = Math.round(Number(it.priceAed ?? 0) * 100)
      const share = Math.floor(total / people.length)
      return people.map((sid, i) => ({
        key: `${it.id}-${i}`,
        kind: 'service' as const,
        refId: it.serviceVariantId,
        description: `${it.serviceName} · ${it.durationMin} min`,
        qty: 1,
        unitPriceAed: priceless
          ? ''
          : (i === people.length - 1 ? total - share * (people.length - 1) : share) / 100,
        priceRequired: priceless,
        discountAed: 0,
        staffId: sid,
      }))
    }),
  }
}
