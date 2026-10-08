import { test } from '@playwright/test'
import { packageDefinitions, services, tenants } from '@spa/db'
import { eq } from 'drizzle-orm'
import { app, seedBooking, seedCatalog, signUpOwner, testDb } from './helpers'

const OUT = '/tmp/claude-0/-home-user-massage-parlour-saas/1998ad9b-1e61-58ef-a73e-ab788ef65ade/scratchpad/p2/g3'
test('g3 shots', async ({ page }) => {
  test.setTimeout(240_000)
  const { slug } = await signUpOwner(page)
  const seed = await seedCatalog(slug)
  const db = testDb()
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, slug))
  const [svc] = await db.select().from(services).where(eq(services.tenantId, tenant!.id))
  await db.insert(packageDefinitions).values({
    tenantId: tenant!.id,
    name: { en: '5 × Swedish' },
    priceAed: '1500',
    items: [{ serviceId: svc!.id, quantity: 5 }],
  })
  const booking = await seedBooking(seed)
  await page.goto(`${app}/${slug}/sales/new?booking=${booking.id}`)
  await page.getByLabel('Payment 1 amount').fill('350')
  await page.getByRole('button', { name: 'Add tip' }).click()
  await page.getByLabel('Tip 1 amount').fill('20')
  await page.getByRole('button', { name: /Complete sale/ }).click()
  await page.waitForURL(/sales\/[0-9a-f-]{36}/)
  const receipt = page.url()
  const next = await seedBooking(seed, { startsInHours: 3 }).catch(() => seedBooking(seed))
  const pages: [string, string][] = [
    ['list', `${app}/${slug}/sales`],
    ['checkout', `${app}/${slug}/sales/new?booking=${next.id}`],
    ['receipt', receipt],
    ['close', `${app}/${slug}/sales/close`],
    ['packages', `${app}/${slug}/packages`],
    ['giftcards', `${app}/${slug}/packages?tab=gift-cards`],
  ]
  const shots = async (lang: string, widths: number[]) => {
    for (const w of widths) {
      await page.setViewportSize({ width: w, height: w < 768 ? 780 : 900 })
      for (const [n, u] of pages) {
        await page.goto(u)
        await page.waitForTimeout(700)
        await page.screenshot({ path: `${OUT}/${n}-${w}-${lang}.png`, fullPage: true })
      }
    }
  }
  await shots('en', [1280, 360])
  await page.getByRole('button', { name: 'ไทย' }).first().click()
  await page.waitForTimeout(1500)
  await shots('th', [1280, 360])
  await page.goto(receipt)
  await page.getByRole('button', { name: 'คืนเงิน', exact: true }).click()
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${OUT}/refund-360-th.png` })
})
