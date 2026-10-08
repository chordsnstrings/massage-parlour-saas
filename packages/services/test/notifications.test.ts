import { SYSTEM_ROLES } from '@spa/core'
import {
  bookingItems,
  bookings,
  branches,
  businessDocuments,
  clients,
  closeAllDbs,
  members,
  notifications,
  platformInvoices,
  platformReminders,
  products,
  pushSubscriptions,
  reviews,
  roles,
  socialPosts,
  stockLevels,
  tenants,
  user,
  withTenant,
} from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  aiDraftNotices,
  billingNotices,
  createNotification,
  documentExpiryNotices,
  listNotifications,
  lowStockNotices,
  markAllNotificationsRead,
  markNotificationRead,
  notify,
  pendingBookingNotices,
  pruneNotifications,
  unreadNotificationCount,
  type Viewer,
} from '../src'

const { platform, app } = testDbs()
const ids = {} as Record<string, string>
const tx = <T>(fn: Parameters<typeof withTenant<T>>[1], tenant = ids.tenant!) => withTenant(tenant, fn, app)
const owner: Viewer = { userId: 'n-owner', permissions: SYSTEM_ROLES.owner.permissions }
const desk: Viewer = { userId: 'n-desk', permissions: SYSTEM_ROLES.receptionist.permissions }
const desk2: Viewer = { userId: 'n-desk2', permissions: SYSTEM_ROLES.receptionist.permissions }
const now = new Date('2026-10-08T08:00:00Z') // 12:00 Dubai

beforeAll(async () => {
  await resetTestDatabase()
  const [t] = await platform.insert(tenants).values({ slug: 'notif', name: 'Notif Spa' }).returning()
  const [o] = await platform.insert(tenants).values({ slug: 'other', name: 'Other Spa' }).returning()
  ids.tenant = t!.id
  ids.other = o!.id
  await platform.insert(user).values([
    { id: 'n-owner', name: 'Owner', email: 'owner@notif.test', locale: 'th' },
    { id: 'n-desk', name: 'Desk', email: 'desk@notif.test' },
    { id: 'n-desk2', name: 'Desk 2', email: 'desk2@notif.test' },
    { id: 'n-therapist', name: 'Ther', email: 'ther@notif.test' },
  ])
  await tx(async (db) => {
    const role = async (key: keyof typeof SYSTEM_ROLES) => {
      const [r] = await db
        .insert(roles)
        .values({ tenantId: ids.tenant!, key, name: key, permissions: [...SYSTEM_ROLES[key].permissions] })
        .returning()
      return r!.id
    }
    const [ownerRole, deskRole, therRole] = [
      await role('owner'),
      await role('receptionist'),
      await role('therapist'),
    ]
    await db.insert(members).values([
      { tenantId: ids.tenant!, userId: 'n-owner', roleId: ownerRole },
      { tenantId: ids.tenant!, userId: 'n-desk', roleId: deskRole },
      { tenantId: ids.tenant!, userId: 'n-desk2', roleId: deskRole },
      { tenantId: ids.tenant!, userId: 'n-therapist', roleId: therRole },
    ])
    const [b] = await db
      .insert(branches)
      .values({ tenantId: ids.tenant!, name: 'Marina', isDefault: true })
      .returning()
    ids.branch = b!.id
    const [c] = await db
      .insert(clients)
      .values({ tenantId: ids.tenant!, name: 'Mia', phoneE164: '+971500000001' })
      .returning()
    const booking = async (status: 'pending' | 'confirmed', createdAt: Date, startsAt: Date, ref: string) => {
      const [bk] = await db
        .insert(bookings)
        .values({
          tenantId: ids.tenant!,
          branchId: b!.id,
          clientId: c!.id,
          refCode: ref,
          source: 'online',
          status,
          businessDate: '2026-10-08',
          startsAt,
          endsAt: new Date(startsAt.getTime() + 3600_000),
          createdAt,
        })
        .returning()
      await db.insert(bookingItems).values({
        tenantId: ids.tenant!,
        bookingId: bk!.id,
        serviceName: 'Thai massage',
        durationMin: 60,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3600_000),
      })
      return bk!.id
    }
    const old = new Date(now.getTime() - 3600_000)
    ids.pending = await booking('pending', old, new Date(now.getTime() + 4 * 3600_000), 'P1')
    await booking('pending', new Date(now.getTime() - 5 * 60_000), new Date(now.getTime() + 3600_000), 'P2') // too fresh
    await booking('confirmed', old, new Date(now.getTime() + 3600_000), 'P3')
    await booking('pending', old, new Date(now.getTime() - 3600_000), 'P4') // already started
    const [oil] = await db
      .insert(products)
      .values({ tenantId: ids.tenant!, kind: 'consumable', name: { en: 'Massage oil' }, lowStockAt: '5' })
      .returning()
    const [towel] = await db
      .insert(products)
      .values({ tenantId: ids.tenant!, kind: 'retail', name: { en: 'Towel' }, lowStockAt: '2' })
      .returning()
    await db.insert(stockLevels).values([
      { tenantId: ids.tenant!, branchId: b!.id, productId: oil!.id, qty: '3' },
      { tenantId: ids.tenant!, branchId: b!.id, productId: towel!.id, qty: '9' },
      { tenantId: ids.tenant!, branchId: null, productId: towel!.id, qty: '1' },
    ])
    await db.insert(socialPosts).values([
      { tenantId: ids.tenant!, platform: 'instagram', caption: 'a', status: 'pending_approval' },
      { tenantId: ids.tenant!, platform: 'instagram', caption: 'b', status: 'published' },
    ])
    await db.insert(reviews).values({
      tenantId: ids.tenant!,
      externalId: 'r1',
      rating: 5,
      replyText: 'Thanks!',
      replyStatus: 'draft',
    })
  })
  const [inv] = await platform
    .insert(platformInvoices)
    .values({
      tenantId: ids.tenant!,
      number: 'SPA-2026-0001',
      issueDate: '2026-09-01',
      dueDate: '2026-09-15',
      description: 'Plan',
      subtotalAed: '2000',
      vatAed: '100',
      totalAed: '2100',
    })
    .returning()
  ids.invoice = inv!.id
  const [rem] = await platform
    .insert(platformReminders)
    .values({ tenantId: ids.tenant!, message: 'Please pay', amountAed: '2100' })
    .returning()
  ids.reminder = rem!.id
})

afterAll(async () => {
  await closeAllDbs()
})

describe('notification store', () => {
  beforeEach(async () => {
    await platform.delete(notifications)
  })

  it('dedupes on the key, per tenant', async () => {
    const n = {
      tenantId: ids.tenant!,
      kind: 'booking.online' as const,
      dedupeKey: 'k1',
      url: '/notif/calendar',
    }
    expect(await tx((db) => createNotification(db, n))).not.toBeNull()
    expect(await tx((db) => createNotification(db, n))).toBeNull()
    expect(await tx((db) => createNotification(db, { ...n, dedupeKey: null }))).not.toBeNull()
    expect(await tx((db) => createNotification(db, { ...n, dedupeKey: null }))).not.toBeNull()
    expect(
      await tx((db) => createNotification(db, { ...n, tenantId: ids.other! }), ids.other!),
    ).not.toBeNull()
    expect(await tx((db) => unreadNotificationCount(db, desk))).toBe(3)
  })

  it('filters by permission and recipient; tenants never see each other', async () => {
    await tx(async (db) => {
      await createNotification(db, { tenantId: ids.tenant!, kind: 'booking.online' })
      await createNotification(db, { tenantId: ids.tenant!, kind: 'billing.overdue' })
      await createNotification(db, { tenantId: ids.tenant!, kind: 'stock.low', userId: 'n-owner' })
      await createNotification(db, { tenantId: ids.tenant!, kind: 'booking.pending', userId: 'n-desk2' })
    })
    await tx((db) => createNotification(db, { tenantId: ids.other!, kind: 'booking.online' }), ids.other!)
    const kinds = async (v: Viewer) => (await tx((db) => listNotifications(db, v))).map((n) => n.kind).sort()
    expect(await kinds(owner)).toEqual(['billing.overdue', 'booking.online', 'stock.low'])
    expect(await kinds(desk)).toEqual(['booking.online'])
    expect(await kinds(desk2)).toEqual(['booking.online', 'booking.pending'])
    expect(await kinds({ userId: 'x', permissions: [] })).toEqual([])
  })

  it('tracks read state per user for shared rows and on the row for personal ones', async () => {
    const shared = await tx((db) => createNotification(db, { tenantId: ids.tenant!, kind: 'booking.online' }))
    const mine = await tx((db) =>
      createNotification(db, { tenantId: ids.tenant!, kind: 'booking.pending', userId: 'n-desk' }),
    )
    const billing = await tx((db) =>
      createNotification(db, { tenantId: ids.tenant!, kind: 'billing.overdue' }),
    )
    expect(await tx((db) => markNotificationRead(db, desk, shared!.id))).toBe(true)
    expect(await tx((db) => markNotificationRead(db, desk, shared!.id))).toBe(true) // idempotent
    expect(await tx((db) => markNotificationRead(db, desk, billing!.id))).toBe(false) // not visible to desk
    expect(await tx((db) => markNotificationRead(db, desk2, mine!.id))).toBe(false) // someone else's
    expect(await tx((db) => unreadNotificationCount(db, desk))).toBe(1)
    expect(await tx((db) => unreadNotificationCount(db, desk2))).toBe(1) // colleague's read doesn't count
    const unreadOnly = await tx((db) => listNotifications(db, desk, { unreadOnly: true }))
    expect(unreadOnly.map((n) => n.id)).toEqual([mine!.id])
    expect(await tx((db) => markAllNotificationsRead(db, desk))).toBe(1)
    expect(await tx((db) => markAllNotificationsRead(db, desk))).toBe(0)
    expect(await tx((db) => unreadNotificationCount(db, desk))).toBe(0)
    expect(await tx((db) => markAllNotificationsRead(db, owner))).toBe(2)
    expect(await tx((db) => unreadNotificationCount(db, desk2))).toBe(1)
    const all = await tx((db) => listNotifications(db, desk))
    expect(all.every((n) => n.readAt instanceof Date)).toBe(true)
  })

  it('pages with before + limit and prunes old rows', async () => {
    await tx(async (db) => {
      for (let i = 0; i < 5; i++) {
        const row = await createNotification(db, { tenantId: ids.tenant!, kind: 'booking.online' })
        await db
          .update(notifications)
          .set({ createdAt: new Date(now.getTime() - i * 86_400_000) })
          .where(eq(notifications.id, row!.id))
      }
    })
    const first = await tx((db) => listNotifications(db, desk, { limit: 2 }))
    expect(first).toHaveLength(2)
    const next = await tx((db) => listNotifications(db, desk, { limit: 10, before: first[1]!.createdAt }))
    expect(next).toHaveLength(3)
    expect(await tx((db) => pruneNotifications(db, new Date(now.getTime() - 2.5 * 86_400_000)))).toBe(2)
  })
})

describe('notify + push', () => {
  const send = vi.fn(async () => undefined)
  beforeEach(async () => {
    send.mockClear()
    await platform.delete(notifications)
    await platform.delete(pushSubscriptions)
    await platform.insert(pushSubscriptions).values([
      {
        userId: 'n-owner',
        endpoint: 'https://fcm.googleapis.com/fcm/send/owner',
        keys: { p256dh: 'p', auth: 'a' },
      },
      {
        userId: 'n-desk',
        endpoint: 'https://fcm.googleapis.com/fcm/send/desk',
        keys: { p256dh: 'p', auth: 'a' },
      },
      {
        userId: 'n-therapist',
        endpoint: 'https://fcm.googleapis.com/fcm/send/ther',
        keys: { p256dh: 'p', auth: 'a' },
      },
    ])
  })

  it('pushes once per event to permitted members, each in their own locale', async () => {
    const n = {
      tenantId: ids.tenant!,
      kind: 'booking.online' as const,
      params: { name: 'Mia', service: 'Thai massage', at: '2026-10-09T10:00:00Z' },
      url: '/notif/calendar?date=2026-10-09',
      dedupeKey: 'booking.online:x',
    }
    const res = await notify(n, { db: platform, appDb: app, send })
    expect(res).toMatchObject({ created: true, push: { sent: 2, failed: 0 } })
    const payloads = send.mock.calls.map((c) => JSON.parse((c as unknown as [unknown, string])[1]))
    const byEndpoint = Object.fromEntries(
      send.mock.calls.map((c, i) => [(c as unknown as [{ endpoint: string }])[0].endpoint, payloads[i]]),
    )
    expect(byEndpoint['https://fcm.googleapis.com/fcm/send/desk'].title).toBe('New online booking')
    expect(byEndpoint['https://fcm.googleapis.com/fcm/send/owner'].title).toBe('มีการจองออนไลน์ใหม่')
    expect(byEndpoint['https://fcm.googleapis.com/fcm/send/desk'].url).toBe('/notif/calendar?date=2026-10-09')
    expect(await notify(n, { db: platform, appDb: app, send })).toEqual({ created: false })
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('a personal notification reaches only its user, and only with the permission', async () => {
    await notify(
      { tenantId: ids.tenant!, kind: 'booking.pending', userId: 'n-desk' },
      { db: platform, appDb: app, send },
    )
    expect(send).toHaveBeenCalledTimes(1)
    await notify(
      { tenantId: ids.tenant!, kind: 'billing.overdue', userId: 'n-desk' },
      { db: platform, appDb: app, send },
    )
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('stores the row even when push is not configured', async () => {
    vi.stubEnv('VAPID_PUBLIC_KEY', '')
    const res = await notify({ tenantId: ids.tenant!, kind: 'ai.drafts' }, { db: platform, appDb: app })
    expect(res).toMatchObject({ created: true, push: { sent: 0 } })
    vi.unstubAllEnvs()
  })
})

describe('producers', () => {
  const scope = () => ({ tenantId: ids.tenant!, slug: 'notif', now })

  it('pending bookings: only stale pending ones for upcoming visits', async () => {
    const out = await tx((db) => pendingBookingNotices(db, scope()))
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      kind: 'booking.pending',
      dedupeKey: `booking.pending:${ids.pending}`,
      params: { name: 'Mia', service: 'Thai massage' },
      url: '/notif/calendar?date=2026-10-08',
    })
  })

  it('low stock: one per location, warehouse named by key, deduped per day', async () => {
    const out = await tx((db) => lowStockNotices(db, scope()))
    const branch = out.find((n) => n.dedupeKey === `stock.low:${ids.branch}:2026-10-08`)
    const wh = out.find((n) => n.dedupeKey === 'stock.low:warehouse:2026-10-08')
    expect(out).toHaveLength(2)
    expect(branch?.params).toEqual({ count: 1, location: 'Marina', products: 'Massage oil' })
    expect(wh?.params).toMatchObject({ location: { key: 'notifications.warehouse' }, products: 'Towel' })
    expect(wh?.url).toBe('/notif/warehouse')
  })

  it('AI drafts + billing + documents', async () => {
    const [ai] = await tx((db) => aiDraftNotices(db, scope()))
    expect(ai).toMatchObject({ params: { count: 2, posts: 1, replies: 1 }, url: '/notif/ai/content' })
    const billing = await tx((db) => billingNotices(db, scope()))
    expect(billing.map((b) => b.dedupeKey).sort()).toEqual(
      [`billing.overdue:${ids.invoice}`, `billing.reminder:${ids.reminder}`].sort(),
    )
    expect(billing.find((b) => b.kind === 'billing.overdue')?.params).toMatchObject({
      number: 'SPA-2026-0001',
      date: '2026-09-15',
    })
    expect(await tx((db) => documentExpiryNotices(db, scope()))).toEqual([]) // nothing at a milestone yet
    await tx((db) =>
      db.insert(businessDocuments).values([
        { tenantId: ids.tenant!, type: 'trade_licence', expiresOn: '2026-10-15' },
        { tenantId: ids.tenant!, type: 'civil_defence', expiresOn: '2026-11-07' },
      ]),
    )
    const [doc] = await tx((db) => documentExpiryNotices(db, scope()))
    expect(doc).toMatchObject({
      dedupeKey: 'document.expiry:2026-10-08',
      params: { count: 2, more: 1, date: '2026-10-15' },
      url: '/notif/documents',
    })
  })

  it('a producer run twice notifies once', async () => {
    await platform.delete(notifications)
    for (let i = 0; i < 2; i++)
      for (const n of await tx((db) => lowStockNotices(db, scope())))
        await notify(n, { db: platform, appDb: app })
    expect(await tx((db) => unreadNotificationCount(db, owner))).toBe(2)
  })
})
