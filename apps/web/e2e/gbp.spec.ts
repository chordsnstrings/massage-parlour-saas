import { expect, test } from '@playwright/test'
import { reviews, socialAccounts, tenants } from '@spa/db'
import { eq } from 'drizzle-orm'
import { app, screenshotAt, signUpOwner, testDb } from './helpers'

const LOC = 'accounts/111/locations/222'

/** A connected Google location whose stored token is fake (posting must fail gracefully, without calling Google). */
async function seedGoogle(slug: string) {
  const db = testDb()
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, slug))
  const tenantId = tenant!.id
  await db.insert(socialAccounts).values({
    tenantId,
    platform: 'gbp',
    externalId: 'locations/222',
    username: 'Serenity Spa Marina',
    tokenEnc: 'fake-token',
    tokenExpiresAt: new Date(Date.now() + 3600_000),
    meta: {
      accountName: 'accounts/111',
      locationName: 'locations/222',
      title: 'Serenity Spa Marina',
      address: 'Marina Walk, Dubai',
      lastSyncAt: new Date().toISOString(),
    },
  })
  const day = (n: number) => new Date(Date.now() - n * 86_400_000)
  await db.insert(reviews).values([
    {
      tenantId,
      externalId: `${LOC}/reviews/r1`,
      author: 'Mona K.',
      rating: 5,
      text: 'The most relaxing hot stone massage in the Marina.',
      reviewedAt: day(1),
    },
    {
      tenantId,
      externalId: `${LOC}/reviews/r2`,
      author: 'Sam R.',
      rating: 4,
      text: 'Lovely staff, easy booking.',
      reviewedAt: day(3),
      replyText: 'Thank you Sam — see you soon!',
      replyStatus: 'posted',
      repliedAt: day(2),
    },
    {
      tenantId,
      externalId: `${LOC}/reviews/r3`,
      author: 'Omar T.',
      rating: 2,
      text: 'The treatment room was too cold.',
      reviewedAt: day(2),
    },
    {
      tenantId,
      externalId: `${LOC}/reviews/r4`,
      author: 'ليلى',
      rating: 5,
      text: 'تجربة رائعة وخدمة ممتازة',
      reviewedAt: day(4),
    },
  ])
}

test('Google Business Profile: not-configured card, synced reviews, filters, approve and a failed post', async ({
  page,
}) => {
  const { slug } = await signUpOwner(page)

  await page.goto(`${app}/${slug}/settings/integrations`)
  const card = page.getByTestId('gbp-card')
  await expect(card.getByRole('heading', { name: 'Google Business Profile' })).toBeVisible()
  await expect(card.getByText('Not configured yet')).toBeVisible()
  await expect(card.getByText('GOOGLE_CLIENT_ID')).toBeVisible()
  await expect(card.getByRole('button', { name: 'Connect Google' })).toHaveCount(0)

  await seedGoogle(slug)
  await page.reload()
  await expect(card.getByText('Serenity Spa Marina')).toBeVisible()
  await card.getByRole('link', { name: 'Review replies' }).click()

  await expect(page.getByRole('heading', { name: 'Google reviews' })).toBeVisible()
  await expect(page.getByText('Synced from Serenity Spa Marina')).toBeVisible()
  await expect(page.getByTestId('review')).toHaveCount(4)
  await expect(page.getByText('Response rate')).toBeVisible()
  await expect(page.getByText('4.0', { exact: true })).toBeVisible() // (5 + 4 + 2 + 5) / 4
  await expect(page.getByText('تجربة رائعة وخدمة ممتازة')).toHaveAttribute('dir', 'auto')
  await screenshotAt(page, 'gbp')

  // Filters
  await page.getByRole('link', { name: '5 stars' }).click()
  await expect(page).toHaveURL(/rating=5/)
  await expect(page.getByTestId('review')).toHaveCount(2)
  await page.getByRole('link', { name: 'Posted' }).click()
  await expect(page).toHaveURL(/rating=5&status=posted/)
  await expect(page.getByText('No reviews match these filters')).toBeVisible()
  await page.getByRole('link', { name: 'All ratings' }).click()
  await expect(page).toHaveURL(/reviews\?status=posted$/)
  await expect(page.getByTestId('review')).toHaveCount(1)
  await expect(page.getByTestId('review').first()).toContainText('Sam R.')
  await page.getByRole('link', { name: 'Any status' }).click()
  await expect(page).toHaveURL(/\/ai\/reviews$/)
  await page.getByRole('link', { name: '2 stars' }).click()
  await expect(page).toHaveURL(/reviews\?rating=2$/)
  await expect(page.getByTestId('review')).toHaveCount(1)

  const review = page.getByTestId('review').filter({ hasText: 'too cold' })
  await expect(review.getByText('Needs reply')).toBeVisible()

  // AI draft — the AI may be unavailable in tests; either outcome is handled.
  await review.getByRole('button', { name: 'Draft with AI' }).click()
  const drafted = page.getByText('Reply drafted')
  await expect(drafted.or(page.getByText(/AI service is busy|AI budget|switched off/))).toBeVisible({
    timeout: 60_000,
  })
  if (await drafted.isVisible()) {
    await expect(review.getByText('Draft', { exact: true })).toBeVisible()
    await expect(review.getByLabel('Reply')).not.toHaveValue('')
  }

  await review
    .getByLabel('Reply')
    .fill("Thank you Omar — we're sorry the room felt cold. Please message us so we can make it right.")
  await review.getByRole('button', { name: 'Approve' }).click()
  await expect(page.getByText('Reply approved')).toBeVisible()
  await expect(review.getByText('Approved', { exact: true })).toBeVisible()

  // Posting with the fake token fails gracefully with a visible reason.
  await review.getByRole('button', { name: 'Post reply' }).click()
  await expect(review.getByRole('alert')).toContainText("Couldn't post to Google")
  await expect(review.getByRole('alert')).toContainText('Reconnect')
  await expect(review.getByText('Failed', { exact: true })).toBeVisible()
  await expect(review.getByLabel('Reply')).toHaveValue(/we're sorry the room felt cold/)
  await expect(page.getByRole('link', { name: 'Reconnect' })).toBeVisible()

  await page.goto(`${app}/${slug}/settings/integrations`)
  await expect(card.getByText('Reconnect needed').or(card.getByText('Not configured yet'))).toBeVisible()
  await expect(card.getByText(/Reconnect Google Business Profile/)).toBeVisible()
  await screenshotAt(page, 'gbp-card')
})
