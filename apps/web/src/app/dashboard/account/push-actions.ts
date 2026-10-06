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
import { type ActionResult, fail, ok } from '@/lib/action'
import { audit } from '@/server/audit'
import { getSession } from '@/server/session'

// Push subscriptions are per user and device (platform-level), so these re-check the session, not a tenant.
// Only browsers' push services are accepted, so the server never POSTs to an arbitrary or internal host.
const endpoint = z
  .url({ protocol: /^https$/, message: 'Invalid push endpoint' })
  .max(1000, 'Invalid push endpoint')
  .refine(isPushEndpoint, 'This browser uses a push service we don’t support')
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
  if (!user) return fail('Please sign in again.')
  if (!pushConfigured()) return fail('Notifications are not set up on this platform yet.')
  const parsed = subscription.safeParse(input)
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid push subscription')
  await savePushSubscription(user.id, parsed.data)
  await audit({ actorUserId: user.id, action: 'push.subscribed', entity: 'push_subscription' })
  return ok('Notifications are on for this device')
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
  if (!user) return fail('Please sign in again.')
  const parsed = endpoint.safeParse(input)
  if (!parsed.success) return fail('Invalid push endpoint')
  await deletePushSubscription(user.id, parsed.data)
  await audit({ actorUserId: user.id, action: 'push.unsubscribed', entity: 'push_subscription' })
  return ok('Notifications are off for this device')
}

export async function testPushAction(input: unknown): Promise<ActionResult> {
  const user = await signedIn()
  if (!user) return fail('Please sign in again.')
  if (!pushConfigured()) return fail('Notifications are not set up on this platform yet.')
  const parsed = endpoint.safeParse(input)
  if (!parsed.success) return fail('Invalid push endpoint')
  if (!allowTest(user.id)) return fail('That’s a lot of tests — try again in a few minutes.')
  const res = await notifyUser(
    user.id,
    { title: 'Notifications work', body: 'New bookings and reminders will appear here.', url: '/account' },
    { endpoint: parsed.data },
  )
  if (res.sent) return ok('Test notification sent')
  return fail(
    res.pruned
      ? 'This device unsubscribed — turn notifications on again.'
      : "Couldn't reach this device. Try again in a moment.",
  )
}
