// F15 gift vouchers (print / share / public check), F16 QR posters + partner attribution, F15 client draft settings,
// and the Premium gate for all of it (Standard spas).
import { expect, type Page, test } from '@playwright/test'
import { bookingPartners, bookings, giftCards, tenants } from '@spa/db'
import { issueGiftCard } from '@spa/services'
import { and, eq } from 'drizzle-orm'
import { seedCatalog, signUpOwner, site, testDb } from './helpers'

async function giftCard(tenantId: string, amountAed = 500) {
  return testDb().transaction((tx) => issueGiftCard(tx, { tenantId, amountAed }))
}

async function bookTomorrow(page: Page, name: string, phone: string) {
  await page
    .getByRole('region', { name: 'Swedish massage' })
    .getByRole('button', { name: /60 min/ })
    .click()
  await page.getByRole('button', { name: /^Tomorrow/ }).click()
  await page.getByTestId('slots').getByRole('button').first().click()
  await page.getByLabel('Your name').fill(name)
  await page.getByLabel('UAE mobile').fill(phone)
  await page.getByRole('button', { name: 'Request booking' }).click()
  await expect(page.getByRole('heading', { name: 'Booking requested' })).toBeVisible()
  return (await page.getByTestId('booking-ref').textContent())?.trim() ?? ''
}

test('F15 voucher: print view with QR, edit, WhatsApp share, public check page (balance only)', async ({
  page,
}) => {
  const { slug, dashboard } = await signUpOwner(page, { spa: 'Voucher Spa' })
  const seed = await seedCatalog(slug)
  const card = await giftCard(seed.tenantId)

  await page.goto(`${dashboard}/packages?tab=gift-cards`)
  await page.getByRole('link', { name: 'Voucher' }).click()
  await expect(page.getByRole('heading', { name: `Gift voucher ${card.code}` })).toBeVisible()
  const voucher = page.getByTestId('voucher-print')
  await expect(voucher.getByTestId('voucher-code')).toHaveText(card.code)
  await expect(voucher).toContainText('AED 500')
  await expect(voucher.locator('svg')).toHaveCount(1)
  await expect(voucher).toContainText('Scan to check the balance')

  await page.getByRole('button', { name: 'Edit voucher' }).click()
  await page.getByLabel('For (recipient name)').fill('Layla Haddad')
  await page.getByLabel('Recipient mobile').fill('050 777 8899')
  await page.getByLabel('Show').selectOption({ label: 'Swedish massage' })
  await page.getByRole('button', { name: 'Save voucher' }).click()
  await expect(page.getByText('Voucher saved')).toBeVisible()
  await expect(voucher).toContainText('Swedish massage')
  await expect(voucher).toContainText('مساج سويدي')
  await expect(voucher).toContainText('Layla Haddad')

  const share = page.getByTestId('voucher-share')
  await expect(share).toHaveAttribute('href', /971507778899/)
  await expect(share).toHaveAttribute('href', new RegExp(card.code))
  await page.getByRole('link', { name: 'A5' }).click()
  await expect(page).toHaveURL(/size=a5/)

  // Public check page (the QR target): status + balance, no recipient or buyer.
  await page.goto(`${site(slug)}/voucher/${card.checkToken}`)
  const check = page.getByTestId('voucher-check')
  await expect(check).toContainText('Valid')
  await expect(page.getByTestId('voucher-balance')).toHaveText('AED 500')
  await expect(check).toContainText('Swedish massage')
  await expect(check).toContainText(card.code.slice(-4))
  await expect(check).not.toContainText('Layla')
  await check.getByRole('link', { name: 'العربية' }).click()
  await expect(check).toContainText('صالحة')
  await page.goto(`${site(slug)}/voucher/${'0'.repeat(32)}`)
  await expect(page.getByTestId('voucher-check')).toContainText('We could not find this voucher')
})

test('F16 QR posters: reception + partner poster, a booking through the partner link is counted', async ({
  page,
}) => {
  const { slug, dashboard } = await signUpOwner(page, { spa: 'Poster Spa' })
  const seed = await seedCatalog(slug)
  await page.goto(`${dashboard}/posters`)
  await expect(page.getByRole('heading', { name: 'QR posters' })).toBeVisible()
  await expect(page.getByTestId('poster-url')).toHaveText(new RegExp(`${slug}.*/book\\?src=qr$`))
  await expect(page.getByTestId('poster-print').locator('svg')).toHaveCount(1)

  await page.getByRole('button', { name: 'Add partner' }).click()
  await page.getByLabel('Partner name').fill('Atlantis concierge')
  await page.getByRole('dialog').getByRole('button', { name: 'Add partner' }).click()
  await expect(page.getByText('Partner added')).toBeVisible()
  const [partner] = await testDb()
    .select()
    .from(bookingPartners)
    .where(eq(bookingPartners.tenantId, seed.tenantId))
  const row = page.getByTestId(`partner-${partner!.code}`)
  await row.getByRole('link', { name: 'Show poster' }).click()
  await expect(page.getByRole('heading', { name: 'Poster for Atlantis concierge' })).toBeVisible()
  await expect(page.getByTestId('poster-print')).toContainText('For guests of Atlantis concierge')
  await expect(page.getByTestId('poster-url')).toHaveText(new RegExp(`src=qr&partner=${partner!.code}$`))

  // A guest scans the partner poster and books.
  await page.goto(`${site(slug)}/book?src=qr&partner=${partner!.code}`)
  const ref = await bookTomorrow(page, 'Hotel Guest', '050 333 4455')
  const [booking] = await testDb()
    .select()
    .from(bookings)
    .where(and(eq(bookings.tenantId, seed.tenantId), eq(bookings.refCode, ref)))
  expect(booking).toMatchObject({ attribution: 'qr', partnerId: partner!.id })

  await page.goto(`${dashboard}/posters`)
  await expect(row.getByRole('cell').nth(1)).toHaveText('1')
  await page.goto(`${dashboard}/bookings/${booking!.id}`)
  await expect(page.getByText('Online · QR · Atlantis concierge')).toBeVisible()

  // Paused: the link still books, without the partner.
  await page.goto(`${dashboard}/posters`)
  await row.getByRole('button', { name: 'Pause' }).click()
  await expect(page.getByText('Partner paused')).toBeVisible()
  await expect(row).toContainText('Paused')
})

test('F15 client drafts: switches start off, timing is validated and saved', async ({ page }) => {
  const { slug, dashboard } = await signUpOwner(page)
  await page.goto(`${dashboard}/automations`)
  for (const name of ['Review requests', 'Birthday messages', 'Win-back messages'])
    await expect(page.getByRole('switch', { name: `${name}: on or off` })).toHaveAttribute(
      'aria-checked',
      'false',
    )
  const card = page.getByTestId('client-drafts')
  await card.getByRole('button', { name: 'Save timing' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Review link').fill('http://not-https.example')
  await dialog.getByRole('button', { name: 'Save timing' }).click()
  await expect(dialog.getByText('Use a full link starting with https://')).toBeVisible()
  await dialog.getByLabel('Review link').fill('https://g.page/r/poster/review')
  await dialog.getByLabel('Win-back after (days without a visit)').fill('90')
  await dialog.getByRole('button', { name: 'Save timing' }).click()
  await expect(page.getByText('Draft timing saved')).toBeVisible()
  await expect(card).toContainText('https://g.page/r/poster/review')

  await page.getByRole('switch', { name: 'Review requests: on or off' }).click()
  await expect(page.getByText('Review requests switched on')).toBeVisible()
  const [t] = await testDb()
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.slug, slug))
  expect(t!.settings.clientDrafts).toMatchObject({
    reviewLink: 'https://g.page/r/poster/review',
    winbackDays: 90,
    quietStart: '21:00',
    quietEnd: '10:00',
  })
  expect(t!.settings.automations).toMatchObject({ reviewRequests: true })
})

test('Standard spa: vouchers, posters and client drafts are Premium', async ({ page }) => {
  const { slug, dashboard } = await signUpOwner(page, { plan: 'standard' })
  const seed = await seedCatalog(slug)
  const card = await giftCard(seed.tenantId, 200)
  await page.goto(`${dashboard}/packages?tab=gift-cards`)
  await expect(page.getByRole('link', { name: 'Voucher' })).toHaveCount(0)
  await expect(page.getByRole('cell', { name: 'Premium' })).toBeVisible()
  for (const path of ['/posters', `/vouchers/${card.id}`]) {
    await page.goto(`${dashboard}${path}`)
    await expect(page.getByTestId('plan-upsell'), path).toContainText('Available on Premium')
  }
  await page.goto(`${dashboard}/automations`)
  await expect(page.getByRole('switch', { name: /Review requests|Birthday messages|Win-back/ })).toHaveCount(
    0,
  )
  await expect(page.getByTestId('client-drafts').getByRole('button', { name: 'Save timing' })).toHaveCount(0)
  // The public check page keeps working for vouchers already handed out.
  const [row] = await testDb().select().from(giftCards).where(eq(giftCards.id, card.id))
  await page.goto(`${site(slug)}/voucher/${row!.checkToken}`)
  await expect(page.getByTestId('voucher-balance')).toHaveText('AED 200')
})
