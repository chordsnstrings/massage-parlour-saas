import { constantTimeEqual, ingestInstagramWebhook, metaConfig, verifyMetaSignature } from '@spa/services'
import type { NextRequest } from 'next/server'

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
 * (so Meta retries if the database is down); the AI turn is the worker's `instagram-reply` job (no work in the web
 * process, no pg-boss or owner role here).
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
  try {
    // Stores the messages and, for live spas, their instagram_reply_queue rows in one transaction; the worker's
    // `instagram-reply` job (every minute, retries with backoff) produces the AI turns.
    await ingestInstagramWebhook(body)
  } catch (e) {
    console.error('instagram webhook: ingest failed', e instanceof Error ? e.message : 'unknown error')
    return text('Try again', 500)
  }
  return text('EVENT_RECEIVED', 200)
}
