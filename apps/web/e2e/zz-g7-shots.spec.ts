import { expect, test } from '@playwright/test'
import { platformAdmins, reviews, socialPosts, tenants, user } from '@spa/db'
import { eq } from 'drizzle-orm'
import { app, makeStudio, seedCatalog, signUpOwner, testDb } from './helpers'

const OUT = '/tmp/claude-0/-home-user-massage-parlour-saas/1998ad9b-1e61-58ef-a73e-ab788ef65ade/scratchpad/p2/G7'
test.setTimeout(300_000)

test('G7 screenshots', async ({ page, context }) => {
  const { slug } = await signUpOwner(page)
  await seedCatalog(slug)
  const db = testDb()
  const [tenant] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug))
  await db.insert(reviews).values([
    { tenantId: tenant!.id, source: 'google', externalId: 'r1', author: 'Sam R.', rating: 5, text: 'Lovely calm place, great massage.', reviewedAt: new Date() },
    { tenantId: tenant!.id, source: 'google', externalId: 'r2', author: 'Lena K.', rating: 3, text: 'Room was a bit cold.', reviewedAt: new Date() },
  ])
  await db.insert(socialPosts).values({
    tenantId: tenant!.id, platform: 'instagram', caption: 'Slow down this weekend with our 90-minute signature massage.',
    media: [{ url: 'https://images.example.com/spa.jpg', alt: 'Massage room' }], status: 'scheduled',
  })
  await makeStudio(slug)
  await page.goto(`${app}/${slug}/website`)
  await page.getByRole('button', { name: 'Use Zen Minimal' }).click()
  await expect(page.getByTestId('current-template')).toHaveText('Zen Minimal', { timeout: 60_000 })
  // Back to the spa's own view.
  const [owner] = await db.select({ id: user.id }).from(user).where(eq(user.email, `owner-${slug}@e2e.test`))
  await db.delete(platformAdmins).where(eq(platformAdmins.userId, owner!.id))

  const pages = ['website', 'analytics', 'ai', 'ai/content', 'ai/reviews', 'media', 'ai/try']
  for (const w of [1280, 360]) {
    await page.setViewportSize({ width: w, height: 900 })
    for (const p of pages) {
      await page.goto(`${app}/${slug}/${p}`)
      await page.waitForLoadState('networkidle').catch(() => {})
      await page.screenshot({ path: `${OUT}/${p.replace('/', '-')}-${w}.png`, fullPage: true })
    }
  }
  await context.addCookies([{ name: 'spa_locale', value: 'th', url: app }])
  await page.setViewportSize({ width: 1280, height: 900 })
  for (const p of ['website', 'ai/reviews', 'ai/content']) {
    await page.goto(`${app}/${slug}/${p}`)
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.screenshot({ path: `${OUT}/${p.replace('/', '-')}-th.png`, fullPage: true })
  }
  await page.setViewportSize({ width: 360, height: 900 })
  await page.goto(`${app}/${slug}/ai/reviews`)
  await page.screenshot({ path: `${OUT}/ai-reviews-th-360.png`, fullPage: true })
})
