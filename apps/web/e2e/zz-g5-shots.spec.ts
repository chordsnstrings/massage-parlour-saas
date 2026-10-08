// Temporary (G5 Phase 2 screenshots) — delete after use.
import { test } from '@playwright/test'
import { addDays, businessDateOf } from '@spa/core'
import { businessDocuments, staffDocuments } from '@spa/db'
import { app, seedBooking, seedCatalog, signUpOwner, testDb } from './helpers'

const OUT = '/tmp/claude-0/-home-user-massage-parlour-saas/1998ad9b-1e61-58ef-a73e-ab788ef65ade/scratchpad/p2/g5'

test.setTimeout(240_000)
test('g5 shots', async ({ page }) => {
  const { slug } = await signUpOwner(page)
  const seed = await seedCatalog(slug)
  await seedBooking(seed)
  const today = businessDateOf(new Date(), '00:00')
  const [maya, ploy] = seed.staffIds
  await testDb()
    .insert(staffDocuments)
    .values([
      { tenantId: seed.tenantId, staffId: maya!, type: 'visa', expiresOn: addDays(today, 21) },
      { tenantId: seed.tenantId, staffId: ploy!, type: 'passport', expiresOn: addDays(today, 300) },
    ])
  await testDb()
    .insert(businessDocuments)
    .values([{ tenantId: seed.tenantId, type: 'trade_licence', expiresOn: addDays(today, -3) }])
  const pages = [
    ['staff', `${app}/${slug}/staff`],
    ['staff-detail', `${app}/${slug}/staff/${maya}`],
    ['team', `${app}/${slug}/team`],
    ['roles', `${app}/${slug}/team/roles`],
    ['documents', `${app}/${slug}/documents`],
    ['documents-due60', `${app}/${slug}/documents?status=due60`],
  ] as const
  for (const [w, h] of [
    [1280, 900],
    [360, 780],
  ] as const) {
    await page.setViewportSize({ width: w, height: h })
    for (const [name, url] of pages) {
      await page.goto(url)
      await page.waitForLoadState('networkidle')
      await page.screenshot({ path: `${OUT}/${name}-${w}-en.png`, fullPage: true })
    }
  }
  await page.context().addCookies([{ name: 'spa_locale', value: 'th', url: app }])
  for (const [w, h] of [
    [1280, 900],
    [360, 780],
  ] as const) {
    await page.setViewportSize({ width: w, height: h })
    for (const [name, url] of pages) {
      await page.goto(url)
      await page.waitForLoadState('networkidle')
      await page.screenshot({ path: `${OUT}/${name}-${w}-th.png`, fullPage: true })
    }
  }
})
