import { expect, test } from '@playwright/test'
import { payments, saleLines, sales } from '@spa/db'
import { app, screenshotAt, seedBooking, seedCatalog, signUpOwner, testDb, today } from './helpers'

test('owner sees today’s revenue, KPIs and the upcoming booking on the home dashboard', async ({ page }) => {
  const { slug } = await signUpOwner(page)
  const seed = await seedCatalog(slug)
  await seedBooking(seed)

  // A paid AED 350 sale for today (sale + line + cash payment).
  const db = testDb()
  const [sale] = await db
    .insert(sales)
    .values({
      tenantId: seed.tenantId,
      branchId: seed.branchId,
      clientId: seed.clientId,
      number: 1,
      businessDate: today(),
      subtotalAed: '350',
      vatAed: '16.67',
      totalAed: '350',
      tipsAed: '25',
      status: 'paid',
    })
    .returning()
  await db.insert(saleLines).values({
    tenantId: seed.tenantId,
    saleId: sale!.id,
    kind: 'service',
    refId: seed.variantIds[0]!,
    description: 'Swedish massage · 60 min',
    unitPriceAed: '350',
    lineTotalAed: '350',
    staffId: seed.staffIds[0]!,
  })
  await db.insert(payments).values({
    tenantId: seed.tenantId,
    saleId: sale!.id,
    branchId: seed.branchId,
    method: 'cash',
    amountAed: '350',
    businessDate: today(),
  })

  await test.step('home shows revenue, rankings and the setup checklist', async () => {
    await page.goto(`${app}/${slug}`)
    const revenue = page.locator('section', { has: page.getByText('Revenue', { exact: true }) }).first()
    await expect(revenue).toContainText('AED 350')
    await expect(page.getByText('1 paid sale')).toBeVisible()
    const services = page.locator('section', { has: page.getByRole('heading', { name: 'Top services' }) })
    await expect(services).toContainText('Swedish massage')
    const therapists = page.locator('section', { has: page.getByRole('heading', { name: 'Top therapists' }) })
    await expect(therapists).toContainText('Maya')
    // Catalog exists now, so the services step is ticked off.
    await expect(page.getByRole('link', { name: 'Add services, rooms and prices' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Design and publish your website' })).toBeVisible()
  })

  await test.step('up next lists today’s booking (first name only)', async () => {
    const upNext = page.locator('section', { has: page.getByRole('heading', { name: 'Up next' }) })
    await expect(upNext).toContainText('Fatima')
    await expect(upNext).not.toContainText('Al Mansoori')
    await expect(upNext).toContainText('Swedish massage')
    await expect(upNext).toContainText('Maya')
  })

  await screenshotAt(page, 'kpis')

  await test.step('switch to 7 days', async () => {
    await page.getByRole('link', { name: '7 days' }).click()
    await expect(page).toHaveURL(/period=7d/)
    await expect(page.getByText("Here's how your spa is doing over the last 7 days.")).toBeVisible()
    await expect(page.getByRole('link', { name: '7 days' })).toHaveAttribute('aria-current', 'page')
  })
})
