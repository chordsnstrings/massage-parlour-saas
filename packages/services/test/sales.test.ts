import { businessDateOf, dubaiInstant } from '@spa/core'
import {
  bookings,
  branches,
  clients,
  closeAllDbs,
  commissionEntries,
  counters,
  journalLines,
  outbox,
  rooms,
  services,
  serviceVariants,
  staff,
  tenants,
  withTenant,
} from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  closeDay,
  createBooking,
  createSale,
  DomainError,
  daySummary,
  nextCounter,
  refundSale,
  voidSale,
} from '../src'

const { platform, app } = testDbs()
const D = '2026-10-06'
// 01:30 Dubai on the 7th still belongs to the 6th's business day (05:00 cutoff).
const LATE = dubaiInstant(D, 25 * 60 + 30)
const NOON = dubaiInstant(D, 12 * 60)
const ids = {} as Record<string, string>
const tx = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(ids.tenant!, fn, app)
const base = () => ({ tenantId: ids.tenant!, branchId: ids.branch! })
const swedish = (staffId?: string) => ({
  kind: 'service' as const,
  description: 'Swedish massage 60 min',
  qty: 1,
  unitPriceAed: 350,
  staffId,
})

beforeAll(async () => {
  await resetTestDatabase()
  const [t] = await platform.insert(tenants).values({ slug: 'till', name: 'Till Spa' }).returning()
  ids.tenant = t!.id
  await tx(async (db) => {
    const [b] = await db
      .insert(branches)
      .values({ tenantId: ids.tenant!, name: 'Marina', isDefault: true })
      .returning()
    ids.branch = b!.id
    const [s] = await db
      .insert(services)
      .values({ tenantId: ids.tenant!, name: { en: 'Swedish massage' } })
      .returning()
    const [v] = await db
      .insert(serviceVariants)
      .values({ tenantId: ids.tenant!, serviceId: s!.id, durationMin: 60, priceAed: '350' })
      .returning()
    ids.variant = v!.id
    const [p] = await db
      .insert(staff)
      .values({ tenantId: ids.tenant!, displayName: 'Maya', commissionPct: '10' })
      .returning()
    ids.maya = p!.id
    const [r] = await db
      .insert(rooms)
      .values({ tenantId: ids.tenant!, branchId: b!.id, name: 'Room 1' })
      .returning()
    ids.room = r!.id
    const [c] = await db
      .insert(clients)
      .values({ tenantId: ids.tenant!, name: 'Fatima', phoneE164: '971501234567' })
      .returning()
    ids.client = c!.id
  })
})
afterAll(closeAllDbs)

describe('sales', () => {
  it('numbers sales from the counters table, creating the row on first use', async () => {
    const [a, b] = await tx(async (db) => [
      await nextCounter(db, ids.tenant!, 'test'),
      await nextCounter(db, ids.tenant!, 'test'),
    ])
    expect([a, b]).toEqual([1, 2])
  })

  it('records a split-payment sale with discounts, VAT included and tips; late night counts for the day', async () => {
    const { sale, lines } = await tx((db) =>
      createSale(db, {
        ...base(),
        clientId: ids.client,
        lines: [
          { ...swedish(ids.maya), discountAed: 20 },
          { kind: 'other', description: 'Hot stones', qty: 2, unitPriceAed: 50 },
        ],
        discountAed: 30,
        payments: [
          { method: 'cash', amountAed: 200 },
          { method: 'card_terminal', amountAed: 200, reference: '0042' },
        ],
        tips: [{ staffId: ids.maya!, amountAed: 20, method: 'cash' }],
        now: LATE,
      }),
    )
    expect(sale.number).toBe(1)
    expect(sale.businessDate).toBe(D)
    expect(sale.subtotalAed).toBe('430.00')
    expect(sale.totalAed).toBe('400.00')
    expect(sale.tipsAed).toBe('20.00')
    expect(lines.reduce((s, l) => s + Number(l.lineTotalAed), 0)).toBe(400)
    expect(Number(sale.vatAed)).toBeCloseTo(19.05, 2)
    const ledger = await tx((db) =>
      db.select({ d: sql<string>`sum(debit_aed)`, c: sql<string>`sum(credit_aed)` }).from(journalLines),
    )
    expect(ledger[0]!.d).toBe(ledger[0]!.c)
    const comm = await tx((db) => db.select().from(commissionEntries))
    expect(comm).toHaveLength(1)
  })

  it('rejects payments that do not match the total', async () => {
    await expect(
      tx((db) =>
        createSale(db, {
          ...base(),
          lines: [swedish()],
          payments: [{ method: 'cash', amountAed: 300 }],
          now: NOON,
        }),
      ),
    ).rejects.toThrow(/50.00 still to pay/)
    await expect(
      tx((db) =>
        createSale(db, {
          ...base(),
          lines: [swedish()],
          payments: [{ method: 'cash', amountAed: 400 }],
          now: NOON,
        }),
      ),
    ).rejects.toBeInstanceOf(DomainError)
  })

  it('checks out a booking: completes it and queues the WhatsApp thank-you', async () => {
    const booking = await tx((db) =>
      createBooking(db, {
        tenantId: ids.tenant!,
        branchId: ids.branch!,
        clientId: ids.client,
        source: 'phone',
        status: 'confirmed',
        allowOffShift: true,
        items: [{ serviceVariantId: ids.variant!, start: NOON, staffIds: [ids.maya!], roomId: ids.room }],
      }),
    )
    const bookingId = booking.id
    const { sale, message } = await tx((db) =>
      createSale(db, {
        ...base(),
        bookingId,
        lines: [swedish(ids.maya)],
        payments: [{ method: 'card_terminal', amountAed: 350 }],
        now: NOON,
      }),
    )
    expect(sale.clientId).toBe(ids.client)
    expect(message?.kind).toBe('thank_you')
    const [b] = await tx((db) => db.select().from(bookings).where(eq(bookings.id, bookingId)))
    expect(b!.status).toBe('completed')
    const queued = await tx((db) => db.select().from(outbox).where(eq(outbox.bookingId, bookingId)))
    expect(queued.map((q) => q.kind)).toContain('thank_you')
    await expect(
      tx((db) =>
        createSale(db, {
          ...base(),
          bookingId,
          lines: [swedish()],
          payments: [{ method: 'cash', amountAed: 350 }],
          now: NOON,
        }),
      ),
    ).rejects.toThrow(/can't be checked out|already/)
  })

  it('voids and refunds, and the day summary / close reflect them', async () => {
    const { sale: voided } = await tx((db) =>
      createSale(db, {
        ...base(),
        lines: [swedish()],
        payments: [{ method: 'cash', amountAed: 350 }],
        now: NOON,
      }),
    )
    await tx((db) => voidSale(db, { saleId: voided.id, reason: 'Wrong client' }))
    await expect(tx((db) => voidSale(db, { saleId: voided.id, reason: 'again' }))).rejects.toThrow(
      /already void/,
    )

    const { sale: refunded } = await tx((db) =>
      createSale(db, {
        ...base(),
        lines: [swedish()],
        payments: [{ method: 'cash', amountAed: 350 }],
        now: NOON,
      }),
    )
    await tx((db) =>
      refundSale(db, {
        saleId: refunded.id,
        amountAed: 50,
        method: 'cash',
        reason: 'Short session',
        now: NOON,
      }),
    )
    await expect(
      tx((db) =>
        refundSale(db, {
          saleId: refunded.id,
          amountAed: 301,
          method: 'cash',
          reason: 'Too much',
          now: NOON,
        }),
      ),
    ).rejects.toThrow(/At most AED 300.00/)

    const s = await tx((db) => daySummary(db, ids.branch!, D, 100))
    expect(s.salesCount).toBe(3) // split sale + booking checkout + refunded sale (void excluded)
    expect(s.voidCount).toBe(1)
    expect(s.revenueAed).toBe(1100)
    expect(s.paymentsByMethod).toEqual({ cash: 550, card_terminal: 550 })
    expect(s.tipsByStaff).toEqual([{ staffId: ids.maya, name: 'Maya', amountAed: 20 }])
    expect(s.refundsAed).toBe(50)
    // 100 float + 550 cash + 20 cash tips − 50 cash refund
    expect(s.expectedCashAed).toBe(620)

    const close = await tx((db) =>
      closeDay(db, { ...base(), date: D, openingFloatAed: 100, countedCashAed: 615, notes: 'short 5' }),
    )
    expect(close.varianceAed).toBe('-5.00')
    expect(close.totals.pay_cash).toBe('550.00')
    await expect(
      tx((db) => closeDay(db, { ...base(), date: D, openingFloatAed: 100, countedCashAed: 620 })),
    ).rejects.toThrow(/already closed/)
    // Closed day: void no longer allowed, a refund is.
    await expect(tx((db) => voidSale(db, { saleId: refunded.id, reason: 'late' }))).rejects.toThrow()
    const c = await tx((db) => db.select().from(counters).where(eq(counters.key, 'sale')))
    expect(c[0]!.value).toBe(4)
  })

  it('isolates summaries by business date', async () => {
    const next = businessDateOf(dubaiInstant(D, 30 * 60), '05:00')
    const s = await tx((db) => daySummary(db, ids.branch!, next))
    expect(s.salesCount).toBe(0)
    expect(s.expectedCashAed).toBe(0)
  })
})
