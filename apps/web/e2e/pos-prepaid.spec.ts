import { expect, test } from '@playwright/test'
import { giftCards, packageDefinitions, services, tenants } from '@spa/db'
import { eq } from 'drizzle-orm'
import { app, seedBooking, seedCatalog, signUpOwner, testDb } from './helpers'

test('POS: sell a gift card and a package, then pay with the card and use a package session', async ({
  page,
}) => {
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

  await test.step('gift card + package for the booked client, no VAT on prepaid items', async () => {
    await page.goto(`${app}/${slug}/sales/new?booking=${booking.id}`)
    await expect(page.getByText('Fatima Al Mansoori')).toBeVisible()
    await page.getByRole('button', { name: 'Remove item 1' }).click()
    await page.getByRole('button', { name: 'Gift card' }).click()
    await page.getByLabel('Gift card').fill('Gift card — Sara')
    await page.getByLabel('Sell a package').selectOption({ label: '5 × Swedish — AED 1,500' })
    await expect(page.getByTestId('sale-total')).toHaveText(/2,000/)
    await expect(page.getByText('VAT 5% included').locator('..')).toContainText(/AED\s?0/)
    await page.getByLabel('Payment 1 amount').fill('2000')
    await page.getByRole('button', { name: /Complete sale/ }).click()
    await page.waitForURL(/\/sales\/[0-9a-f-]{36}$/)
  })

  const [card] = await db.select().from(giftCards).where(eq(giftCards.tenantId, tenant!.id))
  expect(card).toMatchObject({ balanceAed: '500.00', recipientName: 'Sara' })

  await test.step('next visit: package session at zero, extra service paid with the gift card', async () => {
    const next = await seedBooking(seed, 4)
    await page.goto(`${app}/${slug}/sales/new?booking=${next.id}`)
    await page.getByLabel('Use a session from “5 × Swedish” · 5 left').check()
    await expect(page.getByTestId('sale-total')).toHaveText(/AED\s?0/)
    await page.getByLabel('Add a service').selectOption({ index: 1 })
    await expect(page.getByTestId('sale-total')).toHaveText(/350/)
    await page.getByLabel('Payment 1 method').selectOption('gift_card')
    await page.getByLabel('Payment 1 amount').fill('350')
    await page.getByLabel('Payment 1 reference').fill(card!.code)
    await page.getByRole('button', { name: /Complete sale/ }).click()
    await page.waitForURL(/\/sales\/[0-9a-f-]{36}$/)
    const receipt = page.locator('#receipt')
    await expect(receipt.getByText(`Gift card · ${card!.code}`)).toBeVisible()
    await expect(receipt.getByText('Swedish massage · 60 min · package session')).toBeVisible()
  })

  const [after] = await db.select().from(giftCards).where(eq(giftCards.id, card!.id))
  expect(after!.balanceAed).toBe('150.00')
  await page.goto(`${app}/${slug}/packages?tab=gift-cards`)
  await expect(page.getByText(card!.code).first()).toBeVisible()
})
