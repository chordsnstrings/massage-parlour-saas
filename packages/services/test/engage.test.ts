import { SYSTEM_ROLES } from '@spa/core'
import {
  businessDocuments,
  closeAllDbs,
  members,
  pushSubscriptions,
  roles,
  staff,
  staffDocuments,
  tenants,
  user,
  withTenant,
} from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const sendNotification = vi.fn()
vi.mock('web-push', () => ({ default: { sendNotification: (...a: unknown[]) => sendNotification(...a) } }))

const {
  documentStatus,
  documentsDueForReminder,
  documentSummary,
  expiryPhrase,
  filterDocuments,
  insightWeeks,
  isPushEndpoint,
  matchCategory,
  memberUserIds,
  normalizeReceipt,
  notifyTenant,
  parseAmount,
  parseReceiptDate,
  reminderMessage,
  savePushSubscription,
  shapeInsightsInput,
  sniffScanType,
  trackedDocuments,
} = await import('../src')
type WeekNumbers = import('../src').WeekNumbers

const { platform, app } = testDbs()
const ids = {} as Record<string, string>
const tx = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(ids.tenant!, fn, app)
const keys = { p256dh: 'BPk', auth: 'aa' }

beforeAll(async () => {
  await resetTestDatabase()
  const [t] = await platform.insert(tenants).values({ slug: 'engage', name: 'Engage Spa' }).returning()
  ids.tenant = t!.id
  await platform.insert(user).values(
    ['owner', 'reception', 'therapist', 'former', 'custom'].map((k) => ({
      id: `u-${k}`,
      name: k,
      email: `${k}@engage.test`,
    })),
  )
  await tx(async (db) => {
    const role = async (key: string, permissions: string[] = []) => {
      const [r] = await db
        .insert(roles)
        .values({ tenantId: ids.tenant!, key, name: key, permissions })
        .returning()
      return r!.id
    }
    const owner = await role('owner', [...SYSTEM_ROLES.owner.permissions])
    const reception = await role('receptionist')
    const therapist = await role('therapist')
    const custom = await role('front_desk_plus', ['calendar.manage', 'not.a.permission'])
    await db.insert(members).values([
      { tenantId: ids.tenant!, userId: 'u-owner', roleId: owner },
      { tenantId: ids.tenant!, userId: 'u-reception', roleId: reception },
      { tenantId: ids.tenant!, userId: 'u-therapist', roleId: therapist },
      { tenantId: ids.tenant!, userId: 'u-former', roleId: reception, status: 'disabled' },
      { tenantId: ids.tenant!, userId: 'u-custom', roleId: custom },
    ])
    const [maya] = await db.insert(staff).values({ tenantId: ids.tenant!, displayName: 'Maya' }).returning()
    ids.maya = maya!.id
    const [lina] = await db.insert(staff).values({ tenantId: ids.tenant!, displayName: 'Lina' }).returning()
    ids.lina = lina!.id
    await db.insert(staffDocuments).values([
      { tenantId: ids.tenant!, staffId: maya!.id, type: 'visa', expiresOn: '2026-10-16', number: 'V1' },
      { tenantId: ids.tenant!, staffId: maya!.id, type: 'health_card', expiresOn: '2026-10-01' },
      { tenantId: ids.tenant!, staffId: lina!.id, type: 'emirates_id', expiresOn: '2026-12-05' },
      { tenantId: ids.tenant!, staffId: lina!.id, type: 'passport', expiresOn: '2030-01-01' },
      { tenantId: ids.tenant!, staffId: lina!.id, type: 'Custom permit' },
    ])
    await db
      .insert(businessDocuments)
      .values([
        { tenantId: ids.tenant!, type: 'trade_licence', expiresOn: '2026-10-13', issuedOn: '2025-10-14' },
      ])
  })
})

afterAll(async () => {
  await closeAllDbs()
})

describe('push notifications', () => {
  beforeEach(async () => {
    sendNotification.mockReset()
    await platform.delete(pushSubscriptions)
  })

  it('targets active members whose role grants the permission', async () => {
    const users = await memberUserIds(ids.tenant!, 'calendar.manage', app)
    expect(users.sort()).toEqual(['u-custom', 'u-owner', 'u-reception'])
    expect(await memberUserIds(ids.tenant!, 'staff.manage', app)).toEqual(['u-owner'])
    expect(await memberUserIds(ids.tenant!, 'calendar.view', app)).toContain('u-therapist')
  })

  it('is a no-op without VAPID keys', async () => {
    vi.stubEnv('VAPID_PUBLIC_KEY', '')
    const res = await notifyTenant(
      ids.tenant!,
      { title: 'x', body: 'y' },
      { permission: 'calendar.manage', db: platform, appDb: app },
    )
    expect(res.skipped).toBe('not_configured')
    expect(sendNotification).not.toHaveBeenCalled()
    vi.unstubAllEnvs()
  })

  it('sends via web-push with VAPID details and prunes gone endpoints', async () => {
    vi.stubEnv('VAPID_PUBLIC_KEY', 'pub')
    vi.stubEnv('VAPID_PRIVATE_KEY', 'priv')
    vi.stubEnv('VAPID_SUBJECT', 'mailto:ops@example.test')
    await savePushSubscription(
      'u-owner',
      { endpoint: 'https://fcm.googleapis.com/fcm/send/owner-phone', keys },
      platform,
    )
    await savePushSubscription(
      'u-owner',
      { endpoint: 'https://fcm.googleapis.com/fcm/send/owner-old', keys },
      platform,
    )
    await savePushSubscription(
      'u-reception',
      { endpoint: 'https://fcm.googleapis.com/fcm/send/desk', keys },
      platform,
    )
    await savePushSubscription(
      'u-therapist',
      { endpoint: 'https://fcm.googleapis.com/fcm/send/therapist', keys },
      platform,
    )
    await savePushSubscription(
      'u-former',
      { endpoint: 'https://fcm.googleapis.com/fcm/send/former', keys },
      platform,
    )
    sendNotification.mockImplementation(async (sub: { endpoint: string }) => {
      if (sub.endpoint.endsWith('owner-old')) throw Object.assign(new Error('Gone'), { statusCode: 410 })
      if (sub.endpoint.endsWith('desk')) throw Object.assign(new Error('Server error'), { statusCode: 500 })
      return { statusCode: 201 }
    })

    const res = await notifyTenant(
      ids.tenant!,
      { title: 'New online booking', body: 'Swedish 60 min · Thu 8 Oct 14:00', url: '/engage/calendar' },
      { permission: 'calendar.manage', db: platform, appDb: app },
    )
    expect(res).toEqual({ sent: 1, pruned: 1, failed: 1 })
    const endpoints = sendNotification.mock.calls.map((c) => (c[0] as { endpoint: string }).endpoint).sort()
    expect(endpoints).toEqual([
      'https://fcm.googleapis.com/fcm/send/desk',
      'https://fcm.googleapis.com/fcm/send/owner-old',
      'https://fcm.googleapis.com/fcm/send/owner-phone',
    ])
    const [, payload, options] = sendNotification.mock.calls[0]!
    expect(JSON.parse(payload as string)).toMatchObject({
      title: 'New online booking',
      url: '/engage/calendar',
    })
    expect(options).toMatchObject({ vapidDetails: { publicKey: 'pub', privateKey: 'priv' } })

    const left = await platform.select({ endpoint: pushSubscriptions.endpoint }).from(pushSubscriptions)
    expect(left.map((r) => r.endpoint)).not.toContain('https://fcm.googleapis.com/fcm/send/owner-old')
    expect(left).toHaveLength(4)
    vi.unstubAllEnvs()
  })

  it('only accepts endpoints on known push services', () => {
    for (const ok of [
      'https://fcm.googleapis.com/fcm/send/abc',
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://wns2-par02p.notify.windows.com/w/?token=abc',
      'https://web.push.apple.com/QGx',
    ])
      expect(isPushEndpoint(ok), ok).toBe(true)
    for (const bad of [
      'http://fcm.googleapis.com/fcm/send/abc',
      'https://fcm.googleapis.com:8443/fcm/send/abc',
      'https://fcm.googleapis.com.evil.test/x',
      'https://169.254.169.254/latest/meta-data',
      'https://127.0.0.1/x',
      'https://localhost/x',
      'https://[::1]/x',
      'https://user:pw@fcm.googleapis.com/x',
      'not a url',
    ])
      expect(isPushEndpoint(bad), bad).toBe(false)
  })

  it('never contacts a stored endpoint outside the push services', async () => {
    vi.stubEnv('VAPID_PUBLIC_KEY', 'pub')
    vi.stubEnv('VAPID_PRIVATE_KEY', 'priv')
    vi.stubEnv('VAPID_SUBJECT', 'mailto:ops@example.test')
    await savePushSubscription('u-owner', { endpoint: 'https://10.0.0.5/internal', keys }, platform)
    const res = await notifyTenant(
      ids.tenant!,
      { title: 'x', body: 'y' },
      { permission: 'calendar.manage', db: platform, appDb: app },
    )
    expect(res).toEqual({ sent: 0, pruned: 0, failed: 1 })
    expect(sendNotification).not.toHaveBeenCalled()
    vi.unstubAllEnvs()
  })

  it('moves an endpoint to whoever subscribed last', async () => {
    await savePushSubscription(
      'u-owner',
      { endpoint: 'https://fcm.googleapis.com/fcm/send/shared', keys },
      platform,
    )
    await savePushSubscription(
      'u-reception',
      { endpoint: 'https://fcm.googleapis.com/fcm/send/shared', keys },
      platform,
    )
    const rows = await platform
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, 'https://fcm.googleapis.com/fcm/send/shared'))
    expect(rows.map((r) => r.userId)).toEqual(['u-reception'])
  })
})

describe('documents', () => {
  it('trusts a scan’s bytes, not its declared type', () => {
    const b = (...xs: (number | string)[]) =>
      Buffer.concat(xs.map((x) => (typeof x === 'string' ? Buffer.from(x, 'latin1') : Buffer.from([x]))))
    expect(sniffScanType(b(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg')
    expect(sniffScanType(b(0x89, 'PNG\r\n', 0x1a, '\n', 0))).toBe('image/png')
    expect(sniffScanType(b('RIFF', 0, 0, 0, 0, 'WEBPVP8 '))).toBe('image/webp')
    expect(sniffScanType(b('%PDF-1.7'))).toBe('application/pdf')
    expect(sniffScanType(b('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull()
    expect(sniffScanType(b('GIF89a'))).toBeNull()
    expect(sniffScanType(b('RIFF', 0, 0, 0, 0, 'WAVE'))).toBeNull()
    expect(sniffScanType(new Uint8Array())).toBeNull()
  })

  it('derives status from days left', () => {
    const today = '2026-10-06'
    expect(documentStatus(null, today)).toEqual({ status: 'none', days: null })
    expect(documentStatus('2026-10-05', today)).toEqual({ status: 'expired', days: -1 })
    expect(documentStatus('2026-10-06', today)).toEqual({ status: 'due30', days: 0 })
    expect(documentStatus('2026-11-05', today)).toEqual({ status: 'due30', days: 30 })
    expect(documentStatus('2026-11-06', today)).toEqual({ status: 'due60', days: 31 })
    expect(documentStatus('2026-12-05', today)).toEqual({ status: 'due60', days: 60 })
    expect(documentStatus('2026-12-06', today)).toEqual({ status: 'ok', days: 61 })
    expect(expiryPhrase(-3)).toBe('Expired 3 days ago')
    expect(expiryPhrase(0)).toBe('Expires today')
    expect(expiryPhrase(10)).toBe('Expires in 10 days')
  })

  it('lists, filters and summarises staff + business documents', async () => {
    const docs = await tx((db) => trackedDocuments(db, '2026-10-06'))
    expect(docs.map((d) => `${d.owner}:${d.type}:${d.status}`)).toEqual([
      'Maya:health_card:expired',
      'Business:trade_licence:due30',
      'Maya:visa:due30',
      'Lina:emirates_id:due60',
      'Lina:passport:ok',
      'Lina:Custom permit:none',
    ])
    expect(docs[1]).toMatchObject({ typeLabel: 'Trade licence', issuedOn: '2025-10-14', days: 7 })
    expect(filterDocuments(docs, { staffId: ids.maya })).toHaveLength(2)
    expect(filterDocuments(docs, { staffId: 'business' })).toHaveLength(1)
    expect(filterDocuments(docs, { status: 'due30' }).map((d) => d.type)).toEqual(['trade_licence', 'visa'])

    const summary = await tx((db) => documentSummary(db, new Date('2026-10-06T08:00:00Z')))
    expect(summary).toMatchObject({ expired: 1, due30: 2, due60: 1, ok: 1, none: 1, total: 6 })
    expect(summary.attention.map((d) => d.type)).toEqual([
      'health_card',
      'trade_licence',
      'visa',
      'emirates_id',
    ])
  })

  it('reminds at 60/30/7/0 days, once per milestone', async () => {
    // 2026-10-06 in Dubai: trade licence has 7 days left, Emirates ID 60.
    const due = await tx((db) => documentsDueForReminder(db, new Date('2026-10-06T05:00:00Z')))
    expect(due.map((d) => `${d.type}:${d.days}`)).toEqual(['trade_licence:7', 'emirates_id:60'])
    expect(reminderMessage(due)).toEqual({
      title: '2 documents need renewing',
      body: 'Trade licence: expires in 7 days\nEmirates ID — Lina: expires in 60 days',
    })
    const visaDay = await tx((db) => documentsDueForReminder(db, new Date('2026-10-16T05:00:00Z')))
    expect(reminderMessage(visaDay)).toEqual({
      title: 'A document expires today',
      body: 'Visa / residence permit — Maya: expires today',
    })
    expect(reminderMessage([])).toBeNull()
  })

  it('skips reminders for staff who have left', async () => {
    const [sara] = await tx((db) =>
      db.insert(staff).values({ tenantId: ids.tenant!, displayName: 'Sara', active: false }).returning(),
    )
    await tx((db) =>
      db
        .insert(staffDocuments)
        .values({ tenantId: ids.tenant!, staffId: sara!.id, type: 'visa', expiresOn: '2026-10-13' }),
    )
    const docs = await tx((db) => trackedDocuments(db, '2026-10-06'))
    expect(docs.find((d) => d.owner === 'Sara')).toMatchObject({ ownerActive: false, days: 7 })
    const due = await tx((db) => documentsDueForReminder(db, new Date('2026-10-06T05:00:00Z')))
    expect(due.map((d) => `${d.type}:${d.days}`)).toEqual(['trade_licence:7', 'emirates_id:60'])
    await tx((db) => db.delete(staffDocuments).where(eq(staffDocuments.staffId, sara!.id)))
    await tx((db) => db.delete(staff).where(eq(staff.id, sara!.id)))
  })
})

describe('insights input', () => {
  const week = (over: Partial<WeekNumbers>): WeekNumbers => ({
    from: '2026-09-29',
    to: '2026-10-05',
    revenue: 0,
    averageTicket: 0,
    bookings: 0,
    completed: 0,
    noShows: 0,
    noShowRate: null,
    utilisation: null,
    topServices: [],
    newClients: 0,
    returningClients: 0,
    onlineBookings: 0,
    onlineShare: null,
    visitors: 0,
    ...over,
  })

  it('picks the last 7 complete business days and the week before', () => {
    // Monday 08:00 Dubai → Mon–Sun of the previous week.
    expect(insightWeeks(new Date('2026-10-05T04:00:00Z'))).toEqual({
      thisWeek: { from: '2026-09-28', to: '2026-10-04' },
      lastWeek: { from: '2026-09-21', to: '2026-09-27' },
    })
  })

  it('shapes week-over-week changes for counts and rates', () => {
    const a = week({
      revenue: 12_000,
      bookings: 40,
      averageTicket: 300,
      utilisation: 0.62,
      noShowRate: 0.05,
      noShows: 2,
      newClients: 9,
      returningClients: 25,
      onlineShare: 0.35,
      onlineBookings: 14,
      visitors: 310,
      topServices: [{ name: 'Swedish', revenue: 5000, count: 14 }],
    })
    const b = week({
      from: '2026-09-22',
      to: '2026-09-28',
      revenue: 10_000,
      bookings: 40,
      averageTicket: 250,
      utilisation: 0.55,
      noShowRate: 0.1,
      noShows: 4,
      newClients: 0,
      returningClients: 20,
      onlineShare: 0.25,
      visitors: 0,
    })
    const input = shapeInsightsInput(a, b)
    const m = Object.fromEntries(input.metrics.map((x) => [x.key, x]))
    expect(m.revenue).toMatchObject({ thisWeek: 12000, lastWeek: 10000, change: '+20%' })
    expect(m.bookings!.change).toBe('0%')
    expect(m.utilisation).toMatchObject({ thisWeek: 62, lastWeek: 55, change: '+7 pts' })
    expect(m.no_show_rate!.change).toBe('-5 pts')
    expect(m.no_shows!.change).toBe('-50%')
    expect(m.new_clients!.change).toBeNull() // from zero: no percentage
    expect(m.visitors!.change).toBeNull()
    expect(input.topServices.thisWeek[0]!.name).toBe('Swedish')
    expect(input.hasActivity).toBe(true)
    expect(input.notes).toEqual([])
  })

  it('flags empty weeks and missing data', () => {
    const input = shapeInsightsInput(week({}), week({}))
    expect(input.hasActivity).toBe(false)
    expect(input.metrics.find((x) => x.key === 'utilisation')!.change).toBeNull()
    expect(input.notes).toHaveLength(3)
  })
})

describe('receipt parsing', () => {
  const today = '2026-10-06'

  it('parses amounts, dates and TRNs in common receipt formats', () => {
    expect(parseAmount('AED 1,234.50')).toBe(1234.5)
    expect(parseAmount('1.234,50')).toBe(1234.5)
    expect(parseAmount(99.999)).toBe(100)
    expect(parseAmount('n/a')).toBeNull()
    expect(parseAmount(-5)).toBeNull()
    expect(parseReceiptDate('2026-10-01', today)).toBe('2026-10-01')
    expect(parseReceiptDate('01/10/2026', today)).toBe('2026-10-01')
    expect(parseReceiptDate('1-10-26', today)).toBe('2026-10-01')
    expect(parseReceiptDate('3 Oct 2026', today)).toBe('2026-10-03')
    expect(parseReceiptDate('October 3, 2026', today)).toBe('2026-10-03')
    expect(parseReceiptDate('31/02/2026', today)).toBeNull()
    expect(parseReceiptDate('2027-01-01', today)).toBeNull() // future
  })

  it('maps categories by code, name or vendor keywords', () => {
    expect(matchCategory('6200')).toBe('6200')
    expect(matchCategory('Rent')).toBe('6100')
    expect(matchCategory('utilities bill')).toBe('6200')
    expect(matchCategory(null, 'Dubai Electricity & Water Authority (DEWA)')).toBe('6200')
    expect(matchCategory('', 'Amer Centre Al Barsha')).toBe('6500')
    expect(matchCategory('groceries', 'Spinneys')).toBeNull()
  })

  it('normalises the model JSON and drops impossible values', () => {
    expect(
      normalizeReceipt(
        {
          vendor: '  Dubai Electricity &   Water Authority ',
          date: '28/09/2026',
          total: 'AED 1,050.00',
          vat: '50.00',
          trn: '100 2345 6789 0003',
          currency: 'aed',
          category: 'Utilities',
        },
        today,
      ),
    ).toEqual({
      vendor: 'Dubai Electricity & Water Authority',
      date: '2026-09-28',
      totalAed: 1050,
      vatAed: 50,
      trn: '100234567890003',
      currency: 'AED',
      category: '6200',
    })
    expect(normalizeReceipt({ total: 100, vat: 90, trn: '12345' }, today)).toMatchObject({
      totalAed: 100,
      vatAed: null,
      trn: null,
      vendor: null,
      date: null,
    })
    expect(normalizeReceipt('not json', today)).toBeNull()
    expect(normalizeReceipt([1, 2], today)).toBeNull()
  })
})
