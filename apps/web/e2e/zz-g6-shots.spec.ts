import { expect, test } from '@playwright/test'
import { bookings, clients, conversations, createDb, socialAccounts, tenants } from '@spa/db'
import { testUrls } from '@spa/db/testing'
import { encryptSecret, enqueueBookingMessage, ingestInstagramWebhook, storeDraft } from '@spa/services'
import { eq } from 'drizzle-orm'
import { app, seedBooking, seedCatalog, signUpOwner, testDb } from './helpers'

process.env.BETTER_AUTH_SECRET ??= 'e2e-secret-e2e-secret-e2e-secret-e2e'
const IG = '17841400000000042'
const DAY = 86_400_000
const OUT = '/tmp/claude-0/-home-user-massage-parlour-saas/1998ad9b-1e61-58ef-a73e-ab788ef65ade/scratchpad/p2/g6'
const webhook = (entry: Record<string, unknown>) => ({
  object: 'instagram',
  entry: [{ id: IG, time: Math.floor(Date.now() / 1000), ...entry }],
})

test.setTimeout(240_000)
test('g6 shots', async ({ page }) => {
  const { slug } = await signUpOwner(page)
  const seed = await seedCatalog(slug)
  const booking = await seedBooking(seed)
  await testDb().transaction(async (tx) => {
    await enqueueBookingMessage(tx, booking.id, 'booking_confirmation')
    await enqueueBookingMessage(tx, booking.id, 'reminder', new Date(Date.now() + 3600_000))
  })

  // Three lapsed regulars (one Arabic speaker), one recent visitor and one opted-out client.
  const long = new Date(Date.now() - 90 * DAY)
  const people = await testDb()
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
  await testDb().insert(bookings).values(
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
  const db = testDb()
  const appDb = createDb(testUrls.app, 2)
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, slug))
  const tenantId = tenant!.id
  await db.insert(socialAccounts).values({
    tenantId,
    platform: 'instagram',
    externalId: IG,
    username: 'serenity.spa',
    tokenEnc: encryptSecret('IGQfake-token-for-e2e'),
    tokenExpiresAt: new Date(Date.now() + 50 * 86_400_000),
    scopes: ['instagram_business_basic', 'instagram_business_manage_messages'],
    meta: { igUserId: IG, tokenIssuedAt: new Date().toISOString(), webhooks: 'subscribed' },
    status: 'connected',
  })
  const [dm] = await ingestInstagramWebhook(
    webhook({
      messaging: [
        {
          sender: { id: '5550001112223' },
          recipient: { id: IG },
          timestamp: Date.now(),
          message: { mid: `mid-${slug}`, text: 'Hi! Do you have a 60 minute massage tomorrow at 6pm?' },
        },
      ],
    }),
    { platform: db, app: appDb },
  )
  await ingestInstagramWebhook(
    webhook({
      changes: [
        {
          field: 'comments',
          value: {
            id: `c-${slug}`,
            text: 'Beautiful place 😍',
            from: { id: '777', username: 'noor.travels' },
            media: { id: 'm1' },
          },
        },
      ],
    }),
    { platform: db, app: appDb },
  )
  expect(dm?.channel).toBe('instagram_dm')
  await db
    .update(conversations)
    .set({ participant: '@layla.k' })
    .where(eq(conversations.id, dm!.conversationId))
  // What the DM agent stores in approve-first mode.
  await storeDraft(
    tenantId,
    dm!.conversationId,
    'Hello Layla! Yes, 6pm tomorrow is free for a 60-minute massage. Shall I book it for you?',
    null,
    { app: appDb },
  )

  await page.goto(`${app}/${slug}/campaigns`)

  await page.getByRole('link', { name: 'Win back (no visit 60 days)' }).click()
  await expect(page.getByTestId('segment-count')).toHaveText('3')
  await shot(page, 'segment')
  await page.getByRole('button', { name: 'Save & write campaign' }).click()
  await page.waitForURL(/\/campaigns\/new\?segment=/)
  await expect(page.getByTestId('campaign-recipients')).toContainText('3')
  await page.getByLabel('Campaign name').fill('October win-back')
  await shot(page, 'composer')
  await page.getByRole('button', { name: /Queue 3 messages/ }).click()
  await page.waitForURL(/\/campaigns\/[0-9a-f-]{36}$/)
  await shot(page, 'campaign-detail')
  await page.goto(`${app}/${slug}/campaigns`)
  await shot(page, 'campaigns')
  await page.goto(`${app}/${slug}/messages`)
  await expect(page.getByRole('article').first()).toBeVisible()
  await shot(page, 'messages')
  await page.goto(`${app}/${slug}/messages/templates`)
  await shot(page, 'templates')
  await page.goto(`${app}/${slug}/inbox`)
  await shot(page, 'inbox')
  await page.getByTestId('conversation-list').getByRole('link', { name: /@layla\.k/ }).click()
  await expect(page.getByTestId('thread')).toBeVisible()
  await shot(page, 'thread')
  // Thai
  await page.context().addCookies([{ name: 'spa_locale', value: 'th', url: app }])
  for (const p of ['messages', 'campaigns', 'inbox', 'messages/templates', 'campaigns/segments/new?preset=vip']) {
    await page.goto(`${app}/${slug}/${p}`)
    await page.waitForTimeout(600)
    const n = p.replace(/[/?=]/g, '_')
    for (const width of [360, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      await page.waitForTimeout(300)
      await page.screenshot({ path: `${OUT}/th-${n}-${width}.png`, fullPage: true })
    }
  }
  await page.goto(`${app}/${slug}/messages`)
})

async function shot(page: import('@playwright/test').Page, name: string) {
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${OUT}/en-${name}-${width}.png`, fullPage: true })
  }
  await page.setViewportSize({ width: 1280, height: 800 })
}
