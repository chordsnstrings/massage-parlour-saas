import { dubaiInstant } from '@spa/core'
import {
  bookingItems,
  bookings,
  branches,
  campaigns,
  clientPackages,
  clients,
  closeAllDbs,
  outbox,
  promoCodes,
  type SegmentRule,
  sales,
  segments,
  services,
  serviceVariants,
  tenants,
  withTenant,
} from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  archiveCampaign,
  CAMPAIGN_LIMITS,
  campaignBookedClients,
  campaignResults,
  duplicateCampaign,
  finishCampaigns,
  planAudience,
  queueCampaign,
  renderCampaignMessage,
  resolveSegment,
} from '../src'

const { platform, app } = testDbs()
const DAY = 86_400_000
/** Tuesday 6 Oct 2026, 10:00 in Dubai. */
const NOW = dubaiInstant('2026-10-06', 600)
const ago = (days: number) => new Date(NOW.getTime() - days * DAY)
const ids = {} as Record<string, string>
const tx = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(ids.tenant!, fn, app)
const names = async (rules: SegmentRule[], opts?: { requireVisit?: boolean }) =>
  (await tx((db) => resolveSegment(db, ids.tenant!, rules, NOW, opts))).map((c) => c.name)
const sorted = async (rules: SegmentRule[]) => (await names(rules)).sort()

let ref = 0
async function visit(
  clientId: string,
  variantId: string,
  at: Date,
  status: 'completed' | 'no_show' = 'completed',
) {
  await tx(async (db) => {
    const [b] = await db
      .insert(bookings)
      .values({
        tenantId: ids.tenant!,
        branchId: ids.branch!,
        clientId,
        refCode: `T${++ref}`,
        source: 'phone',
        status,
        businessDate: at.toISOString().slice(0, 10),
        startsAt: at,
        endsAt: new Date(at.getTime() + 3600_000),
        createdAt: at,
      })
      .returning()
    await db.insert(bookingItems).values({
      tenantId: ids.tenant!,
      bookingId: b!.id,
      serviceVariantId: variantId,
      serviceName: 'Treatment',
      durationMin: 60,
      priceAed: '350',
      startsAt: at,
      endsAt: new Date(at.getTime() + 3600_000),
    })
  })
}

beforeAll(async () => {
  await resetTestDatabase()
  const [t] = await platform.insert(tenants).values({ slug: 'camp', name: 'Camp Spa' }).returning()
  ids.tenant = t!.id
  await tx(async (db) => {
    const [b] = await db
      .insert(branches)
      .values({ tenantId: ids.tenant!, name: 'Main', isDefault: true })
      .returning()
    ids.branch = b!.id
    const [swedish, thai] = await db
      .insert(services)
      .values([
        { tenantId: ids.tenant!, name: { en: 'Swedish' } },
        { tenantId: ids.tenant!, name: { en: 'Thai' } },
      ])
      .returning()
    ids.swedish = swedish!.id
    ids.thai = thai!.id
    const [v1, v2] = await db
      .insert(serviceVariants)
      .values([
        { tenantId: ids.tenant!, serviceId: swedish!.id, durationMin: 60, priceAed: '350' },
        { tenantId: ids.tenant!, serviceId: thai!.id, durationMin: 60, priceAed: '300' },
      ])
      .returning()
    ids.v1 = v1!.id
    ids.v2 = v2!.id
    const people = await db
      .insert(clients)
      .values([
        {
          tenantId: ids.tenant!,
          name: 'Amira Haddad',
          phoneE164: '971500000001',
          gender: 'female',
          language: 'en',
          tags: ['vip'],
          birthday: '1990-10-20',
          lastVisitAt: ago(90),
        },
        {
          tenantId: ids.tenant!,
          name: 'Bilal Saeed',
          phoneE164: '971500000002',
          gender: 'male',
          language: 'ar',
          birthday: '1985-03-01',
          noShowCount: 2,
          lastVisitAt: ago(10),
        },
        {
          tenantId: ids.tenant!,
          name: 'Carla Diaz',
          phoneE164: '971500000003',
          gender: 'female',
          language: 'en',
          birthday: '1992-11-02',
          lastVisitAt: ago(30),
        },
        // Never targeted: opted out, tagged no-marketing, blocklisted, no mobile, never visited.
        {
          tenantId: ids.tenant!,
          name: 'Opted Out',
          phoneE164: '971500000004',
          marketingOptOutAt: ago(5),
          lastVisitAt: ago(100),
        },
        {
          tenantId: ids.tenant!,
          name: 'No Marketing',
          phoneE164: '971500000005',
          tags: ['no-marketing'],
          lastVisitAt: ago(100),
        },
        {
          tenantId: ids.tenant!,
          name: 'Blocked',
          phoneE164: '971500000006',
          blocklisted: true,
          lastVisitAt: ago(100),
        },
        { tenantId: ids.tenant!, name: 'No Phone', lastVisitAt: ago(100) },
        { tenantId: ids.tenant!, name: 'Never Visited', phoneE164: '971500000008' },
      ])
      .returning()
    for (const p of people) ids[p.name] = p.id
    await db.insert(sales).values([
      {
        tenantId: ids.tenant!,
        branchId: ids.branch!,
        clientId: ids['Bilal Saeed']!,
        number: 1,
        businessDate: '2026-09-20',
        subtotalAed: '2500',
        totalAed: '2500',
        status: 'paid',
      },
      {
        tenantId: ids.tenant!,
        branchId: ids.branch!,
        clientId: ids['Carla Diaz']!,
        number: 2,
        businessDate: '2026-09-01',
        subtotalAed: '3000',
        totalAed: '3000',
        status: 'void',
      },
    ])
    const pkg = { name: '5 × Swedish', pricePaidAed: '1500', balances: {}, remainingValueAed: '900' }
    await db.insert(clientPackages).values([
      {
        tenantId: ids.tenant!,
        clientId: ids['Bilal Saeed']!,
        ...pkg,
        expiresAt: new Date(NOW.getTime() + 10 * DAY),
      },
      {
        tenantId: ids.tenant!,
        clientId: ids['Carla Diaz']!,
        ...pkg,
        expiresAt: new Date(NOW.getTime() + 100 * DAY),
      },
      // Used up packages never count.
      {
        tenantId: ids.tenant!,
        clientId: ids['Amira Haddad']!,
        ...pkg,
        status: 'used_up',
        expiresAt: new Date(NOW.getTime() + 5 * DAY),
      },
    ])
  })
  await visit(ids['Amira Haddad']!, ids.v1!, ago(90))
  for (const d of [10, 40, 70]) await visit(ids['Bilal Saeed']!, ids.v2!, ago(d))
  await visit(ids['Bilal Saeed']!, ids.v1!, ago(20), 'no_show')
  for (const d of [30, 60]) await visit(ids['Carla Diaz']!, ids.v1!, ago(d))
})
afterAll(closeAllDbs)

describe('resolveSegment rules', () => {
  it('always excludes opted-out, no-marketing, blocklisted, phone-less and never-visited clients', async () => {
    expect(await names([])).toEqual(['Bilal Saeed', 'Carla Diaz', 'Amira Haddad'])
    expect(await sorted([{ kind: 'lapsed', days: 60 }])).toEqual(['Amira Haddad'])
    expect(await names([], { requireVisit: false })).toContain('Never Visited')
  })

  it('last visit more / less than N days ago', async () => {
    expect(await sorted([{ kind: 'lapsed', days: 20 }])).toEqual(['Amira Haddad', 'Carla Diaz'])
    expect(await sorted([{ kind: 'visited_within', days: 20 }])).toEqual(['Bilal Saeed'])
    expect(await sorted([{ kind: 'visited_within', days: 45 }])).toEqual(['Bilal Saeed', 'Carla Diaz'])
  })

  it('visit count at least / at most (completed visits only)', async () => {
    expect(await sorted([{ kind: 'visits_at_least', count: 2 }])).toEqual(['Bilal Saeed', 'Carla Diaz'])
    expect(await sorted([{ kind: 'visits_at_least', count: 3 }])).toEqual(['Bilal Saeed'])
    expect(await sorted([{ kind: 'visits_at_most', count: 1 }])).toEqual(['Amira Haddad'])
  })

  it('total spend counts paid sales only', async () => {
    expect(await sorted([{ kind: 'spent_at_least', aed: 2000 }])).toEqual(['Bilal Saeed'])
    expect(await sorted([{ kind: 'spent_at_least', aed: 3000 }])).toEqual([])
  })

  it('booked a service', async () => {
    expect(await sorted([{ kind: 'service', serviceId: ids.thai! }])).toEqual(['Bilal Saeed'])
    expect(await sorted([{ kind: 'service', serviceId: ids.swedish! }])).toEqual([
      'Amira Haddad',
      'Bilal Saeed',
      'Carla Diaz',
    ])
  })

  it('birthday this month and within the next N days', async () => {
    expect(await sorted([{ kind: 'birthday_month' }])).toEqual(['Amira Haddad'])
    expect(await sorted([{ kind: 'birthday_within', days: 14 }])).toEqual(['Amira Haddad'])
    expect(await sorted([{ kind: 'birthday_within', days: 30 }])).toEqual(['Amira Haddad', 'Carla Diaz'])
    expect(await sorted([{ kind: 'birthday_within', days: 7 }])).toEqual([])
  })

  it('gender, language and tags', async () => {
    expect(await sorted([{ kind: 'gender', gender: 'male' }])).toEqual(['Bilal Saeed'])
    expect(await sorted([{ kind: 'gender', gender: 'female' }])).toEqual(['Amira Haddad', 'Carla Diaz'])
    expect(await sorted([{ kind: 'language', language: 'ar' }])).toEqual(['Bilal Saeed'])
    expect(await sorted([{ kind: 'language', language: 'en' }])).toEqual(['Amira Haddad', 'Carla Diaz'])
    expect(await sorted([{ kind: 'tag', tag: 'vip' }])).toEqual(['Amira Haddad'])
  })

  it('active packages and packages expiring soon', async () => {
    expect(await sorted([{ kind: 'has_package' }])).toEqual(['Bilal Saeed', 'Carla Diaz'])
    expect(await sorted([{ kind: 'package_expiring', days: 14 }])).toEqual(['Bilal Saeed'])
    expect(await sorted([{ kind: 'package_expiring', days: 5 }])).toEqual([])
  })

  it('no-shows at least N', async () => {
    expect(await sorted([{ kind: 'no_shows_at_least', count: 2 }])).toEqual(['Bilal Saeed'])
    expect(await sorted([{ kind: 'no_shows_at_least', count: 3 }])).toEqual([])
  })

  it('combines rules with AND', async () => {
    expect(
      await sorted([
        { kind: 'visits_at_least', count: 2 },
        { kind: 'language', language: 'en' },
      ]),
    ).toEqual(['Carla Diaz'])
  })
})

describe('campaign messages', () => {
  it('renders variables in the client language, falling back to English', () => {
    const body = {
      en: 'Hi {name}, {spa} misses you. Book: {booking_link} Code {offer_code}',
      ar: 'مرحباً {name}',
    }
    const vars = { spa: 'Camp Spa', bookingLink: 'https://camp.example/book', offerCode: 'BACK20' }
    expect(renderCampaignMessage(body, { name: 'Amira Haddad', language: 'en' }, vars)).toEqual({
      lang: 'en',
      text: 'Hi Amira, Camp Spa misses you. Book: https://camp.example/book Code BACK20',
    })
    expect(renderCampaignMessage(body, { name: 'Bilal Saeed', language: 'ar' }, vars)).toEqual({
      lang: 'ar',
      text: 'مرحباً Bilal',
    })
    expect(renderCampaignMessage({ en: 'Hi {name}' }, { name: 'Bilal', language: 'ar' }, vars).lang).toBe(
      'en',
    )
  })
})

describe('queueing, frequency cap and results', () => {
  const newCampaign = (name: string, extra: Partial<typeof campaigns.$inferInsert> = {}) =>
    tx(async (db) => {
      const [c] = await db
        .insert(campaigns)
        .values({
          tenantId: ids.tenant!,
          name,
          body: {
            en: 'Hi {name}, use {offer_code} at {spa}: {booking_link}',
            ar: 'مرحباً {name} {offer_code}',
          },
          ...extra,
        })
        .returning()
      return c!
    })

  it('queues one message per recipient, due at the scheduled time, in each client’s language', async () => {
    const [promo] = await tx((db) =>
      db
        .insert(promoCodes)
        .values({ tenantId: ids.tenant!, code: 'BACK20', kind: 'percent', value: '20' })
        .returning(),
    )
    const [seg] = await tx((db) =>
      db
        .insert(segments)
        .values({ tenantId: ids.tenant!, name: 'Everyone', rules: [{ kind: 'visits_at_least', count: 1 }] })
        .returning(),
    )
    const c = await newCampaign('October', { segmentId: seg!.id, promoCodeId: promo!.id })
    const sendAt = new Date(NOW.getTime() + 2 * DAY)
    const n = await tx((db) =>
      queueCampaign(db, c.id, undefined, { sendAt, bookingLink: 'https://camp.example/book', now: NOW }),
    )
    expect(n).toBe(3)
    const rows = await tx((db) =>
      db.select().from(outbox).where(eq(outbox.campaignId, c.id)).orderBy(asc(outbox.phoneE164)),
    )
    expect(rows.map((r) => r.text)).toEqual([
      'Hi Amira, use BACK20 at Camp Spa: https://camp.example/book',
      'مرحباً Bilal BACK20',
      'Hi Carla, use BACK20 at Camp Spa: https://camp.example/book',
    ])
    expect(rows.every((r) => r.dueAt.getTime() === sendAt.getTime() && r.kind === 'custom')).toBe(true)
    const [saved] = await tx((db) => db.select().from(campaigns).where(eq(campaigns.id, c.id)))
    expect(saved).toMatchObject({
      status: 'queued',
      recipients: 3,
      rules: [{ kind: 'visits_at_least', count: 1 }],
    })
    expect(saved!.stats).toEqual({ matched: 3, skippedRecent: 0, skippedOverLimit: 0, en: 2, ar: 1 })
    await expect(tx((db) => queueCampaign(db, c.id))).rejects.toThrow('already queued')
    ids.first = c.id
  })

  it('skips clients another campaign messages within 7 days', async () => {
    const soon = await newCampaign('Too soon')
    const n = await tx((db) =>
      queueCampaign(db, soon.id, [{ kind: 'language', language: 'en' }], {
        sendAt: new Date(NOW.getTime() + 5 * DAY),
        now: NOW,
      }),
    )
    expect(n).toBe(0)
    const [saved] = await tx((db) => db.select().from(campaigns).where(eq(campaigns.id, soon.id)))
    expect(saved!.stats).toMatchObject({ matched: 2, skippedRecent: 2 })

    // Far enough apart (2 Oct + 7 days < 17 Oct): not capped.
    const later = await tx((db) =>
      planAudience(db, ids.tenant!, [], { sendAt: new Date(NOW.getTime() + 10 * DAY), now: NOW }),
    )
    expect(later).toMatchObject({ matched: 3, skippedRecent: 0 })

    // Skipped messages don't count as "messaged".
    await tx((db) =>
      db.update(outbox).set({ status: 'skipped' }).where(eq(outbox.clientId, ids['Carla Diaz']!)),
    )
    const after = await tx((db) => planAudience(db, ids.tenant!, [], { sendAt: NOW, now: NOW }))
    expect(after.recipients.map((r) => r.name)).toEqual(['Carla Diaz'])
    expect(after.skippedRecent).toBe(2)
  })

  it(`caps a campaign at ${CAMPAIGN_LIMITS.maxRecipients} recipients`, async () => {
    expect(CAMPAIGN_LIMITS.maxRecipients).toBe(500)
    const plan = await tx((db) =>
      planAudience(db, ids.tenant!, [], { sendAt: new Date(NOW.getTime() + 30 * DAY), now: NOW, limit: 2 }),
    )
    expect(plan).toMatchObject({ matched: 3, skippedOverLimit: 1 })
    expect(plan.recipients.map((r) => r.name)).toEqual(['Bilal Saeed', 'Carla Diaz'])
  })

  it('counts clients who booked within 14 days of their message', async () => {
    const id = ids.first!
    const sentAt = new Date(NOW.getTime() + 2 * DAY)
    await tx((db) =>
      db.update(outbox).set({ status: 'sent', sentAt }).where(eq(outbox.clientId, ids['Amira Haddad']!)),
    )
    await tx((db) =>
      db.update(outbox).set({ status: 'sent', sentAt }).where(eq(outbox.clientId, ids['Bilal Saeed']!)),
    )
    await visit(ids['Amira Haddad']!, ids.v1!, new Date(sentAt.getTime() + 3 * DAY))
    await visit(ids['Bilal Saeed']!, ids.v1!, new Date(sentAt.getTime() + 20 * DAY)) // too late
    const results = await tx((db) => campaignResults(db, [id]))
    expect(results.get(id)).toEqual({
      total: 3,
      pending: 0,
      sent: 2,
      skipped: 1,
      bookedClients: 1,
      bookings: 1,
    })
    expect([...(await tx((db) => campaignBookedClients(db, id)))]).toEqual([ids['Amira Haddad']])
    expect(await tx((db) => finishCampaigns(db))).toBe(2)
    const [saved] = await tx((db) => db.select().from(campaigns).where(eq(campaigns.id, id)))
    expect(saved!.status).toBe('done')
  })

  it('duplicates into a draft and archiving withdraws unsent messages', async () => {
    const copy = await tx((db) => duplicateCampaign(db, ids.first!))
    expect(copy).toMatchObject({ name: 'October (copy)', status: 'draft', recipients: 0 })
    expect(copy.promoCodeId).not.toBeNull()
    const n = await tx((db) =>
      queueCampaign(db, copy.id, undefined, { sendAt: new Date(NOW.getTime() + 40 * DAY), now: NOW }),
    )
    expect(n).toBe(3)
    expect(await tx((db) => archiveCampaign(db, copy.id))).toBe(3)
    const [saved] = await tx((db) => db.select().from(campaigns).where(eq(campaigns.id, copy.id)))
    expect(saved!.archivedAt).not.toBeNull()
    expect(saved!.status).toBe('done')
    const rows = await tx((db) => db.select().from(outbox).where(eq(outbox.campaignId, copy.id)))
    expect(rows.every((r) => r.status === 'skipped')).toBe(true)
    await expect(tx((db) => queueCampaign(db, copy.id))).rejects.toThrow()
  })
})
