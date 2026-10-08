import {
  bookings,
  branches,
  closeAllDbs,
  notifications,
  platformInvoices,
  products,
  stockLevels,
  tenants,
} from '@spa/db'
import { resetTestDatabase, testDbs, testUrls } from '@spa/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  notifyBilling,
  notifyLowStock,
  notifyPendingBookings,
  pruneAllNotifications,
} from '../src/jobs/notifications'

const { owner } = testDbs()
const now = new Date('2026-10-08T08:00:00Z')

async function seedSpa(slug: string, status: 'active' | 'cancelled' = 'active') {
  const [t] = await owner.insert(tenants).values({ slug, name: slug, status }).returning()
  const [b] = await owner
    .insert(branches)
    .values({ tenantId: t!.id, name: 'Main', isDefault: true })
    .returning()
  await owner.insert(bookings).values({
    tenantId: t!.id,
    branchId: b!.id,
    refCode: `${slug}-1`,
    source: 'online',
    businessDate: '2026-10-08',
    startsAt: new Date(now.getTime() + 3 * 3600_000),
    endsAt: new Date(now.getTime() + 4 * 3600_000),
    createdAt: new Date(now.getTime() - 3600_000),
  })
  const [p] = await owner
    .insert(products)
    .values({ tenantId: t!.id, kind: 'consumable', name: { en: 'Oil' }, lowStockAt: '5' })
    .returning()
  await owner.insert(stockLevels).values({ tenantId: t!.id, branchId: b!.id, productId: p!.id, qty: '1' })
  return t!.id
}

const rows = (tenantId: string) =>
  owner.select().from(notifications).where(eq(notifications.tenantId, tenantId))

describe('notification jobs', () => {
  let a: string
  let gone: string
  beforeAll(async () => {
    process.env.DATABASE_URL_PLATFORM = testUrls.platform
    process.env.DATABASE_URL_APP = testUrls.app
    await resetTestDatabase()
    a = await seedSpa('notif-a')
    gone = await seedSpa('notif-gone', 'cancelled')
  }, 60_000)
  afterAll(closeAllDbs)

  it('creates bell rows once per event, only for active spas', async () => {
    expect(await notifyPendingBookings(now)).toMatchObject({ created: 1 })
    expect(await notifyPendingBookings(now)).toMatchObject({ created: 0 })
    expect(await notifyLowStock(now)).toMatchObject({ created: 1 })
    expect(await notifyLowStock(now)).toMatchObject({ created: 0 })
    // Next day the low-stock summary repeats while stock is still low.
    expect(await notifyLowStock(new Date(now.getTime() + 86_400_000))).toMatchObject({ created: 1 })
    const kinds = (await rows(a)).map((r) => r.kind).sort()
    expect(kinds).toEqual(['booking.pending', 'stock.low', 'stock.low'])
    expect((await rows(a)).find((r) => r.kind === 'booking.pending')?.permission).toBe('calendar.manage')
    expect(await rows(gone)).toEqual([])
  })

  it('notifies overdue platform invoices once per invoice', async () => {
    await owner.insert(platformInvoices).values({
      tenantId: a,
      number: 'SPA-W-1',
      issueDate: '2026-09-01',
      dueDate: '2026-09-15',
      description: 'Plan',
      subtotalAed: '100',
      vatAed: '5',
      totalAed: '105',
    })
    expect(await notifyBilling(now)).toMatchObject({ created: 1 })
    expect(await notifyBilling(now)).toMatchObject({ created: 0 })
  })

  it('prunes rows older than 90 days', async () => {
    await owner.update(notifications).set({ createdAt: new Date(now.getTime() - 100 * 86_400_000) })
    expect(await pruneAllNotifications(now)).toEqual({ pruned: 4 })
  })
})
