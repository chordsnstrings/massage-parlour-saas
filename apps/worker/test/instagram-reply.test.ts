import { respondToInstagram } from '@spa/ai'
import { closeAllDbs, conversationMessages, conversations, instagramReplyQueue, tenants } from '@spa/db'
import { resetTestDatabase, testDbs, testUrls } from '@spa/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { jobs } from '../src/jobs'
import { replyToInstagramMessages } from '../src/jobs/instagram'

vi.mock('@spa/ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@spa/ai')>()),
  respondToInstagram: vi.fn(async () => 'sent' as const),
}))

const { owner } = testDbs()
const spy = vi.mocked(respondToInstagram)

describe('instagram-reply job (B6, DB queue)', () => {
  let item: {
    tenantId: string
    conversationId: string
    messageId: string
    channel: 'instagram_comment'
    text: string
  }
  beforeAll(async () => {
    process.env.DATABASE_URL_APP = testUrls.app
    process.env.DATABASE_URL_PLATFORM = testUrls.platform
    await resetTestDatabase()
    const [t] = await owner.insert(tenants).values({ slug: 'ig-job', name: 'IG job' }).returning()
    const [c] = await owner
      .insert(conversations)
      .values({ tenantId: t!.id, channel: 'instagram_comment', externalThreadId: 'media-1' })
      .returning()
    const [m] = await owner
      .insert(conversationMessages)
      .values({ tenantId: t!.id, conversationId: c!.id, direction: 'in', sender: 'customer', text: 'Price?' })
      .returning()
    item = {
      tenantId: t!.id,
      conversationId: c!.id,
      messageId: m!.id,
      channel: 'instagram_comment',
      text: 'Price?',
    }
  })
  beforeEach(() => spy.mockClear())
  afterAll(() => closeAllDbs())

  const queue = () =>
    owner.select().from(instagramReplyQueue).where(eq(instagramReplyQueue.messageId, item.messageId))
  const enqueue = () =>
    owner
      .insert(instagramReplyQueue)
      .values({ tenantId: item.tenantId, messageId: item.messageId })
      .onConflictDoNothing()

  it('is a worker cron job (every minute), not a web-side queue', () => {
    expect(jobs.find((j) => j.name === 'instagram-reply')?.cron).toBe('* * * * *')
  })

  it('answers a queued message once and deletes its row; a duplicate row is impossible (PK)', async () => {
    await enqueue()
    await enqueue()
    expect(await replyToInstagramMessages()).toEqual({ answered: 1, failed: 0 })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0]![0]).toMatchObject({ messageId: item.messageId, text: 'Price?' })
    expect(await queue()).toHaveLength(0)
    expect(await replyToInstagramMessages()).toEqual({ answered: 0, failed: 0 })
  })

  it('backs off on failure and gives up after 5 tries', async () => {
    await enqueue()
    spy.mockRejectedValue(new Error('ModelArk down'))
    let now = new Date()
    expect(await replyToInstagramMessages(now)).toEqual({ answered: 0, failed: 1 })
    let [row] = await queue()
    expect(row).toMatchObject({ attempts: 1, lastError: 'ModelArk down', failedAt: null })
    expect(row!.nextAt.getTime() - now.getTime()).toBe(30_000)
    expect(await replyToInstagramMessages(now)).toEqual({ answered: 0, failed: 0 }) // not due yet
    for (let i = 2; i <= 5; i++) {
      now = new Date(row!.nextAt.getTime() + 1)
      await replyToInstagramMessages(now)
      ;[row] = await queue()
    }
    expect(row!.attempts).toBe(5)
    expect(row!.failedAt).not.toBeNull()
    expect(await replyToInstagramMessages(new Date(now.getTime() + 86_400_000))).toEqual({
      answered: 0,
      failed: 0,
    })
    spy.mockReset()
    spy.mockResolvedValue('sent')
    await owner.delete(instagramReplyQueue)
  })

  it('skips the AI turn once the thread has a reply (idempotent retry)', async () => {
    await owner.insert(conversationMessages).values({
      tenantId: item.tenantId,
      conversationId: item.conversationId,
      direction: 'out',
      sender: 'ai_draft',
      text: 'Thanks! DM us.',
    })
    await enqueue()
    expect(await replyToInstagramMessages()).toEqual({ answered: 1, failed: 0 })
    expect(spy).not.toHaveBeenCalled()
    expect(await queue()).toHaveLength(0)
  })
})
