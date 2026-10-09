import { businessDateOf, dubaiInstant } from '@spa/core'
import {
  bookingItems,
  bookings,
  branches,
  clientPackages,
  clients,
  closeAllDbs,
  commissionEntries,
  counters,
  giftCards,
  giftCardTxns,
  journalEntries,
  journalLines,
  ledgerAccounts,
  outbox,
  packageDefinitions,
  products,
  refundLines,
  rooms,
  sales,
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
  enqueueBookingMessage,
  getAutomations,
  isAutomationOn,
  nextCounter,
  profitAndLoss,
  publicPrice,
  receiveStock,
  refundOptions,
  refundSale,
  setAutomation,
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
      .values({
        tenantId: ids.tenant!,
        displayName: 'Maya',
        payType: 'sales_commission',
        commissionPct: '10',
      })
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

  it('queues no thank-you / review request while that automation is switched off (B3)', async () => {
    const [thanks] = await tx((db) => db.select().from(outbox).where(eq(outbox.kind, 'thank_you')))
    const bookingId = thanks!.bookingId!
    await tx((db) => setAutomation(db, ids.tenant!, 'thankYou', false))
    expect(await tx((db) => isAutomationOn(db, ids.tenant!, 'thankYou'))).toBe(false)
    expect(await tx((db) => enqueueBookingMessage(db, bookingId, 'review_request'))).toBeNull()
    await tx((db) => setAutomation(db, ids.tenant!, 'thankYou', true))
    expect((await tx((db) => getAutomations(db, ids.tenant!))).thankYou).toBe(true)
    expect((await tx((db) => enqueueBookingMessage(db, bookingId, 'review_request')))?.kind).toBe(
      'review_request',
    )
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

    const { sale: refunded, lines: soldLines } = await tx((db) =>
      createSale(db, {
        ...base(),
        lines: [swedish(), { kind: 'other', description: 'Hot stones add-on', qty: 1, unitPriceAed: 50 }],
        payments: [{ method: 'cash', amountAed: 400 }],
        now: NOON,
      }),
    )
    const addOn = soldLines.find((l) => l.kind === 'other')!.id
    const refundAddOn = () =>
      tx((db) =>
        refundSale(db, {
          saleId: refunded.id,
          lines: [{ saleLineId: addOn, qty: 1 }],
          method: 'cash',
          reason: 'No hot stones today',
          now: NOON,
        }),
      )
    expect((await refundAddOn()).amountAed).toBe('50.00')
    await expect(refundAddOn()).rejects.toThrow(/Nothing is left to refund on “Hot stones add-on”/)

    const s = await tx((db) => daySummary(db, ids.branch!, D, 100))
    expect(s.salesCount).toBe(3) // split sale + booking checkout + refunded sale (void excluded)
    expect(s.voidCount).toBe(1)
    expect(s.revenueAed).toBe(1150)
    expect(s.paymentsByMethod).toEqual({ cash: 600, card_terminal: 550 })
    expect(s.tipsByStaff).toEqual([{ staffId: ids.maya, name: 'Maya', amountAed: 20 }])
    expect(s.refundsAed).toBe(50)
    // 100 float + 600 cash + 20 cash tips − 50 cash refund
    expect(s.expectedCashAed).toBe(670)

    const close = await tx((db) =>
      closeDay(db, { ...base(), date: D, openingFloatAed: 100, countedCashAed: 665, notes: 'short 5' }),
    )
    expect(close.varianceAed).toBe('-5.00')
    expect(close.totals.pay_cash).toBe('600.00')
    await expect(
      tx((db) => closeDay(db, { ...base(), date: D, openingFloatAed: 100, countedCashAed: 670 })),
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

describe('a booking is checked out once (F3)', () => {
  const D3 = '2026-10-27'
  const at = dubaiInstant(D3, 12 * 60)
  const book = (hour: number) =>
    tx((db) =>
      createBooking(db, {
        ...base(),
        clientId: ids.client,
        source: 'phone',
        status: 'confirmed',
        allowOffShift: true,
        items: [
          { serviceVariantId: ids.variant!, start: dubaiInstant(D3, hour * 60), staffIds: [ids.maya!] },
        ],
      }),
    )
  const checkout = (bookingId: string) =>
    tx((db) =>
      createSale(db, {
        ...base(),
        bookingId,
        lines: [swedish(ids.maya)],
        payments: [{ method: 'cash', amountAed: 350 }],
        now: at,
      }),
    )
  const liveSales = (bookingId: string) =>
    tx((db) =>
      db.select().from(sales).where(sql`${sales.bookingId} = ${bookingId} and ${sales.status} <> 'void'`),
    )

  it('rejects a second checkout of the same booking', async () => {
    const b = await book(10)
    await checkout(b.id)
    await expect(checkout(b.id)).rejects.toBeInstanceOf(DomainError)
    expect(await liveSales(b.id)).toHaveLength(1)
  })

  it('lets exactly one of two concurrent checkouts through', async () => {
    const b = await book(13)
    const results = await Promise.allSettled([checkout(b.id), checkout(b.id)])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(failed.reason).toBeInstanceOf(DomainError)
    expect(await liveSales(b.id)).toHaveLength(1)
  })

  it('allows a new checkout once the earlier sale is voided; the index backs it up', async () => {
    const b = await book(16)
    const { sale: first } = await checkout(b.id)
    await tx((db) => voidSale(db, { saleId: first.id, reason: 'Wrong items' }))
    // Voiding leaves the booking completed; reopen it so the status check doesn't mask the sale check.
    await tx((db) => db.update(bookings).set({ status: 'in_service' }).where(eq(bookings.id, b.id)))
    const { sale: second } = await checkout(b.id)
    expect(second.bookingId).toBe(b.id)
    // A second live sale for the booking is refused by the partial unique index itself.
    await expect(
      tx((db) =>
        db.insert(sales).values({
          ...base(),
          bookingId: b.id,
          number: 9999,
          businessDate: D3,
          subtotalAed: '350',
          totalAed: '350',
          status: 'paid',
        }),
      ),
    ).rejects.toMatchObject({ cause: { code: '23505', constraint: 'sales_booking_once' } })
  })
})

describe('line-level refunds (F2)', () => {
  const D3 = '2026-10-25'
  const at = dubaiInstant(D3, 12 * 60)
  /** Debit − credit per account over every journal entry of the given sources (AED). */
  const ledgerNet = async (sourceId: string) => {
    const rows = await tx((db) =>
      db
        .select({
          code: ledgerAccounts.code,
          v: sql<string>`sum(${journalLines.debitAed} - ${journalLines.creditAed})`,
        })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
        .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, journalLines.accountId))
        .where(eq(journalEntries.sourceId, sourceId))
        .groupBy(ledgerAccounts.code),
    )
    return Object.fromEntries(rows.map((r) => [r.code, Number(r.v)]).filter(([, v]) => v !== 0))
  }
  const commissionOn = async (saleLineId: string) =>
    Number(
      (
        await tx((db) =>
          db
            .select({ v: sql<string>`coalesce(sum(${commissionEntries.amountAed}), 0)` })
            .from(commissionEntries)
            .where(eq(commissionEntries.saleLineId, saleLineId)),
        )
      )[0]!.v,
    )
  const status = async (saleId: string) =>
    (await tx((db) => db.select().from(sales).where(eq(sales.id, saleId))))[0]!.status

  it('refunds part of a discounted retail line: stock back, COGS and commission reversed pro rata', async () => {
    const productId = await tx(async (db) => {
      const [p] = await db
        .insert(products)
        .values({ tenantId: ids.tenant!, kind: 'retail', name: { en: 'Face cream' }, priceAed: '105' })
        .returning()
      await receiveStock(db, {
        ...base(),
        productId: p!.id,
        qty: 10,
        unitCostAed: 40,
        paidVia: 'cash',
        date: D3,
      })
      return p!.id
    })
    const stock = async () =>
      Number(
        (await tx((db) => db.select().from(stockLevels).where(eq(stockLevels.productId, productId))))[0]!.qty,
      )
    // 3 × 105 + 350, less a 66.50 sale discount spread pro rata: cream 283.50 (VAT 13.50), massage 315.
    const { sale, lines } = await tx((db) =>
      createSale(db, {
        ...base(),
        lines: [
          {
            kind: 'product',
            refId: productId,
            description: 'Face cream',
            qty: 3,
            unitPriceAed: 105,
            staffId: ids.maya,
          },
          swedish(ids.maya),
        ],
        discountAed: 66.5,
        payments: [{ method: 'card_terminal', amountAed: 598.5 }],
        now: at,
      }),
    )
    const cream = lines.find((l) => l.kind === 'product')!
    const massage = lines.find((l) => l.kind === 'service')!
    expect(cream.lineTotalAed).toBe('283.50')
    expect(await stock()).toBe(7)
    expect(await commissionOn(cream.id)).toBe(27) // 10% of 270 net of VAT

    const options = await tx((db) => refundOptions(db, sale.id))
    expect(options.lines.find((l) => l.saleLineId === cream.id)?.unitsAed).toEqual([94.5, 94.5, 94.5])
    const refund = (saleLineId: string, qty: number, method: 'cash' | 'card_terminal' = 'cash') =>
      tx((db) =>
        refundSale(db, {
          saleId: sale.id,
          lines: [{ saleLineId, qty }],
          method,
          reason: 'Allergic',
          now: at,
        }),
      )
    await expect(refund(cream.id, 4)).rejects.toThrow(/At most 3 of “Face cream” can be refunded/)

    expect((await refund(cream.id, 1)).amountAed).toBe('94.50')
    expect(await stock()).toBe(8)
    expect(await commissionOn(cream.id)).toBe(18)
    expect(await status(sale.id)).toBe('paid')
    expect(await ledgerNet(sale.id)).toEqual({
      '1010': 598.5,
      '1000': -94.5,
      '4000': -300,
      '4100': -180, // 270 − 90
      '2000': -24, // 13.50 + 15 − 4.50
      '5000': 80, // 120 − 40
      '1200': -80,
      '6010': 48, // 27 + 30 − 9
      '2300': -48,
    })

    expect((await refund(cream.id, 2)).amountAed).toBe('189.00')
    expect(await stock()).toBe(10)
    expect(await commissionOn(cream.id)).toBe(0)
    await expect(refund(cream.id, 1)).rejects.toThrow(/Nothing is left to refund on “Face cream”/)

    expect((await refund(massage.id, 1, 'card_terminal')).amountAed).toBe('315.00')
    expect(await commissionOn(massage.id)).toBe(0)
    expect(await status(sale.id)).toBe('refunded')
    // Every revenue, VAT, stock and commission account is back to zero; the money went back out.
    expect(await ledgerNet(sale.id)).toEqual({ '1010': 283.5, '1000': -283.5 })
    await expect(refund(massage.id, 1)).rejects.toThrow(/already been refunded/)
  })

  it('refunds one of two treatments, splitting VAT so both halves add up', async () => {
    const { sale, lines } = await tx((db) =>
      createSale(db, {
        ...base(),
        lines: [{ ...swedish(ids.maya), qty: 2 }],
        payments: [{ method: 'cash', amountAed: 700 }],
        now: at,
      }),
    )
    const line = lines[0]!
    const refund = () =>
      tx((db) =>
        refundSale(db, {
          saleId: sale.id,
          lines: [{ saleLineId: line.id, qty: 1 }],
          method: 'cash',
          reason: 'Second guest left',
          now: at,
        }),
      )
    const first = await refund()
    expect(first.amountAed).toBe('350.00')
    const [row] = await tx((db) => db.select().from(refundLines).where(eq(refundLines.refundId, first.id)))
    expect(row).toMatchObject({ qty: 1, amountAed: '350.00', vatAed: '16.67' })
    expect(await status(sale.id)).toBe('paid')
    expect(await commissionOn(line.id)).toBe(33.33) // 66.67 earned on 666.67 net, half offset
    await refund()
    expect(await status(sale.id)).toBe('refunded')
    expect(await commissionOn(line.id)).toBe(0)
    expect(await ledgerNet(sale.id)).toEqual({})
  })

  it('refunds only the unused value of gift cards and packages, then voids them; used ones are blocked', async () => {
    const defId = await tx(async (db) => {
      const [svc] = await db.select().from(serviceVariants).where(eq(serviceVariants.id, ids.variant!))
      const [d] = await db
        .insert(packageDefinitions)
        .values({
          tenantId: ids.tenant!,
          name: { en: '5 × Swedish (F2)' },
          priceAed: '1500',
          items: [{ serviceId: svc!.serviceId, quantity: 5 }],
        })
        .returning()
      return d!.id
    })
    const { sale, lines } = await tx((db) =>
      createSale(db, {
        ...base(),
        clientId: ids.client,
        lines: [
          { kind: 'gift_card', description: 'Gift card — Noor', qty: 1, unitPriceAed: 500 },
          { kind: 'package', refId: defId, description: '5 × Swedish', qty: 1, unitPriceAed: 1500 },
        ],
        payments: [{ method: 'card_terminal', amountAed: 2000 }],
        now: at,
      }),
    )
    const [card] = await tx((db) => db.select().from(giftCards).where(eq(giftCards.saleId, sale.id)))
    const [pkg] = await tx((db) => db.select().from(clientPackages).where(eq(clientPackages.saleId, sale.id)))
    // Spend 350 of the card and one package session.
    await tx((db) =>
      createSale(db, {
        ...base(),
        lines: [swedish()],
        payments: [{ method: 'gift_card', amountAed: 350, reference: card!.code }],
        now: at,
      }),
    )
    await tx((db) =>
      createSale(db, {
        ...base(),
        clientId: ids.client,
        lines: [{ ...swedish(), refId: ids.variant, unitPriceAed: 0, clientPackageId: pkg!.id }],
        payments: [],
        now: at,
      }),
    )
    const options = await tx((db) => refundOptions(db, sale.id))
    expect(options.lines.map((l) => [l.kind, l.unitsAed])).toEqual([
      ['gift_card', [150]],
      ['package', [1200]],
    ])
    const refund = await tx((db) =>
      refundSale(db, {
        saleId: sale.id,
        lines: lines.map((l) => ({ saleLineId: l.id, qty: 1 })),
        method: 'card_terminal',
        reason: 'Client moving abroad',
        now: at,
      }),
    )
    expect(refund.amountAed).toBe('1350.00')
    const [voided] = await tx((db) => db.select().from(giftCards).where(eq(giftCards.id, card!.id)))
    expect(voided).toMatchObject({ status: 'void', balanceAed: '0.00' })
    const txns = await tx((db) => db.select().from(giftCardTxns).where(eq(giftCardTxns.giftCardId, card!.id)))
    expect(txns.find((t) => t.kind === 'refund')?.amountAed).toBe('-150.00')
    const [cancelled] = await tx((db) =>
      db.select().from(clientPackages).where(eq(clientPackages.id, pkg!.id)),
    )
    expect(cancelled).toMatchObject({ status: 'refunded', remainingValueAed: '0.00' })
    expect(await status(sale.id)).toBe('refunded')
    // The sale's own entries: 2000 in, 500 + 1500 owed; the refund takes back 150 + 1200 with no VAT.
    expect(await ledgerNet(sale.id)).toEqual({ '1010': 650, '2100': -350, '2110': -300 })

    // A fully used gift card cannot be refunded at its full price.
    const { sale: spent, lines: spentLines } = await tx((db) =>
      createSale(db, {
        ...base(),
        lines: [{ kind: 'gift_card', description: 'Gift card — Lina', qty: 1, unitPriceAed: 200 }],
        payments: [{ method: 'cash', amountAed: 200 }],
        now: at,
      }),
    )
    const [used] = await tx((db) => db.select().from(giftCards).where(eq(giftCards.saleId, spent.id)))
    await tx((db) =>
      createSale(db, {
        ...base(),
        lines: [{ kind: 'other', description: 'Scrub', qty: 1, unitPriceAed: 200 }],
        payments: [{ method: 'gift_card', amountAed: 200, reference: used!.code }],
        now: at,
      }),
    )
    expect((await tx((db) => refundOptions(db, spent.id))).lines[0]?.unitsAed).toEqual([])
    await expect(
      tx((db) =>
        refundSale(db, {
          saleId: spent.id,
          lines: [{ saleLineId: spentLines[0]!.id, qty: 1 }],
          method: 'cash',
          reason: 'Changed mind',
          now: at,
        }),
      ),
    ).rejects.toThrow(/has been used — nothing unused is left to refund/)
  })
})

describe('price on request (R4)', () => {
  const DAY = dubaiInstant('2026-10-09', 12 * 60)
  it('books a priceless service and checks it out at the price the receptionist types', async () => {
    const variant = await tx(async (db) => {
      const [s] = await db
        .insert(services)
        .values({ tenantId: ids.tenant!, name: { en: 'Bespoke ritual' }, showPrice: false })
        .returning()
      const [v] = await db
        .insert(serviceVariants)
        .values({ tenantId: ids.tenant!, serviceId: s!.id, durationMin: 90, priceAed: null })
        .returning()
      return v!.id
    })
    const booking = await tx((db) =>
      createBooking(db, {
        ...base(),
        source: 'phone',
        status: 'confirmed',
        allowOffShift: true,
        items: [{ serviceVariantId: variant, start: DAY, staffIds: [ids.maya!], roomId: ids.room }],
      }),
    )
    const [item] = await tx((db) =>
      db.select().from(bookingItems).where(eq(bookingItems.bookingId, booking.id)),
    )
    expect(item!.priceAed).toBeNull()
    const line = { kind: 'service' as const, refId: variant, description: 'Bespoke ritual 90 min', qty: 1 }
    await expect(
      tx((db) =>
        createSale(db, {
          ...base(),
          bookingId: booking.id,
          lines: [{ ...line, unitPriceAed: Number.NaN }],
          payments: [{ method: 'cash', amountAed: 0 }],
          now: DAY,
        }),
      ),
    ).rejects.toThrow(/Type a price/)
    const { sale } = await tx((db) =>
      createSale(db, {
        ...base(),
        bookingId: booking.id,
        lines: [{ ...line, unitPriceAed: 420, staffId: ids.maya }],
        payments: [{ method: 'cash', amountAed: 420 }],
        now: DAY,
      }),
    )
    expect(Number(sale.totalAed)).toBe(420)
  })

  it('shows public prices per service, else by the spa default', () => {
    expect(publicPrice('350.00', null, false)).toBe('350.00')
    expect(publicPrice('350.00', null, true)).toBeNull()
    expect(publicPrice('350.00', true, true)).toBe('350.00')
    expect(publicPrice('350.00', false, false)).toBeNull()
    expect(publicPrice(null, true, false)).toBeNull()
  })
})
