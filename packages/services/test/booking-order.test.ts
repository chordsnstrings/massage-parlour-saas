// R32 booking ↔ sale order: fee + planned commission, Finish (sale + commission in one tx), Correct payment, day lock.
import { dubaiInstant } from '@spa/core'
import {
  bookingCommissions,
  bookingItems,
  bookings,
  branches,
  clients,
  closeAllDbs,
  dayCloses,
  giftCards,
  journalEntries,
  reservations,
  rooms,
  sales,
  services,
  serviceVariants,
  staff,
  tenants,
  withTenant,
} from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { and, eq, ne } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  accountTotals,
  closeDay,
  completeBooking,
  correctBookingOrder,
  createBooking,
  createSale,
  DAY_CLOSED,
  deleteBooking,
  finishBooking,
  lastBookingTerms,
  markDayAmended,
  orderDay,
  recordOrderCommissions,
  setBookingDetails,
  setBookingStatus,
  setBookingTerms,
  voidSale,
} from '../src'

const { platform, app } = testDbs()
const D = '2026-10-06'
const NOW = dubaiInstant(D, 23 * 60)
const ids = {} as Record<string, string>
const tx = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(ids.tenant!, fn, app)
const base = () => ({ tenantId: ids.tenant!, branchId: ids.branch! })
const bal = async (code: string) =>
  (await tx((db) => accountTotals(db, ids.tenant!, null, '2030-01-01'))).find((a) => a.code === code)
    ?.balance ?? 0

const slots = new Map<string, number>()
/** A confirmed one-treatment booking for Maya (each at its own time of its business day, so holds never overlap). */
async function book(
  o: Partial<Parameters<typeof createBooking>[1]> & { date?: string; fee?: number; commission?: number } = {},
) {
  const date = o.date ?? D
  const n = slots.get(date) ?? 0
  slots.set(date, n + 1)
  const start = dubaiInstant(date, 5 * 60 + n * 62)
  const b = await tx((db) =>
    createBooking(db, {
      ...base(),
      clientId: ids.client,
      source: o.source ?? 'phone',
      status: o.status ?? 'confirmed',
      allowOffShift: true,
      phoneLine: o.phoneLine,
      clientType: o.clientType,
      ownLead: o.ownLead,
      items: [
        {
          serviceVariantId: ids.variant!,
          start,
          staffIds: [ids.maya!],
          roomId: ids.room,
          feeAed: o.fee,
          commissionAed: o.commission,
        },
      ],
    }),
  )
  const [item] = await tx((db) => db.select().from(bookingItems).where(eq(bookingItems.bookingId, b.id)))
  return { ...b, item: item! }
}
const line = (price: number) => ({
  kind: 'service' as const,
  refId: ids.variant,
  description: 'Thai massage 60 min',
  qty: 1,
  unitPriceAed: price,
  staffId: ids.maya,
})
const finish = (
  b: { id: string },
  o: {
    price?: number
    date?: Date
    commission?: number
    tip?: number
    allowClosedDay?: boolean
    commissionLater?: boolean
  } = {},
) =>
  tx((db) =>
    finishBooking(db, {
      ...base(),
      allowClosedDay: o.allowClosedDay,
      commissionLater: o.commissionLater,
      bookingId: b.id,
      lines: [line(o.price ?? 150)],
      payments: [{ method: 'card_terminal', amountAed: o.price ?? 150 }],
      tips: o.tip ? [{ staffId: ids.maya!, amountAed: o.tip, method: 'cash' }] : [],
      commissions:
        o.commission === undefined
          ? undefined
          : [
              {
                bookingItemId: (b as { item: { id: string } }).item.id,
                staffId: ids.maya!,
                amountAed: o.commission,
              },
            ],
      now: o.date ?? NOW,
    }),
  )
const commissionOf = async (bookingId: string) =>
  (
    await tx((db) => db.select().from(bookingCommissions).where(eq(bookingCommissions.bookingId, bookingId)))
  ).reduce((s, r) => s + Number(r.amountAed), 0)

beforeAll(async () => {
  await resetTestDatabase()
  const [t] = await platform.insert(tenants).values({ slug: 'order', name: 'Order Spa' }).returning()
  ids.tenant = t!.id
  await tx(async (db) => {
    const [b] = await db
      .insert(branches)
      .values({ ...{ tenantId: ids.tenant! }, name: 'Main', isDefault: true })
      .returning()
    ids.branch = b!.id
    const [s] = await db
      .insert(services)
      .values({ tenantId: ids.tenant!, name: { en: 'Thai massage' }, bufferAfterMin: 0 })
      .returning()
    const [v] = await db
      .insert(serviceVariants)
      .values({ tenantId: ids.tenant!, serviceId: s!.id, durationMin: 60, priceAed: '200' })
      .returning()
    ids.variant = v!.id
    const [m] = await db.insert(staff).values({ tenantId: ids.tenant!, displayName: 'Maya' }).returning()
    ids.maya = m!.id
    // Ploy is paid a sales %, not per booking (R32 review: no booking commission at Finish).
    const [p] = await db
      .insert(staff)
      .values({ tenantId: ids.tenant!, displayName: 'Ploy', payType: 'sales_commission' })
      .returning()
    ids.ploy = p!.id
    const [v2] = await db
      .insert(serviceVariants)
      .values({ tenantId: ids.tenant!, serviceId: s!.id, durationMin: 90, priceAed: '300' })
      .returning()
    ids.variant2 = v2!.id
    const [r] = await db
      .insert(rooms)
      .values({ tenantId: ids.tenant!, branchId: b!.id, name: '4' })
      .returning()
    ids.room = r!.id
    const [c] = await db
      .insert(clients)
      .values({ tenantId: ids.tenant!, name: 'Noor', phoneE164: '971501112233' })
      .returning()
    ids.client = c!.id
  })
})
afterAll(closeAllDbs)

describe('R32 booking fields and terms', () => {
  it('createBooking stores fee, commission, phone line, client type, own lead and when the terms were typed', async () => {
    const b = await book({ fee: 150, commission: 40, phoneLine: 2, clientType: 'regular' })
    expect(b).toMatchObject({ phoneLine: 2, clientType: 'regular', ownLead: false })
    expect(b.item).toMatchObject({ priceAed: '150.00', commissionAed: '40.00' })
    expect(b.item.termsSetAt).toBeInstanceOf(Date)
    // A line is kept only for phone bookings; no fee typed = the list price and no terms time.
    const w = await book({ source: 'walk_in', phoneLine: 3, clientType: 'new', ownLead: true })
    expect(w).toMatchObject({ phoneLine: null, clientType: 'new', ownLead: true })
    expect(w.item).toMatchObject({ priceAed: '200.00', commissionAed: null, termsSetAt: null })
    await expect(book({ fee: 100_001 })).rejects.toThrow('Enter a fee between 0 and 100,000 AED')
    await expect(book({ commission: -1 })).rejects.toThrow('Enter a commission between 0 and 100,000 AED')
  })

  it('lastBookingTerms returns the latest typed fee and commission per treatment', async () => {
    await book({ fee: 170, commission: 45 })
    const last = await tx((db) => lastBookingTerms(db, [ids.variant!, ids.variant!]))
    expect(last.get(ids.variant!)).toEqual({ feeAed: 170, commissionAed: 45 })
    expect((await tx((db) => lastBookingTerms(db, []))).size).toBe(0)
  })

  it('setBookingTerms sets the fee and planned commission until the booking is checked out', async () => {
    const b = await book({ status: 'pending' })
    const r = await tx((db) =>
      setBookingTerms(db, {
        bookingId: b.id,
        items: [{ bookingItemId: b.item.id, feeAed: 180, commissionAed: 50 }],
      }),
    )
    expect(r.before).toEqual([{ bookingItemId: b.item.id, feeAed: 200, commissionAed: null }])
    expect(r.after).toEqual([{ bookingItemId: b.item.id, feeAed: 180, commissionAed: 50 }])
    // Commission left out = kept.
    const kept = await tx((db) =>
      setBookingTerms(db, { bookingId: b.id, items: [{ bookingItemId: b.item.id, feeAed: 190 }] }),
    )
    expect(kept.after[0]).toMatchObject({ feeAed: 190, commissionAed: 50 })
    await expect(
      tx((db) => setBookingTerms(db, { bookingId: b.id, items: [{ bookingItemId: ids.room!, feeAed: 1 }] })),
    ).rejects.toThrow('Treatment not found')
    await tx((db) => setBookingStatus(db, b.id, 'confirmed'))
    await finish(b, { price: 190 })
    await expect(
      tx((db) => setBookingTerms(db, { bookingId: b.id, items: [{ bookingItemId: b.item.id, feeAed: 1 }] })),
    ).rejects.toThrow('This booking was checked out — correct the payment instead')
    const c = await book({ status: 'pending' })
    await tx((db) => setBookingStatus(db, c.id, 'cancelled'))
    await expect(
      tx((db) => setBookingTerms(db, { bookingId: c.id, items: [{ bookingItemId: c.item.id, feeAed: 1 }] })),
    ).rejects.toThrow("Can't change a cancelled booking")
  })

  it('setBookingDetails changes the line (phone only), client type and own lead', async () => {
    const b = await book({ phoneLine: 1 })
    const r = await tx((db) =>
      setBookingDetails(db, { bookingId: b.id, phoneLine: 4, clientType: 'new', ownLead: true }),
    )
    expect(r.before).toEqual({ phoneLine: 1, clientType: null, ownLead: false })
    expect(r.after).toEqual({ phoneLine: 4, clientType: 'new', ownLead: true })
    const w = await book({ source: 'walk_in' })
    expect(
      (
        await tx((db) =>
          setBookingDetails(db, { bookingId: w.id, phoneLine: 2, clientType: null, ownLead: false }),
        )
      ).after.phoneLine,
    ).toBeNull()
  })
})

describe('R32 finish', () => {
  it('creates the linked paid sale, completes the booking and posts the commission (Dr 6010 / Cr 2300)', async () => {
    const b = await book({ fee: 150, commission: 40 })
    const before6010 = await bal('6010')
    const r = await finish(b, { tip: 10 })
    expect(r.sale).toMatchObject({ bookingId: b.id, status: 'paid', businessDate: D, totalAed: '150.00' })
    expect(r.saleDate).toBe(D)
    expect(r.commissions).toEqual([{ bookingItemId: b.item.id, staffId: ids.maya, amountAed: 40 }])
    const [row] = await tx((db) => db.select().from(bookings).where(eq(bookings.id, b.id)))
    expect(row!.status).toBe('completed')
    expect(await commissionOf(b.id)).toBe(40)
    expect((await bal('6010')) - before6010).toBe(40)
    const day = await tx((db) => orderDay(db, b.id))
    expect(day).toMatchObject({ branchId: ids.branch, date: D })
    expect(day.sale?.id).toBe(r.sale.id)
    // A second finish is refused.
    await expect(finish(b)).rejects.toThrow('This booking has already been checked out')
  })

  it('rolls the sale back when the commission is refused (one transaction)', async () => {
    const b = await book({ fee: 150 })
    await expect(finish(b, { commission: 100_001 })).rejects.toThrow(
      'Enter a commission between 0 and 100,000 AED',
    )
    const live = await tx((db) =>
      db
        .select()
        .from(sales)
        .where(and(eq(sales.bookingId, b.id), ne(sales.status, 'void'))),
    )
    expect(live).toHaveLength(0)
    const [row] = await tx((db) => db.select().from(bookings).where(eq(bookings.id, b.id)))
    expect(row!.status).toBe('confirmed')
  })

  it('refuses a missing commission for a therapist paid per booking; the typed one wins and is kept as the plan', async () => {
    const b = await book({ fee: 150 })
    await expect(finish(b)).rejects.toThrow('Enter the commission for every therapist')
    await finish(b, { commission: 35 })
    expect(await commissionOf(b.id)).toBe(35)
    const [item] = await tx((db) => db.select().from(bookingItems).where(eq(bookingItems.id, b.item.id)))
    expect(item!.commissionAed).toBe('35.00')
  })

  it("dates the sale on the booking's own day while open, else today", async () => {
    const yesterday = '2026-10-05'
    const b = await book({ date: yesterday, fee: 150, commission: 30 })
    expect((await finish(b)).saleDate).toBe(yesterday)
    const older = '2026-10-04'
    const c = await book({ date: older, fee: 150, commission: 30 })
    await tx((db) => closeDay(db, { ...base(), date: older, openingFloatAed: 0, countedCashAed: 0 }))
    // Its commission + sheet row land on the closed day: only with pos.correct (allowClosedDay).
    await expect(finish(c)).rejects.toThrow(DAY_CLOSED)
    const r = await finish(c, { allowClosedDay: true })
    expect(r.saleDate).toBe(D)
    expect(r.sale.businessDate).toBe(D)
    expect(r.bookingDayClosed).toBe(true)
    const rows = await tx((db) =>
      db.select().from(bookingCommissions).where(eq(bookingCommissions.bookingId, c.id)),
    )
    expect(rows.map((x) => x.businessDate)).toEqual([older])
  })

  it("finishes a booking the therapist completed herself (G14: 'Not paid yet')", async () => {
    const b = await book({ fee: 150, commission: 30 })
    await tx(async (db) => {
      await setBookingStatus(db, b.id, 'checked_in')
      await setBookingStatus(db, b.id, 'completed')
    })
    const r = await finish(b)
    expect(r.sale.bookingId).toBe(b.id)
    expect(await commissionOf(b.id)).toBe(30)
  })
})

describe('R32 correct payment', () => {
  const journal = (sourceId: string) =>
    tx((db) => db.select().from(journalEntries).where(eq(journalEntries.sourceId, sourceId)))

  it('voids and re-creates the sale on the same business date (append-only) for a new fee', async () => {
    const b = await book({ date: '2026-10-05', fee: 150, commission: 40 })
    const { sale: old } = await finish(b)
    const r = await tx((db) =>
      correctBookingOrder(db, {
        bookingId: b.id,
        reason: 'Same as before',
        payments: [{ method: 'card_terminal', amountAed: 150 }],
        now: NOW,
      }),
    )
    // Nothing changed → no void.
    expect(r.voidedSaleId).toBeNull()
    const [oldLine] = r.before.lines
    const fixed = await tx((db) =>
      correctBookingOrder(db, {
        bookingId: b.id,
        reason: 'Fee was 170',
        lines: [{ saleLineId: oldLine!.saleLineId, unitPriceAed: 170 }],
        payments: [{ method: 'cash', amountAed: 170 }],
        now: NOW,
      }),
    )
    expect(fixed.voidedSaleId).toBe(old.id)
    expect(fixed.sale.businessDate).toBe('2026-10-05')
    expect(fixed.sale.totalAed).toBe('170.00')
    expect(fixed.after.payments).toEqual([{ method: 'cash', amountAed: 170, reference: null }])
    const [voided] = await tx((db) => db.select().from(sales).where(eq(sales.id, old.id)))
    expect(voided).toMatchObject({ status: 'void', voidReason: 'Corrected: Fee was 170' })
    const oldEntries = await journal(old.id)
    expect(oldEntries.some((e) => e.sourceType === 'sale')).toBe(true)
    expect(oldEntries.some((e) => e.sourceType === 'sale_reversal' && e.reversesId)).toBe(true)
    expect(
      oldEntries.filter((e) => e.sourceType === 'sale_reversal').every((e) => e.entryDate === '2026-10-05'),
    ).toBe(true)
    expect((await journal(fixed.sale.id)).some((e) => e.sourceType === 'sale')).toBe(true)
    // The commission was not touched.
    expect(await commissionOf(b.id)).toBe(40)
  })

  it('a tips change keeps tips payable (2200) right; commissions post only the difference', async () => {
    const b = await book({ fee: 150, commission: 40 })
    const tips0 = await bal('2200')
    await finish(b, { tip: 10 })
    const after = await tx((db) =>
      correctBookingOrder(db, {
        bookingId: b.id,
        reason: 'Tip was 25',
        tips: [{ staffId: ids.maya!, amountAed: 25, method: 'cash' }],
        commissions: [{ bookingItemId: b.item.id, staffId: ids.maya!, amountAed: 45 }],
        now: NOW,
      }),
    )
    expect(Math.abs((await bal('2200')) - tips0)).toBe(25)
    expect(after.after.tips).toEqual([{ staffId: ids.maya, amountAed: 25, method: 'cash' }])
    const rows = await tx((db) =>
      db.select().from(bookingCommissions).where(eq(bookingCommissions.bookingId, b.id)),
    )
    expect(rows.map((r) => r.amountAed).sort()).toEqual(['40.00', '5.00'])
    // Commission only (same amount) → nothing posted.
    await tx((db) =>
      correctBookingOrder(db, {
        bookingId: b.id,
        reason: 'Recheck',
        commissions: [{ bookingItemId: b.item.id, staffId: ids.maya!, amountAed: 45 }],
        now: NOW,
      }),
    )
    expect(await commissionOf(b.id)).toBe(45)
  })

  it('needs allowClosedDay on a closed day and refuses gift-card sales; no sale → nothing to correct', async () => {
    const day = '2026-10-03'
    const b = await book({ date: day, fee: 150, commission: 40 })
    await finish(b)
    await tx((db) => closeDay(db, { ...base(), date: day, openingFloatAed: 0, countedCashAed: 0 }))
    const correct = (allowClosedDay?: boolean) =>
      tx((db) =>
        correctBookingOrder(db, {
          bookingId: b.id,
          reason: 'Was cash',
          payments: [{ method: 'cash', amountAed: 150 }],
          allowClosedDay,
          now: NOW,
        }),
      )
    await expect(correct()).rejects.toThrow(DAY_CLOSED)
    const ok = await correct(true)
    expect(ok.sale.businessDate).toBe(day)
    await tx((db) => markDayAmended(db, ids.branch!, day, null))
    const [close] = await tx((db) => db.select().from(dayCloses).where(eq(dayCloses.businessDate, day)))
    expect(close!.amendedAt).toBeInstanceOf(Date)

    const g = await book({ fee: 150, commission: 40 })
    const { sale: card } = await tx((db) =>
      createSale(db, {
        ...base(),
        lines: [{ kind: 'gift_card', description: 'Gift card', qty: 1, unitPriceAed: 150 }],
        payments: [{ method: 'cash', amountAed: 150 }],
        now: NOW,
      }),
    )
    const [{ code }] = (await tx((db) =>
      db.select().from(giftCards).where(eq(giftCards.saleId, card.id)),
    )) as [{ code: string }]
    await tx((db) =>
      finishBooking(db, {
        ...base(),
        bookingId: g.id,
        lines: [line(150)],
        payments: [{ method: 'gift_card', amountAed: 150, reference: code }],
        now: NOW,
      }),
    )
    await expect(
      tx((db) =>
        correctBookingOrder(db, {
          bookingId: g.id,
          reason: 'Paid cash',
          payments: [{ method: 'cash', amountAed: 150 }],
          now: NOW,
        }),
      ),
    ).rejects.toThrow(/can’t be voided/)
    const none = await book({ fee: 150 })
    await expect(
      tx((db) => correctBookingOrder(db, { bookingId: none.id, reason: 'x y z', now: NOW })),
    ).rejects.toThrow('This booking has no payment to correct')
    await expect(
      tx((db) => correctBookingOrder(db, { bookingId: g.id, reason: 'x', now: NOW })),
    ).rejects.toThrow('Give a reason for the correction')
  })
})

describe('R32 day lock', () => {
  it('refuses new money on a closed day unless allowed', async () => {
    const day = '2026-10-02'
    await tx((db) => closeDay(db, { ...base(), date: day, openingFloatAed: 0, countedCashAed: 0 }))
    const sell = (allowClosedDay?: boolean) =>
      tx((db) =>
        createSale(db, {
          ...base(),
          lines: [{ kind: 'other', description: 'Oil', qty: 1, unitPriceAed: 20 }],
          payments: [{ method: 'cash', amountAed: 20 }],
          businessDate: day,
          allowClosedDay,
          now: NOW,
        }),
      )
    await expect(sell()).rejects.toThrow(DAY_CLOSED)
    expect((await sell(true)).sale.businessDate).toBe(day)
    await expect(
      tx((db) =>
        createSale(db, {
          ...base(),
          lines: [{ kind: 'other', description: 'Oil', qty: 1, unitPriceAed: 20 }],
          payments: [{ method: 'cash', amountAed: 20 }],
          businessDate: '2026-10-09',
          now: NOW,
        }),
      ),
    ).rejects.toThrow('That business day has not started yet')
  })
})

/** A confirmed one-treatment booking for another therapist / treatment (on a day of its own, one after another). */
const EXTRA_DAY = '2026-09-28'
let extra = 0
async function bookFor(o: { staffIds: string[]; variant?: string; fee?: number; commission?: number }) {
  const start = dubaiInstant(EXTRA_DAY, 6 * 60 + extra++ * 95)
  const b = await tx((db) =>
    createBooking(db, {
      ...base(),
      clientId: ids.client,
      source: 'phone',
      status: 'confirmed',
      allowOffShift: true,
      items: [
        {
          serviceVariantId: o.variant ?? ids.variant!,
          start,
          staffIds: o.staffIds,
          roomId: ids.room,
          feeAed: o.fee,
          commissionAed: o.commission,
        },
      ],
    }),
  )
  const [item] = await tx((db) => db.select().from(bookingItems).where(eq(bookingItems.bookingId, b.id)))
  return { ...b, item: item! }
}
const itemOf = async (id: string) =>
  (await tx((db) => db.select().from(bookingItems).where(eq(bookingItems.id, id))))[0]!

describe('R32 review: commission at Finish', () => {
  it('a therapist not paid per booking gets none, whatever is planned or typed (no double pay with her %)', async () => {
    const b = await bookFor({ staffIds: [ids.ploy!], fee: 150, commission: 40 })
    const r = await tx((db) =>
      finishBooking(db, {
        ...base(),
        bookingId: b.id,
        lines: [{ ...line(150), staffId: ids.ploy }],
        payments: [{ method: 'cash', amountAed: 150 }],
        commissions: [{ bookingItemId: b.item.id, staffId: ids.ploy!, amountAed: 40 }],
        now: NOW,
      }),
    )
    expect(r.commissions).toEqual([{ bookingItemId: b.item.id, staffId: ids.ploy, amountAed: 0 }])
    expect(await commissionOf(b.id)).toBe(0)
    // Her 0 is not a plan: the treatment's planned amount stays as typed.
    expect((await itemOf(b.item.id)).commissionAed).toBe('40.00')
    // Nothing planned or typed: no refusal either.
    const c = await bookFor({ staffIds: [ids.ploy!], fee: 150 })
    await tx((db) =>
      finishBooking(db, {
        ...base(),
        bookingId: c.id,
        lines: [{ ...line(150), staffId: ids.ploy }],
        payments: [{ method: 'cash', amountAed: 150 }],
        now: NOW,
      }),
    )
    expect(await commissionOf(c.id)).toBe(0)
  })

  it('finishing again after a void keeps the commission saved since (not the old plan)', async () => {
    const b = await book({ fee: 150, commission: 40 })
    const { sale } = await finish(b)
    await tx((db) =>
      recordOrderCommissions(db, {
        bookingId: b.id,
        amounts: [{ bookingItemId: b.item.id, staffId: ids.maya!, amountAed: 50 }],
        now: NOW,
      }),
    )
    // The plan mirrors the saved commission.
    expect((await itemOf(b.item.id)).commissionAed).toBe('50.00')
    await tx((db) => voidSale(db, { saleId: sale.id, reason: 'Wrong client' }))
    await finish(b)
    expect(await commissionOf(b.id)).toBe(50)
    const rows = await tx((db) =>
      db.select().from(bookingCommissions).where(eq(bookingCommissions.bookingId, b.id)),
    )
    expect(rows.map((x) => x.amountAed).sort()).toEqual(['10.00', '40.00'])
  })

  it('a legacy completion (commission recorded, nothing planned) keeps its commission at Finish', async () => {
    const b = await book({ fee: 150 })
    await tx((db) =>
      completeBooking(db, {
        bookingId: b.id,
        amounts: [{ bookingItemId: b.item.id, staffId: ids.maya!, amountAed: 45 }],
        now: NOW,
      }),
    )
    await finish(b)
    expect(await commissionOf(b.id)).toBe(45)
  })

  it('commissionLater (no commission rights): finished without commission when none is known', async () => {
    const b = await book({ fee: 150 })
    await expect(finish(b)).rejects.toThrow('Enter the commission for every therapist')
    const r = await finish(b, { commissionLater: true })
    expect(r.commissions).toEqual([])
    expect(r.sale.bookingId).toBe(b.id)
    expect(
      await tx((db) => db.select().from(bookingCommissions).where(eq(bookingCommissions.bookingId, b.id))),
    ).toHaveLength(0)
    // A planned amount is still posted.
    const c = await book({ fee: 150, commission: 30 })
    await finish(c, { commissionLater: true })
    expect(await commissionOf(c.id)).toBe(30)
  })
})

describe('R32 review: fee, references, details, closed booking day', () => {
  it('Finish and Correct payment write the fee charged back; the "last used" prefill is per treatment', async () => {
    const b = await book({ fee: 150, commission: 40 })
    // Reception changed the line price at checkout (real time, after the bookings above were typed).
    await finish(b, { price: 160, date: new Date() })
    expect((await itemOf(b.item.id)).priceAed).toBe('160.00')
    expect((await tx((db) => lastBookingTerms(db, [ids.variant!]))).get(ids.variant!)?.feeAed).toBe(160)
    const [saleLine] = (
      await tx((db) => correctBookingOrder(db, { bookingId: b.id, reason: 'Check', now: new Date() }))
    ).before.lines
    await tx((db) =>
      correctBookingOrder(db, {
        bookingId: b.id,
        reason: 'Fee was 170',
        lines: [{ saleLineId: saleLine!.saleLineId, unitPriceAed: 170 }],
        payments: [{ method: 'card_terminal', amountAed: 170 }],
        now: new Date(),
      }),
    )
    expect((await itemOf(b.item.id)).priceAed).toBe('170.00')
    const v2 = await bookFor({ staffIds: [ids.maya!], variant: ids.variant2, fee: 300, commission: 60 })
    expect(v2.item.priceAed).toBe('300.00')
    const last = await tx((db) => lastBookingTerms(db, [ids.variant!, ids.variant2!]))
    expect(last.get(ids.variant!)).toEqual({ feeAed: 170, commissionAed: 40 })
    expect(last.get(ids.variant2!)).toEqual({ feeAed: 300, commissionAed: 60 })
  })

  it('Correct payment keeps the payment references (transfer / card slip)', async () => {
    const b = await book({ fee: 150, commission: 40 })
    await tx((db) =>
      finishBooking(db, {
        ...base(),
        bookingId: b.id,
        lines: [line(150)],
        payments: [{ method: 'bank_transfer', amountAed: 150, reference: 'TRX-123' }],
        now: NOW,
      }),
    )
    const tipOnly = await tx((db) =>
      correctBookingOrder(db, {
        bookingId: b.id,
        reason: 'Tip was 10',
        tips: [{ staffId: ids.maya!, amountAed: 10, method: 'cash' }],
        now: NOW,
      }),
    )
    expect(tipOnly.voidedSaleId).toBeTruthy()
    expect(tipOnly.after.payments).toEqual([
      { method: 'bank_transfer', amountAed: 150, reference: 'TRX-123' },
    ])
    // Sent without its reference (same method + amount): kept as well.
    const again = await tx((db) =>
      correctBookingOrder(db, {
        bookingId: b.id,
        reason: 'Tip was 15',
        payments: [{ method: 'bank_transfer', amountAed: 150 }],
        tips: [{ staffId: ids.maya!, amountAed: 15, method: 'cash' }],
        now: NOW,
      }),
    )
    expect(again.after.payments[0]?.reference).toBe('TRX-123')
  })

  it('a walk-in keeps the own client it started with (her rotation turn); an own client needs a therapist', async () => {
    const w = await book({ source: 'walk_in' })
    await expect(
      tx((db) =>
        setBookingDetails(db, { bookingId: w.id, phoneLine: null, clientType: null, ownLead: true }),
      ),
    ).rejects.toThrow('Own client is set when the walk-in starts')
    const ok = await tx((db) =>
      setBookingDetails(db, { bookingId: w.id, phoneLine: null, clientType: 'new', ownLead: false }),
    )
    expect(ok.after).toEqual({ phoneLine: null, clientType: 'new', ownLead: false })
    // An item left without a therapist (e.g. she was taken off it).
    const n = await bookFor({ staffIds: [ids.maya!] })
    await tx((db) => db.update(bookingItems).set({ staffIds: [] }).where(eq(bookingItems.id, n.item.id)))
    await expect(
      tx((db) =>
        setBookingDetails(db, { bookingId: n.id, phoneLine: null, clientType: null, ownLead: true }),
      ),
    ).rejects.toThrow('Choose the therapist for her own client')
  })

  it('a commission change on a closed booking day needs allowClosedDay even when the sale is on an open day', async () => {
    const day = '2026-10-01'
    const b = await book({ date: day, fee: 150, commission: 30 })
    await tx((db) => closeDay(db, { ...base(), date: day, openingFloatAed: 0, countedCashAed: 0 }))
    expect((await finish(b, { allowClosedDay: true })).saleDate).toBe(D)
    const correct = (o: { commission?: number; tip?: number; allowClosedDay?: boolean }) =>
      tx((db) =>
        correctBookingOrder(db, {
          bookingId: b.id,
          reason: 'Correction',
          tips: o.tip ? [{ staffId: ids.maya!, amountAed: o.tip, method: 'cash' }] : undefined,
          commissions:
            o.commission === undefined
              ? undefined
              : [{ bookingItemId: b.item.id, staffId: ids.maya!, amountAed: o.commission }],
          allowClosedDay: o.allowClosedDay,
          now: NOW,
        }),
      )
    await expect(correct({ commission: 35 })).rejects.toThrow(DAY_CLOSED)
    // The money of the open sale day still changes; the same commission is no change.
    expect((await correct({ tip: 5, commission: 30 })).voidedSaleId).toBeTruthy()
    await correct({ commission: 35, allowClosedDay: true })
    expect(await commissionOf(b.id)).toBe(35)
  })
})

describe('deleteBooking (R39)', () => {
  it('deletes a booking with no money: items and reserved time go with it', async () => {
    const b = await book({ fee: 150, commission: 40 })
    const gone = await tx((db) => deleteBooking(db, b.id))
    expect(gone.id).toBe(b.id)
    expect(await tx((db) => db.select().from(bookings).where(eq(bookings.id, b.id)))).toHaveLength(0)
    expect(
      await tx((db) => db.select().from(bookingItems).where(eq(bookingItems.bookingId, b.id))),
    ).toHaveLength(0)
    expect(
      await tx((db) => db.select().from(reservations).where(eq(reservations.bookingItemId, b.item.id))),
    ).toHaveLength(0)
    await expect(tx((db) => deleteBooking(db, b.id))).rejects.toThrow('Booking not found')
  })

  it('deletes a cancelled booking', async () => {
    const b = await book()
    await tx((db) => setBookingStatus(db, b.id, 'cancelled', 'test'))
    await tx((db) => deleteBooking(db, b.id))
    expect(await tx((db) => db.select().from(bookings).where(eq(bookings.id, b.id)))).toHaveLength(0)
  })

  it('refuses a booking with a sale or commission, also after the sale is voided', async () => {
    const b = await book({ fee: 150, commission: 40 })
    const r = await finish(b)
    await expect(tx((db) => deleteBooking(db, b.id))).rejects.toThrow('cancel it instead')
    await tx((db) => voidSale(db, { saleId: r.sale.id, reason: 'Wrong client' }))
    // The commission rows are append-only history: the booking stays (cancel it instead).
    await expect(tx((db) => deleteBooking(db, b.id))).rejects.toThrow('cancel it instead')
    expect(await tx((db) => db.select().from(bookings).where(eq(bookings.id, b.id)))).toHaveLength(1)
  })
})
