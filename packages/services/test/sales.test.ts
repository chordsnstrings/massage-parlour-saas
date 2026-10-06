import { businessDateOf, dubaiInstant } from '@spa/core'
import {
  bookings,
  branches,
  clientPackages,
  clients,
  closeAllDbs,
  commissionEntries,
  counters,
  giftCards,
  journalLines,
  outbox,
  packageDefinitions,
  products,
  rooms,
  services,
  serviceVariants,
  staff,
  stockLevels,
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
  profitAndLoss,
  receiveStock,
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

describe('sales of products, packages and gift cards', () => {
  const D2 = '2026-10-20'
  const at = dubaiInstant(D2, 12 * 60)

  it('sells retail stock at cost of goods and puts it back on void', async () => {
    const productId = await tx(async (db) => {
      const [p] = await db
        .insert(products)
        .values({ tenantId: ids.tenant!, kind: 'retail', name: { en: 'Body oil' }, priceAed: '105' })
        .returning()
      await receiveStock(db, {
        ...base(),
        productId: p!.id,
        qty: 10,
        unitCostAed: 40,
        paidVia: 'cash',
        date: D2,
      })
      return p!.id
    })
    const { sale } = await tx((db) =>
      createSale(db, {
        ...base(),
        lines: [{ kind: 'product', refId: productId, description: 'Body oil', qty: 2, unitPriceAed: 105 }],
        payments: [{ method: 'cash', amountAed: 210 }],
        now: at,
      }),
    )
    const qty = async () =>
      Number(
        (await tx((db) => db.select().from(stockLevels).where(eq(stockLevels.productId, productId))))[0]!.qty,
      )
    expect(await qty()).toBe(8)
    const pl = await tx((db) => profitAndLoss(db, ids.tenant!, D2, D2))
    expect(pl.revenue.find((a) => a.code === '4100')?.balance).toBe(200)
    expect(pl.expenses.find((a) => a.code === '5000')?.balance).toBe(80)
    await tx((db) => voidSale(db, { saleId: sale.id, reason: 'Wrong item' }))
    expect(await qty()).toBe(10)
  })

  it('sells a package (no VAT until used), then redeems a session at zero price', async () => {
    const defId = await tx(async (db) => {
      const [svc] = await db.select().from(serviceVariants).where(eq(serviceVariants.id, ids.variant!))
      const [d] = await db
        .insert(packageDefinitions)
        .values({
          tenantId: ids.tenant!,
          name: { en: '5 × Swedish' },
          priceAed: '1500',
          items: [{ serviceId: svc!.serviceId, quantity: 5 }],
        })
        .returning()
      return d!.id
    })
    await expect(
      tx((db) =>
        createSale(db, {
          ...base(),
          lines: [{ kind: 'package', refId: defId, description: '5 × Swedish', qty: 1, unitPriceAed: 1500 }],
          payments: [{ method: 'cash', amountAed: 1500 }],
          now: at,
        }),
      ),
    ).rejects.toThrow(/client/)
    const { sale } = await tx((db) =>
      createSale(db, {
        ...base(),
        clientId: ids.client,
        lines: [{ kind: 'package', refId: defId, description: '5 × Swedish', qty: 1, unitPriceAed: 1500 }],
        payments: [{ method: 'bank_transfer', amountAed: 1500 }],
        now: at,
      }),
    )
    expect(Number(sale.vatAed)).toBe(0)
    const [pkg] = await tx((db) => db.select().from(clientPackages).where(eq(clientPackages.saleId, sale.id)))
    expect(Object.values(pkg!.balances)).toEqual([5])

    await expect(
      tx((db) =>
        createSale(db, {
          ...base(),
          clientId: ids.client,
          lines: [{ ...swedish(ids.maya), refId: ids.variant, clientPackageId: pkg!.id }],
          payments: [{ method: 'cash', amountAed: 350 }],
          now: at,
        }),
      ),
    ).rejects.toThrow(/price must be 0/)
    const { sale: used } = await tx((db) =>
      createSale(db, {
        ...base(),
        clientId: ids.client,
        lines: [{ ...swedish(ids.maya), refId: ids.variant, unitPriceAed: 0, clientPackageId: pkg!.id }],
        payments: [],
        now: at,
      }),
    )
    const [after] = await tx((db) => db.select().from(clientPackages).where(eq(clientPackages.id, pkg!.id)))
    expect(Object.values(after!.balances)).toEqual([4])
    expect(Number(after!.remainingValueAed)).toBe(1200)
    // Maya earns 10% of the session value net of VAT (300 / 1.05 = 285.71 → 28.57).
    const earned = await tx((db) =>
      db.select().from(commissionEntries).where(eq(commissionEntries.staffId, ids.maya!)),
    )
    expect(earned.some((c) => c.amountAed === '28.57')).toBe(true)
    await expect(tx((db) => voidSale(db, { saleId: used.id, reason: 'Mistake' }))).rejects.toThrow(/refund/)
  })

  it('sells a gift card and takes it as payment until the balance runs out', async () => {
    const { sale } = await tx((db) =>
      createSale(db, {
        ...base(),
        lines: [{ kind: 'gift_card', description: 'Gift card — Sara', qty: 1, unitPriceAed: 500 }],
        payments: [{ method: 'card_terminal', amountAed: 500 }],
        now: at,
      }),
    )
    const [card] = await tx((db) => db.select().from(giftCards).where(eq(giftCards.saleId, sale.id)))
    expect(card).toMatchObject({ initialAed: '500.00', recipientName: 'Sara' })
    await tx((db) =>
      createSale(db, {
        ...base(),
        lines: [swedish(ids.maya)],
        payments: [{ method: 'gift_card', amountAed: 350, reference: card!.code.toLowerCase() }],
        now: at,
      }),
    )
    await expect(
      tx((db) =>
        createSale(db, {
          ...base(),
          lines: [swedish(ids.maya)],
          payments: [{ method: 'gift_card', amountAed: 350, reference: card!.code }],
          now: at,
        }),
      ),
    ).rejects.toThrow(/Only AED 150.00 left/)
    const [left] = await tx((db) => db.select().from(giftCards).where(eq(giftCards.id, card!.id)))
    expect(left!.balanceAed).toBe('150.00')
  })
})
