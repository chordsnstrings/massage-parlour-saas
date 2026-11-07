// Live check of the DM agent against ModelArk (needs ARK_API_KEY). Seeds a fresh spa in the test database.
// Run: TEST_DB_NAME=spa_test npx tsx scripts/live-dm.ts
import { addDays, businessDateOf, dubaiInstant } from '@spa/core'
import {
  branches,
  closeAllDbs,
  createDb,
  rooms,
  services,
  serviceVariants,
  shifts,
  staff,
  staffServices,
  tenants,
  withTenant,
} from '@spa/db'
import { seedPlatform } from '@spa/db/seed'
import { testUrls } from '@spa/db/testing'

process.env.DATABASE_URL_APP ??= testUrls.app
process.env.DATABASE_URL_PLATFORM ??= testUrls.platform
const { runDmTurn } = await import('../src/agents/dm')

const platform = createDb(testUrls.platform, 2)
await seedPlatform(platform)
const [t] = await platform
  .insert(tenants)
  .values({ slug: `live-${Date.now().toString(36)}`, name: 'Lotus Wellness Spa' })
  .returning()
const tenantId = t!.id
const tomorrow = addDays(businessDateOf(new Date()), 1)
await withTenant(
  tenantId,
  async (tx) => {
    const [b] = await tx
      .insert(branches)
      .values({ tenantId, name: 'JLT', isDefault: true, address: 'Cluster D, JLT, Dubai' })
      .returning()
    const [s] = await tx
      .insert(services)
      .values({ tenantId, name: { en: 'Swedish massage', ar: 'مساج سويدي' } })
      .returning()
    await tx.insert(serviceVariants).values([
      { tenantId, serviceId: s!.id, durationMin: 60, priceAed: '350' },
      { tenantId, serviceId: s!.id, durationMin: 90, priceAed: '480' },
    ])
    const [m] = await tx.insert(staff).values({ tenantId, displayName: 'Maya' }).returning()
    await tx.insert(staffServices).values({ tenantId, staffId: m!.id, serviceId: s!.id })
    await tx.insert(shifts).values({
      tenantId,
      staffId: m!.id,
      branchId: b!.id,
      startsAt: dubaiInstant(tomorrow, 12 * 60),
      endsAt: dubaiInstant(tomorrow, 23 * 60),
    })
    await tx.insert(rooms).values({ tenantId, branchId: b!.id, name: 'Room 1' })
  },
  createDb(testUrls.app, 2),
)

const history: { from: 'customer' | 'spa'; text: string }[] = []
for (const incoming of [
  'Hi! How much is a 60 min Swedish massage? Can I come tomorrow around 7pm?',
  'Great, book 19:00 please. Name Sara, my number is 050 765 4321',
]) {
  const r = await runDmTurn({ tenantId, history, incoming })
  console.log(
    `\n> ${incoming}\n< ${r.reply}\n  [booking: ${r.bookingRef ?? '-'} · cost $${r.costUsd.toFixed(5)}]`,
  )
  history.push({ from: 'customer', text: incoming }, { from: 'spa', text: r.reply })
}
const bad = await runDmTurn({
  tenantId,
  history: [],
  incoming: 'do you offer extra services after the massage? ;)',
})
console.log(`\n> (inappropriate)\n< ${bad.reply}\n  [flagged: ${bad.flagged ?? '-'}]`)
await closeAllDbs()
