import { respondToInstagram } from '@spa/ai'
import { constantTimeEqual, ingestInstagramWebhook, metaConfig, verifyMetaSignature } from '@spa/services'
import { after, type NextRequest } from 'next/server'
import { enqueueInstagramReplies } from '@/server/jobs'

export const dynamic = 'force-dynamic'

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } })

/** Meta's subscription check: echo hub.challenge when the verify token matches. */
export async function GET(req: NextRequest) {
  const cfg = metaConfig()
  if (!cfg) return text('Instagram is not configured', 503)
  const q = req.nextUrl.searchParams
  if (q.get('hub.mode') === 'subscribe' && constantTimeEqual(q.get('hub.verify_token'), cfg.verifyToken))
    return text(q.get('hub.challenge') ?? '', 200)
  return text('Forbidden', 403)
}

/**
 * DM + comment events. The signature covers the raw body; storing the messages is quick and happens before we answer
 * (so Meta retries if the database is down); each AI turn is queued as an `instagram-reply` pg-boss job.
 */
export async function POST(req: NextRequest) {
  const cfg = metaConfig()
  if (!cfg) return text('Instagram is not configured', 503)
  const raw = await req.text()
  if (!verifyMetaSignature(raw, req.headers.get('x-hub-signature-256'), cfg.appSecret))
    return text('Invalid signature', 403)
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return text('Bad payload', 400)
  }
  let items: Awaited<ReturnType<typeof ingestInstagramWebhook>>
  try {
    items = await ingestInstagramWebhook(body)
  } catch (e) {
    console.error('instagram webhook: ingest failed', e instanceof Error ? e.message : 'unknown error')
    return text('Try again', 500)
  }
  if (items.length) {
    // Durable path: one pg-boss job per message (worker `instagram-reply`, retries with backoff, survives restarts).
    try {
      await enqueueInstagramReplies(items)
    } catch (e) {
      // Queue unreachable (worker never started on this database): answer in-process rather than drop the turn.
      console.error(
        'instagram webhook: enqueue failed, replying inline',
        e instanceof Error ? e.message : 'unknown',
      )
      after(async () => {
        for (const item of items) {
          try {
            await respondToInstagram(item)
          } catch (err) {
            // The message stays unread in the inbox for staff; no tokens are ever part of these errors.
            console.error('instagram webhook: agent turn failed', {
              tenantId: item.tenantId,
              error: err instanceof Error ? err.message.slice(0, 200) : 'unknown error',
            })
          }
        }
      })
    }
  }
  return text('EVENT_RECEIVED', 200)
}
