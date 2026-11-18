// R46: the Ask AI drawer's Confirm buttons carry the prepared change as a signed, short-lived token (HMAC of
// BETTER_AUTH_SECRET, domain-separated), bound to the spa and the member who asked. The server re-checks everything
// again on confirm; the token only proves the change was prepared for this person in the last few minutes.
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { AssistantAction } from '@spa/ai'

const TTL_MS = 10 * 60_000

function key() {
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret) throw new Error('BETTER_AUTH_SECRET is not set')
  return createHmac('sha256', secret).update('spa:ask-ai-action:v1').digest()
}

const mac = (body: string) => createHmac('sha256', key()).update(body).digest('base64url')

type Claims = { t: string; u: string; exp: number; a: AssistantAction }

export function signAssistantAction(tenantId: string, userId: string, a: AssistantAction, now = Date.now()) {
  const body = Buffer.from(
    JSON.stringify({ t: tenantId, u: userId, exp: now + TTL_MS, a } satisfies Claims),
  ).toString('base64url')
  return `${body}.${mac(body)}`
}

/** The prepared change, or null when the token is forged, for someone else, or expired. */
export function readAssistantAction(token: string, tenantId: string, userId: string, now = Date.now()) {
  const [body, sig] = token.split('.')
  if (!body || !sig || token.length > 4000) return null
  const want = Buffer.from(mac(body))
  const got = Buffer.from(sig)
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null
  try {
    const c = JSON.parse(Buffer.from(body, 'base64url').toString()) as Claims
    if (c.t !== tenantId || c.u !== userId || typeof c.exp !== 'number' || c.exp < now) return null
    return c.a
  } catch {
    return null
  }
}
