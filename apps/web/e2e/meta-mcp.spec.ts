import { expect, test } from '@playwright/test'
import { auditLog, createDb, socialAccounts, tenants } from '@spa/db'
import { testUrls } from '@spa/db/testing'
import { encryptSecret, ingestInstagramWebhook } from '@spa/services'
import { and, eq } from 'drizzle-orm'
import { app, mockAiReply, signUpOwner, testDb } from './helpers'

// Same secret as the dev server (playwright.config.ts) so the seeded token is readable there.
process.env.BETTER_AUTH_SECRET ??= 'e2e-secret-e2e-secret-e2e-secret-e2e'

const IG = '17841400000000099'
const call = (name: string, args: unknown) => ({
  role: 'assistant',
  content: null,
  tool_calls: [{ id: `c-${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
})

test('Meta MCP: the AI drafts a comment reply and a post through MCP tools, both wait for approval', async ({
  page,
}) => {
  const { slug } = await signUpOwner(page)
  const db = testDb()
  const appDb = createDb(testUrls.app, 2)
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, slug))
  await db.insert(socialAccounts).values({
    tenantId: tenant!.id,
    platform: 'instagram',
    externalId: IG,
    username: 'lotus.mcp',
    tokenEnc: encryptSecret('IGQfake-token-for-e2e'),
    tokenExpiresAt: new Date(Date.now() + 50 * 86_400_000),
    status: 'connected',
  })
  const [comment] = await ingestInstagramWebhook(
    {
      object: 'instagram',
      entry: [
        {
          id: IG,
          time: Math.floor(Date.now() / 1000),
          changes: [
            {
              field: 'comments',
              value: {
                id: `c-${slug}`,
                text: 'Are you open on Friday evening?',
                from: { id: '888', username: 'sara.relax' },
                media: { id: 'm1' },
              },
            },
          ],
        },
      ],
    },
    { platform: db, app: appDb },
  )
  // The mocked model calls two MCP tools, then reports back (real gateway, MCP server and token auth).
  await mockAiReply(slug, {
    __steps: [
      call('instagram__reply_comment', {
        thread_id: comment!.conversationId,
        text: 'Yes — we are open until 10 pm on Friday. See you!',
      }),
      call('instagram__create_post_draft', { caption: 'Friday nights are for hot-stone massage. Book now.' }),
      { role: 'assistant', content: 'Drafted a comment reply and a post for your approval.' },
    ],
  })

  await page.goto(`${app}/${slug}/settings/integrations`)
  const card = page.getByTestId('meta-mcp-card')
  await expect(card.getByText('AI tools via Meta MCP')).toBeVisible()
  await expect(card.getByTestId('mcp-account')).toHaveText('Instagram @lotus.mcp')
  // META_* are unset on the e2e server: publishing needs a configured connection; drafting works.
  const posts = card.getByTestId('mcp-group-instagram_posts')
  await expect(
    posts.getByTestId('mcp-tool').filter({ hasText: 'instagram.create_post_draft' }),
  ).toContainText('On')
  await expect(
    posts.getByTestId('mcp-tool').filter({ hasText: 'instagram.publish_approved_post' }),
  ).toContainText('Needs a connection')
  await expect(card.getByText('whatsapp.draft_message')).toBeVisible()
  await expect(card.getByText(/whatsapp\.send/)).toHaveCount(0)

  await card.getByLabel('Instruction').fill('Reply to the new comment and draft a Friday post')
  await card.getByRole('button', { name: 'Run' }).click()
  await expect(page.getByText(/Done — Drafted a comment reply and a post/)).toBeVisible()

  // Comment reply = an AI draft waiting in the inbox (autopilot is off).
  await page.goto(`${app}/${slug}/inbox`)
  const list = page.getByTestId('conversation-list')
  await expect(list.getByText('Draft to approve')).toBeVisible()
  await list.getByRole('link', { name: /@sara\.relax/ }).click()
  await expect(page.getByTestId('thread').getByLabel('AI draft')).toHaveValue(/open until 10 pm on Friday/)

  // Post = pending approval in AI studio → Content.
  await page.goto(`${app}/${slug}/ai/content`)
  await expect(page.getByText('Friday nights are for hot-stone massage. Book now.')).toBeVisible()

  const actions = (
    await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(and(eq(auditLog.tenantId, tenant!.id)))
  ).map((a) => a.action)
  expect(actions).toEqual(
    expect.arrayContaining([
      'ai.mcp.instagram.reply_comment',
      'ai.mcp.instagram.create_post_draft',
      'ai.mcp.run',
    ]),
  )
})
