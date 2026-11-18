import { expect, test } from '@playwright/test'
import { bookings, clients, promoCodes } from '@spa/db'
import { app, screenshotAt, seedCatalog, signUpOwner, testDb } from './helpers'

const DAY = 86_400_000

test('campaigns: win-back segment with live preview → queued WhatsApp messages', async ({ page }) => {
  const { slug } = await signUpOwner(page, { plan: 'premium' })
  const seed = await seedCatalog(slug)
  const db = testDb()
  // Three lapsed regulars (one Arabic speaker), one recent visitor and one opted-out client.
  const long = new Date(Date.now() - 90 * DAY)
  const people = await db
    .insert(clients)
    .values(
      [
        { name: 'Layla Hassan', phoneE164: '971501000001', lastVisitAt: long },
        { name: 'Noura Al Ali', phoneE164: '971501000002', language: 'ar', lastVisitAt: long },
        { name: 'Sara Khan', phoneE164: '971501000003', lastVisitAt: long },
        { name: 'Rita Gomez', phoneE164: '971501000004', lastVisitAt: new Date(Date.now() - 5 * DAY) },
        { name: 'Opted Out', phoneE164: '971501000005', lastVisitAt: long, marketingOptOutAt: new Date() },
      ].map((c) => ({ ...c, tenantId: seed.tenantId })),
    )
    .returning()
  let n = 0
  await db.insert(bookings).values(
    people.map((p) => ({
      tenantId: seed.tenantId,
      branchId: seed.branchId,
      clientId: p.id,
      refCode: `E2E${++n}`,
      source: 'phone' as const,
      status: 'completed' as const,
      businessDate: p.lastVisitAt!.toISOString().slice(0, 10),
      startsAt: p.lastVisitAt!,
      endsAt: new Date(p.lastVisitAt!.getTime() + 3600_000),
    })),
  )
  await db
    .insert(promoCodes)
    .values({ tenantId: seed.tenantId, code: 'BACK20', kind: 'percent', value: '20' })

  // Segment builder: start from the win-back preset, watch the live count.
  await page.goto(`${app}/${slug}/campaigns`)
  await expect(page.getByRole('heading', { name: 'Campaigns', exact: true })).toBeVisible()
  await expect(page.getByText('No campaigns yet')).toBeVisible()
  await page.getByRole('link', { name: 'Win back (no visit 60 days)' }).click()
  await expect(page.getByLabel('Segment name')).toHaveValue('Win back (no visit 60 days)')
  const count = page.getByTestId('segment-count')
  await expect(count).toHaveText('3')
  const preview = page.getByRole('region', { name: 'Segment preview' })
  await expect(preview.getByText('Layla Hassan')).toBeVisible()
  await expect(preview.getByText('Rita Gomez')).toHaveCount(0)
  await expect(preview.getByText('Opted Out')).toHaveCount(0)
  await page.getByLabel('Add a condition').selectOption('language')
  await expect(count).toHaveText('1')
  await page.getByRole('button', { name: 'Remove “Language”' }).click()
  await expect(count).toHaveText('3')
  await screenshotAt(page, 'campaigns-segment')
  await page.getByRole('button', { name: 'Save & write campaign' }).click()

  // Composer: audience, bilingual preview with the offer code, queue now.
  await page.waitForURL(/\/campaigns\/new\?segment=/)
  await expect(page.getByTestId('campaign-recipients')).toContainText('3')
  await page.getByLabel('Campaign name').fill('October win-back')
  await page.getByLabel('Offer code').selectOption({ label: 'BACK20 · 20% off' })
  const english = page.getByLabel('English message')
  await english.fill('Hi {name}, we miss you at {spa}! Show code ')
  await english.press('End')
  await page.getByRole('button', { name: '{offer_code}' }).click()
  await expect(page.getByTestId('campaign-preview-en')).toContainText(
    'Hi Layla, we miss you at Serenity Spa! Show code BACK20',
  )
  await expect(page.getByTestId('campaign-preview-ar')).toContainText('Noura')
  await screenshotAt(page, 'campaigns-composer')
  await page.getByRole('button', { name: /Queue 3 messages/ }).click()

  // Detail page, then the list.
  await page.waitForURL(/\/campaigns\/[0-9a-f-]{36}$/)
  await expect(page.getByText('3 messages added to the WhatsApp queue')).toBeVisible()
  await expect(page.getByRole('heading', { name: /October win-back/ })).toBeVisible()
  await expect(page.getByText('Sending', { exact: true })).toBeVisible()
  await expect(page.getByText('Noura Al Ali').first()).toBeVisible()
  await screenshotAt(page, 'campaigns-detail')
  await page.goto(`${app}/${slug}/campaigns`)
  await expect(page.getByRole('link', { name: 'October win-back' }).first()).toBeVisible()
  await expect(page.getByText('0 / 3').first()).toBeVisible()
  await screenshotAt(page, 'campaigns')

  // Messages wait on /messages for a human to press send — in each client's language.
  await page.goto(`${app}/${slug}/messages`)
  const layla = page.getByRole('article', { name: 'Campaign for Layla Hassan' })
  await expect(layla).toBeVisible()
  await expect(layla.getByText(/Show code BACK20/)).toBeVisible()
  await expect(
    page.getByRole('article', { name: 'Campaign for Noura Al Ali' }).getByText(/مرحباً Noura/),
  ).toBeVisible()
  await expect(page.getByRole('article', { name: 'Campaign for Rita Gomez' })).toHaveCount(0)

  // Duplicate: the copy is a draft, and the 7-day cap leaves nobody to message yet.
  await page.goto(`${app}/${slug}/campaigns`)
  await page.getByRole('link', { name: 'October win-back' }).first().click()
  await page.getByRole('button', { name: 'Duplicate' }).click()
  await page.waitForURL(/\/edit$/)
  await expect(page.getByLabel('Campaign name')).toHaveValue('October win-back (copy)')
  await expect(page.getByText('3 skipped — already messaged by another campaign within 7 days')).toBeVisible()
  await expect(page.getByRole('button', { name: /Queue/ })).toBeDisabled()
})
