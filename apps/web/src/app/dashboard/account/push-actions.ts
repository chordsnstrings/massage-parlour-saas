'use server'
import {
  deletePushSubscription,
  hasPushSubscription,
  isPushEndpoint,
  notifyUser,
  pushConfigured,
  savePushSubscription,
} from '@spa/services'
import { z } from 'zod'
import { getT } from '@/i18n/server'
import { type ActionResult, fail, ok } from '@/lib/action'
import { audit } from '@/server/audit'
import { getSession } from '@/server/session'

// Push subscriptions are per user and device (platform-level), so these re-check the session, not a tenant.
// Only browsers' push services are accepted, so the server never POSTs to an arbitrary or internal host.
const endpoint = z
  .url({ protocol: /^https$/, message: 'account.push.result.invalidEndpoint' })
  .max(1000, 'account.push.result.invalidEndpoint')
  .refine(isPushEndpoint, 'account.push.result.unsupportedService')
const subscription = z.object({
  endpoint,
  keys: z.object({ p256dh: z.string().min(16).max(200), auth: z.string().min(8).max(100) }),
})

// Test pushes per user: at most 5 per 10 minutes (one web process on the droplet, so in memory is enough).
const TEST_WINDOW_MS = 10 * 60_000
const TEST_LIMIT = 5
const testsByUser = new Map<string, number[]>()
function allowTest(userId: string, now = Date.now()) {
  const recent = (testsByUser.get(userId) ?? []).filter((t) => now - t < TEST_WINDOW_MS)
  if (recent.length >= TEST_LIMIT) return false
  testsByUser.set(userId, [...recent, now])
  if (testsByUser.size > 5000) testsByUser.delete(testsByUser.keys().next().value!)
  return true
}

async function signedIn() {
  const session = await getSession()
  return session?.user ?? null
}

export async function subscribePushAction(input: unknown): Promise<ActionResult> {
  const user = await signedIn()
  if (!user) return fail('errors.signInAgain')
  if (!pushConfigured()) return fail('account.push.result.notSetUp')
  const parsed = subscription.safeParse(input)
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? 'account.push.result.invalidSubscription')
  await savePushSubscription(user.id, parsed.data)
  await audit({ actorUserId: user.id, action: 'push.subscribed', entity: 'push_subscription' })
  return ok('account.push.result.on')
}

/** Whether this device's endpoint is registered to the signed-in user (not someone who used it before). */
export async function pushStatusAction(input: unknown): Promise<{ on: boolean }> {
  const user = await signedIn()
  if (!user) return { on: false }
  const parsed = endpoint.safeParse(input)
  if (!parsed.success) return { on: false }
  return { on: await hasPushSubscription(user.id, parsed.data) }
}

export async function unsubscribePushAction(input: unknown): Promise<ActionResult> {
  const user = await signedIn()
  if (!user) return fail('errors.signInAgain')
  const parsed = endpoint.safeParse(input)
  if (!parsed.success) return fail('account.push.result.invalidEndpoint')
  await deletePushSubscription(user.id, parsed.data)
  await audit({ actorUserId: user.id, action: 'push.unsubscribed', entity: 'push_subscription' })
  return ok('account.push.result.off')
}

export async function testPushAction(input: unknown): Promise<ActionResult> {
  const user = await signedIn()
  if (!user) return fail('errors.signInAgain')
  if (!pushConfigured()) return fail('account.push.result.notSetUp')
  const parsed = endpoint.safeParse(input)
  if (!parsed.success) return fail('account.push.result.invalidEndpoint')
  if (!allowTest(user.id)) return fail('account.push.result.tooMany')
  const t = await getT()
  const res = await notifyUser(
    user.id,
    { title: t('account.push.result.testTitle'), body: t('account.push.result.testBody'), url: '/account' },
    { endpoint: parsed.data },
  )
  if (res.sent) return ok('account.push.result.sent')
  return fail(res.pruned ? 'account.push.result.pruned' : 'account.push.result.unreachable')
}
