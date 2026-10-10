// F15 gift vouchers (public check, scan at checkout), F16 booking partners, F15 automatic client message drafts.
import { dubaiInstant } from '@spa/core'
import {
  bookingItems,
  bookings,
  branches,
  clients,
  closeAllDbs,
  giftCards,
  outbox,
  payments,
  sales,
  services,
  tenants,
  withTenant,
} from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createPartner,
  createSale,
  giftCardCode,
  issueGiftCard,
  partnerBookingStats,
  partnerByCode,
  queueBirthdayMessages,
  queueReviewRequests,
  queueWinbackMessages,
  saveClientDraftSettings,
  setPartnerActive,
  updateVoucher,
  voucherCheck,
  withdrawCampaignMessagesWithoutConsent,
} from '../src'

const { platform, app } = testDbs()
const ids = {} as Record<string, string>
const tx = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(ids.tenant!, fn, app)
const DAY = 86_400_000
// 14:00 Dubai, 10 Oct 2026.
const NOW = dubaiInstant('2026-10-10', 14 * 60)
const SITE = 'https://drafts.spamanagement.co'
let ref = 0

async function client(values: Partial<typeof clients.$inferInsert> & { name: string }) {
  const [c] = await tx((db) =>
    db
      .insert(clients)
      .values({ tenantId: ids.tenant!, phoneE164: `9715010${String(++ref).padStart(5, '0')}`, ...values })
      .returning(),
  )
  return c!
}

async function booking(
  clientId: string | null,
  startsAt: Date,
  extra: Partial<typeof bookings.$inferInsert> = {},
) {
  return tx(async (db) => {
    const [b] = await db
      .insert(bookings)
      .values({
        tenantId: ids.tenant!,
        branchId: ids.branch!,
        clientId,
        refCode: `R${++ref}`,
        source: 'online',
        status: 'completed',
        businessDate: '2026-10-10',
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3_600_000),
        ...extra,
      })
      .returning()
    await db.insert(bookingItems).values({
      tenantId: ids.tenant!,
      bookingId: b!.id,
      serviceName: 'Thai massage',
      durationMin: 60,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3_600_000),
    })
    return b!
  })
}

async function checkout(bookingId: string, clientId: string, at: Date) {
  await tx((db) =>
    db.insert(sales).values({
      tenantId: ids.tenant!,
      branchId: ids.branch!,
      clientId,
      bookingId,
      number: ++ref,
      businessDate: '2026-10-10',
      subtotalAed: '300',
      totalAed: '300',
      status: 'paid',
      createdAt: at,
    }),
  )
}

const drafts = (kind: 'review_request' | 'birthday' | 'winback') =>
  tx((db) => db.select().from(outbox).where(eq(outbox.kind, kind)))

beforeAll(async () => {
  await resetTestDatabase()
  const [t] = await platform.insert(tenants).values({ slug: 'drafts', name: 'Drafts Spa' }).returning()
  ids.tenant = t!.id
  const [b] = await tx((db) =>
    db.insert(branches).values({ tenantId: ids.tenant!, name: 'Marina', isDefault: true }).returning(),
  )
  ids.branch = b!.id
  const [s] = await tx((db) =>
    db
      .insert(services)
      .values({ tenantId: ids.tenant!, name: { en: 'Hot stone', ar: 'الأحجار الساخنة' } })
      .returning(),
  )
  ids.service = s!.id
})
afterAll(closeAllDbs)

describe('gift vouchers (F15)', () => {
  it('the public check shows status + balance only, by token', async () => {
    const buyer = await client({ name: 'Buyer Private' })
    const card = await tx((db) =>
      issueGiftCard(db, {
        tenantId: ids.tenant!,
        amountAed: 500,
        purchaserClientId: buyer.id,
        recipientName: 'Secret Recipient',
        now: NOW,
      }),
    )
    expect(card.checkToken).toMatch(/^[0-9a-f]{32}$/)
    ids.card = card.id
    ids.token = card.checkToken
    const v = await tx((db) => voucherCheck(db, card.checkToken, NOW))
    expect(v).toEqual({
      status: 'valid',
      initialAed: '500.00',
      balanceAed: '500.00',
      expiresAt: card.expiresAt,
      codeHint: card.code.slice(-4),
      treatment: null,
    })
    expect(JSON.stringify(v)).not.toMatch(/Secret|Buyer/)
    expect(await tx((db) => voucherCheck(db, 'f'.repeat(32)))).toBeNull()
    expect(await tx((db) => voucherCheck(db, "x' or 1=1 --"))).toBeNull()
    // Expired (after its expiry) and treatment vouchers.
    expect(
      (await tx((db) => voucherCheck(db, card.checkToken, new Date(NOW.getTime() + 400 * DAY))))?.status,
    ).toBe('expired')
    await tx((db) =>
      updateVoucher(db, card.id, {
        recipientName: 'Secret Recipient',
        message: null,
        voucherServiceId: ids.service!,
      }),
    )
    expect((await tx((db) => voucherCheck(db, card.checkToken, NOW)))?.treatment).toEqual({
      en: 'Hot stone',
      ar: 'الأحجار الساخنة',
    })
  })

  it('another spa cannot read the voucher (RLS)', async () => {
    const [o] = await platform.insert(tenants).values({ slug: 'drafts-other', name: 'Other' }).returning()
    expect(await withTenant(o!.id, (db) => voucherCheck(db, ids.token!), app)).toBeNull()
  })

  it('a scanned voucher QR pays at checkout and the payment keeps the code', async () => {
    const url = `${SITE}/voucher/${ids.token}`
    const [card] = await tx((db) => db.select().from(giftCards).where(eq(giftCards.id, ids.card!)))
    expect(await tx((db) => giftCardCode(db, ids.tenant!, url))).toBe(card!.code)
    const { sale } = await tx((db) =>
      createSale(db, {
        tenantId: ids.tenant!,
        branchId: ids.branch!,
        lines: [{ kind: 'other', description: 'Oil', qty: 1, unitPriceAed: 120 }],
        payments: [{ method: 'gift_card', amountAed: 120, reference: url }],
        now: NOW,
      }),
    )
    const [pay] = await tx((db) => db.select().from(payments).where(eq(payments.saleId, sale.id)))
    expect(pay!.reference).toBe(card!.code)
    expect((await tx((db) => voucherCheck(db, ids.token!, NOW)))?.balanceAed).toBe('380.00')
  })
})

describe('booking partners (F16)', () => {
  it('codes, pause, and bookings per partner', async () => {
    const hotel = await tx((db) => createPartner(db, ids.tenant!, '  Atlantis concierge '))
    expect(hotel.name).toBe('Atlantis concierge')
    expect(await tx((db) => partnerByCode(db, hotel.code.toUpperCase()))).toEqual({
      id: hotel.id,
      name: 'Atlantis concierge',
    })
    expect(await tx((db) => partnerByCode(db, '../x'))).toBeNull()
    await booking(null, NOW, { partnerId: hotel.id, attribution: 'qr', status: 'confirmed' })
    await booking(null, NOW, { partnerId: hotel.id, attribution: 'qr' })
    await booking(null, NOW, { partnerId: hotel.id, attribution: 'qr', status: 'cancelled' })
    await booking(null, NOW, { attribution: 'qr', status: 'pending' })
    const stats = await tx((db) => partnerBookingStats(db, NOW))
    expect(stats.partners).toEqual([
      expect.objectContaining({ id: hotel.id, total: 2, last30: 2, completed: 1, active: true }),
    ])
    expect(stats.reception).toEqual(expect.objectContaining({ total: 1, completed: 0 }))
    await tx((db) => setPartnerActive(db, hotel.id, false))
    expect(await tx((db) => partnerByCode(db, hotel.code))).toBeNull()
  })
})

describe('client message drafts (F15)', () => {
  it('review requests need the review link, fall due after the delay, once per booking and client', async () => {
    const fatima = await client({ name: 'Fatima Al Mansoori', lastVisitAt: NOW })
    const visit = await booking(fatima.id, new Date(NOW.getTime() - 2 * 3_600_000))
    await checkout(visit.id, fatima.id, new Date(NOW.getTime() - 3_600_000))
    expect(await tx((db) => queueReviewRequests(db, ids.tenant!, NOW))).toBe(0) // no link yet
    await tx((db) =>
      saveClientDraftSettings(db, ids.tenant!, {
        quietStart: '21:00',
        quietEnd: '10:00',
        reviewLink: 'https://g.page/r/drafts/review',
        reviewDelayHours: 3,
        winbackDays: 60,
      }),
    )
    expect(await tx((db) => queueReviewRequests(db, ids.tenant!, NOW))).toBe(1)
    const [row] = await drafts('review_request')
    expect(row!.bookingId).toBe(visit.id)
    expect(row!.branchId).toBe(ids.branch)
    expect(row!.text).toBe(
      'Hi Fatima, thank you for visiting Drafts Spa. Would you share a quick review? https://g.page/r/drafts/review',
    )
    // Checkout 13:00 + 3 h = 16:00 Dubai.
    expect(row!.dueAt).toEqual(dubaiInstant('2026-10-10', 16 * 60))
    expect(await tx((db) => queueReviewRequests(db, ids.tenant!, NOW))).toBe(0)
    // A second visit within 90 days: no second request.
    const again = await booking(fatima.id, NOW)
    await checkout(again.id, fatima.id, NOW)
    expect(await tx((db) => queueReviewRequests(db, ids.tenant!, NOW))).toBe(0)
  })

  it('review requests respect opt-outs, quiet hours and the 48 h window', async () => {
    const out = await client({ name: 'Opted Out', marketingOptOutAt: NOW })
    const v1 = await booking(out.id, NOW)
    await checkout(v1.id, out.id, NOW)
    const old = await client({ name: 'Old Visit' })
    const v2 = await booking(old.id, new Date(NOW.getTime() - 5 * DAY))
    await checkout(v2.id, old.id, new Date(NOW.getTime() - 5 * DAY))
    const late = await client({ name: 'Late Visitor', language: 'ar' })
    const evening = dubaiInstant('2026-10-10', 20 * 60)
    const v3 = await booking(late.id, evening)
    await checkout(v3.id, late.id, evening)
    expect(await tx((db) => queueReviewRequests(db, ids.tenant!, evening))).toBe(1)
    const row = (await drafts('review_request')).find((r) => r.clientId === late.id)!
    // 20:00 + 3 h = 23:00 is quiet → 10:00 next morning; Arabic template for an Arabic speaker.
    expect(row.dueAt).toEqual(dubaiInstant('2026-10-11', 10 * 60))
    expect(row.text).toContain('شكراً لزيارتك')
  })

  it('birthday greetings: today in Dubai, once a year, not right after another marketing message', async () => {
    const bday = await client({
      name: 'Noor Hassan',
      birthday: '1990-10-10',
      lastVisitAt: new Date(NOW.getTime() - 30 * DAY),
    })
    const busy = await client({
      name: 'Busy Bee',
      birthday: '1985-10-10',
      lastVisitAt: new Date(NOW.getTime() - 30 * DAY),
    })
    await client({ name: 'Never Visited', birthday: '1991-10-10' })
    await client({ name: 'Tomorrow', birthday: '1991-10-11', lastVisitAt: NOW })
    await tx((db) =>
      db.insert(outbox).values({
        tenantId: ids.tenant!,
        clientId: busy.id,
        campaignId: '00000000-0000-4000-8000-000000000001',
        kind: 'custom',
        phoneE164: busy.phoneE164!,
        text: 'Campaign',
        status: 'sent',
        sentAt: new Date(NOW.getTime() - 2 * DAY),
        dueAt: new Date(NOW.getTime() - 2 * DAY),
      }),
    )
    const early = dubaiInstant('2026-10-10', 25) // 00:25 Dubai
    expect(await tx((db) => queueBirthdayMessages(db, ids.tenant!, early, SITE))).toBe(1)
    const [row] = await drafts('birthday')
    expect(row!.clientId).toBe(bday.id)
    expect(row!.text).toBe(`Happy birthday, Noor! Treat yourself at Drafts Spa this week: ${SITE}/book`)
    expect(row!.dueAt).toEqual(dubaiInstant('2026-10-10', 10 * 60))
    expect(await tx((db) => queueBirthdayMessages(db, ids.tenant!, NOW, SITE))).toBe(0)
    // Consent is re-checked before sending: an opt-out takes the waiting draft out of the queue.
    await tx((db) => db.update(clients).set({ marketingOptOutAt: NOW }).where(eq(clients.id, bday.id)))
    expect(await tx((db) => withdrawCampaignMessagesWithoutConsent(db))).toBe(1)
  })

  it('win-back: lapsed clients without a booking ahead, once per absence, newest lapses first', async () => {
    const lapsed = await client({ name: 'Lina Lapsed', lastVisitAt: new Date(NOW.getTime() - 70 * DAY) })
    const booked = await client({ name: 'Booked Bea', lastVisitAt: new Date(NOW.getTime() - 80 * DAY) })
    await booking(booked.id, new Date(NOW.getTime() + 2 * DAY), { status: 'confirmed' })
    await client({ name: 'Ancient Ann', lastVisitAt: new Date(NOW.getTime() - 400 * DAY) })
    await client({ name: 'Recent Rita', lastVisitAt: new Date(NOW.getTime() - 20 * DAY) })
    await booking(lapsed.id, new Date(NOW.getTime() - 70 * DAY))
    expect(await tx((db) => queueWinbackMessages(db, ids.tenant!, NOW, SITE))).toBe(1)
    const [row] = await drafts('winback')
    expect(row!.clientId).toBe(lapsed.id)
    expect(row!.text).toBe(
      `Hi Lina, we miss you at Drafts Spa. Come back for a relaxing treatment soon: ${SITE}/book`,
    )
    expect(await tx((db) => queueWinbackMessages(db, ids.tenant!, NOW, SITE))).toBe(0)
    // Drafts are stamped with the real clock (created_at); pin this one to the simulated NOW so "once per absence"
    // doesn't depend on the time of day the test runs.
    await tx((db) => db.update(outbox).set({ createdAt: NOW }).where(eq(outbox.kind, 'winback')))
    // After a new visit and another long absence, they can get one again.
    await tx((db) =>
      db
        .update(clients)
        .set({ lastVisitAt: new Date(NOW.getTime() + 1000) })
        .where(eq(clients.id, lapsed.id)),
    )
    // (Others who lapsed by then are queued too.)
    const later = new Date(NOW.getTime() + 75 * DAY)
    expect(await tx((db) => queueWinbackMessages(db, ids.tenant!, later, SITE))).toBeGreaterThan(0)
    const rows = await tx((db) =>
      db
        .select()
        .from(outbox)
        .where(and(eq(outbox.kind, 'winback'), eq(outbox.clientId, lapsed.id))),
    )
    expect(rows).toHaveLength(2)
  })
})
