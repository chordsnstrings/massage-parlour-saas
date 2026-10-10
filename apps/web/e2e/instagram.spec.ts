import { expect, test } from '@playwright/test'
import { conversations, createDb, socialAccounts, socialPosts, tenants } from '@spa/db'
import { testUrls } from '@spa/db/testing'
import { encryptSecret, ingestInstagramWebhook, storeDraft } from '@spa/services'
import { eq } from 'drizzle-orm'
import { app, screenshotAt, signUpOwner, testDb } from './helpers'

// Same secret as the dev server (playwright.config.ts) so the seeded token is readable there.
process.env.BETTER_AUTH_SECRET ??= 'e2e-secret-e2e-secret-e2e-secret-e2e'

const IG = '17841400000000042'

const webhook = (entry: Record<string, unknown>) => ({
  object: 'instagram',
  entry: [{ id: IG, time: Math.floor(Date.now() / 1000), ...entry }],
})

test('Instagram: not-configured card, inbox with an AI draft, take over and reply', async ({ page }) => {
  const { slug } = await signUpOwner(page, { plan: 'premium' })

  // META_* are unset for the e2e server: the card explains it and the inbox explains connecting.
  await page.goto(`${app}/${slug}/settings/integrations`)
  const card = page.getByTestId('instagram-card')
  await expect(card.getByText('Not configured yet')).toBeVisible()
  await expect(card.getByText('META_APP_SECRET')).toBeVisible()
  await page.goto(`${app}/${slug}/inbox`)
  await expect(page.getByText('Connect Instagram to start')).toBeVisible()

  // Seed a connected account, then ingest a DM + a comment exactly as the verified webhook would.
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

  await page.goto(`${app}/${slug}/inbox`)
  const list = page.getByTestId('conversation-list')
  await expect(list.getByText('@layla.k')).toBeVisible()
  await expect(list.getByText('@noor.travels')).toBeVisible()
  await expect(list.getByText('Draft to approve')).toBeVisible()
  await expect(list.getByRole('img', { name: 'Unread' }).first()).toBeVisible()

  await list.getByRole('link', { name: /@layla\.k/ }).click()
  const thread = page.getByTestId('thread')
  await expect(thread.getByRole('heading', { name: '@layla.k' })).toBeVisible()
  await expect(thread.getByText('Do you have a 60 minute massage tomorrow at 6pm?')).toBeVisible()
  await expect(thread.getByTestId('ai-draft')).toBeVisible()
  await expect(thread.getByLabel('AI draft')).toHaveValue(/Shall I book it for you\?/)
  await expect(thread.getByText(/Sandbox: Instagram isn’t set up/)).toBeVisible()
  await screenshotAt(page, 'instagram')

  // Take over, then reply: without Meta configured the reply is saved with a visible "not sent" note.
  await thread.getByRole('button', { name: 'Take over' }).click()
  await expect(page.getByText('You’re handling this conversation')).toBeVisible()
  await expect(thread.getByRole('button', { name: 'Give back to AI' })).toBeVisible()
  await thread.getByLabel('Reply', { exact: true }).fill('Hi Layla, Sara here — booking you in for 6pm now.')
  await thread.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByText(/Saved, not sent/).first()).toBeVisible()
  const sent = thread.getByTestId('message').filter({ hasText: 'booking you in for 6pm now' })
  await expect(sent).toBeVisible()
  await expect(sent.getByText(/Not sent — Instagram isn't set up on this server yet/)).toBeVisible()

  // Discard the AI draft; the thread stays with the team.
  await thread.getByRole('button', { name: 'Discard' }).click()
  await expect(thread.getByTestId('ai-draft')).toHaveCount(0)
  await expect(list.getByText('Draft to approve')).toHaveCount(0)

  // AI studio → Content: approved posts get "Publish to Instagram", blocked with a clear reason here.
  await db.insert(socialPosts).values({
    tenantId,
    platform: 'instagram',
    caption: 'Slow down this weekend with our 90-minute signature massage.',
    media: [{ url: 'https://images.example.com/spa.jpg', alt: 'Massage room' }],
    status: 'scheduled',
  })
  await page.goto(`${app}/${slug}/ai/content`)
  await expect(page.getByRole('button', { name: 'Publish to Instagram' })).toBeDisabled()
  await expect(page.getByText(/Instagram publishing isn’t configured on this server yet/)).toBeVisible()
})
