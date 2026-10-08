import { respondToInstagram } from '@spa/ai'
import { closeAllDbs, conversationMessages, conversations, tenants } from '@spa/db'
import { resetTestDatabase, testDbs, testUrls } from '@spa/db/testing'
import { INSTAGRAM_REPLY_QUEUE, instagramReplyJobId } from '@spa/services'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { jobs } from '../src/jobs'
import { replyToInstagramItem } from '../src/jobs/instagram'

vi.mock('@spa/ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@spa/ai')>()),
  respondToInstagram: vi.fn(async () => 'sent' as const),
}))

const { owner } = testDbs()
const spy = vi.mocked(respondToInstagram)

describe('instagram-reply job (B6)', () => {
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

  it('is a retrying queue (exponential backoff)', () => {
    const def = jobs.find((j) => j.name === INSTAGRAM_REPLY_QUEUE)
    expect(def?.cron).toBeUndefined()
    expect(def?.queue).toMatchObject({ retryLimit: 5, retryBackoff: true })
  })

  it('derives one stable job id per message (duplicates are dropped by pg-boss)', () => {
    const id = instagramReplyJobId(item)
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(instagramReplyJobId({ ...item })).toBe(id)
    expect(instagramReplyJobId({ ...item, messageId: crypto.randomUUID() })).not.toBe(id)
  })

  it('runs the AI turn once, then skips a retry once the thread has a reply', async () => {
    expect(await replyToInstagramItem(item)).toBe('sent')
    expect(spy).toHaveBeenCalledTimes(1)
    await owner.insert(conversationMessages).values({
      tenantId: item.tenantId,
      conversationId: item.conversationId,
      direction: 'out',
      sender: 'ai_draft',
      text: 'Thanks! DM us.',
    })
    expect(await replyToInstagramItem(item)).toBe('answered')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('rejects malformed job data', async () => {
    await expect(replyToInstagramItem({ tenantId: 'x' })).rejects.toThrow('bad job data')
    expect(spy).not.toHaveBeenCalled()
  })
})
