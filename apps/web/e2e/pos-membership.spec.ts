import { expect, test } from '@playwright/test'
import { clientMemberships, membershipPlans, services, tenants } from '@spa/db'
import { eq } from 'drizzle-orm'
import { app, seedBooking, seedCatalog, signUpOwner, testDb } from './helpers'

test('POS: sell a membership, then use its included session and member discount (G15)', async ({ page }) => {
  const { slug } = await signUpOwner(page)
  const seed = await seedCatalog(slug)
  const db = testDb()
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, slug))
  const [svc] = await db.select().from(services).where(eq(services.tenantId, tenant!.id))
  await db.insert(membershipPlans).values({
    tenantId: tenant!.id,
    name: { en: 'Gold' },
    monthlyAed: '600',
    benefits: { includedSessions: [{ serviceId: svc!.id, quantity: 1 }], discountPct: 10 },
  })
  const booking = await seedBooking(seed)

  await test.step('sell the membership to the booked client: no VAT at sale', async () => {
    await page.goto(`${app}/${slug}/sales/new?booking=${booking.id}`)
    await expect(page.getByText('Fatima Al Mansoori')).toBeVisible()
    await page.getByRole('button', { name: 'Remove item 1' }).click()
    await page.getByLabel('Sell or renew a membership').selectOption({ label: 'Gold — AED 600 / month' })
    await expect(page.getByTestId('sale-total')).toHaveText(/600/)
    await expect(page.getByText('VAT 5% included').locator('..')).toContainText(/AED\s?0/)
    await page.getByLabel('Payment 1 amount').fill('600')
    await page.getByRole('button', { name: /Complete sale/ }).click()
    await page.waitForURL(/\/sales\/[0-9a-f-]{36}$/)
    await expect(page.locator('#receipt').getByText(/^Membership .+ – .+$/)).toBeVisible()
  })

  const [period] = await db.select().from(clientMemberships).where(eq(clientMemberships.tenantId, tenant!.id))
  expect(period).toMatchObject({ status: 'active', name: 'Gold', remainingValueAed: '600.00' })

  await test.step('next visit: included session at zero, extra treatment with the member discount', async () => {
    const next = await seedBooking(seed, 4)
    await page.goto(`${app}/${slug}/sales/new?booking=${next.id}`)
    await page.getByLabel('Use an included session from membership “Gold” · 1 left').check()
    await expect(page.getByTestId('sale-total')).toHaveText(/AED\s?0/)
    await page.getByLabel('Add a service').selectOption({ index: 1 })
    await expect(page.getByLabel('Member discount −10% (“Gold”)')).toBeChecked()
    await expect(page.getByTestId('sale-total')).toHaveText(/315/)
    await page.getByLabel('Payment 1 amount').fill('315')
    await page.getByRole('button', { name: /Complete sale/ }).click()
    await page.waitForURL(/\/sales\/[0-9a-f-]{36}$/)
    const receipt = page.locator('#receipt')
    await expect(receipt.getByText('Swedish massage · 60 min · membership session')).toBeVisible()
    await expect(receipt.getByText(/· member −10%$/)).toBeVisible()
  })

  const [used] = await db.select().from(clientMemberships).where(eq(clientMemberships.id, period!.id))
  expect(used).toMatchObject({ remainingValueAed: '0.00', balances: { [svc!.id]: 0 } })

  await test.step('the client profile lists the membership', async () => {
    await page.goto(`${app}/${slug}/clients/${period!.clientId}`)
    const card = page.getByTestId('client-memberships')
    await expect(card.getByText('Gold')).toBeVisible()
    await expect(card.getByText('Active')).toBeVisible()
  })
})
