import { expect, test } from '@playwright/test'
import { reviews, socialAccounts, tenants } from '@spa/db'
import { and, eq } from 'drizzle-orm'
import { app, screenshotAt, signUpOwner, testDb } from './helpers'

const LOC = 'accounts/111/locations/222'

/** A connected Google location whose stored token is fake (nothing may call Google). */
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
      // R29: the Google account from the connect's ID token
      googleSub: '1001',
      googleEmail: 'owner@serenity.example',
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

test('Google Business Profile: not-configured card, synced reviews read only, Reviews section "Coming soon"', async ({
  page,
}) => {
  const { slug } = await signUpOwner(page, { plan: 'premium' })

  await page.goto(`${app}/${slug}/settings/integrations`)
  const card = page.getByTestId('gbp-card')
  await expect(card.getByRole('heading', { name: 'Google Business Profile' })).toBeVisible()
  await expect(card.getByText('Not configured yet')).toBeVisible()
  await expect(card.getByText('GOOGLE_CLIENT_ID')).toBeVisible()
  await expect(card.getByRole('button', { name: 'Connect Google' })).toHaveCount(0)
  // Owner 2026-10-13: review replies dropped for now — the card promises none.
  await expect(card.getByText('Replying to Google reviews from the dashboard is coming soon.')).toBeVisible()
  await expect(card.getByText(/approved replies|draft reply|paste new reviews/)).toHaveCount(0)

  await seedGoogle(slug)
  await page.reload()
  await expect(card.getByText('Serenity Spa Marina')).toBeVisible()
  await expect(card.getByTestId('gbp-account')).toHaveText('Connected as owner@serenity.example')
  // Synced reviews are still read: count + average (5 + 4 + 2 + 5) / 4 on the card.
  await expect(card.locator('dd').filter({ hasText: '4.0' })).toBeVisible()
  await expect(card.getByRole('link', { name: 'Review replies' })).toHaveCount(0)
  await screenshotAt(page, 'gbp-card')

  // The Reviews section stays in the menu, its page shows only "Coming soon".
  await expect(page.locator(`a[href$="/${slug}/ai/reviews"]`)).not.toHaveCount(0)
  await page.goto(`${app}/${slug}/ai/reviews`)
  await expect(page.getByRole('heading', { name: 'Google reviews' })).toBeVisible()
  const soon = page.getByTestId('reviews-coming-soon')
  await expect(soon).toContainText('Reviews — coming soon')
  await expect(soon).toContainText("Soon you'll see your Google reviews here and reply to them in one place.")
  await expect(page.getByTestId('review')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Draft with AI' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Add review' })).toHaveCount(0)
  await screenshotAt(page, 'gbp')

  // AI studio: the review agent says "Coming soon" and can't be configured; the others still can.
  await page.goto(`${app}/${slug}/ai`)
  const agent = page.getByTestId('agent-review_agent')
  await expect(agent.getByText('Coming soon')).toBeVisible()
  await expect(agent.getByRole('button', { name: 'Configure' })).toHaveCount(0)
  await expect(page.getByTestId('agent-dm_agent').getByRole('button', { name: 'Configure' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Reviews · coming soon' })).toBeVisible()

  // Nothing touched the stored reviews or the connection.
  const db = testDb()
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, slug))
  const [acct] = await db.select().from(socialAccounts).where(eq(socialAccounts.tenantId, tenant!.id))
  expect(acct!.status).toBe('connected')
  const [open] = await db
    .select()
    .from(reviews)
    .where(and(eq(reviews.tenantId, tenant!.id), eq(reviews.externalId, `${LOC}/reviews/r3`)))
  expect(open).toMatchObject({ replyStatus: 'none', replyText: null })
})
