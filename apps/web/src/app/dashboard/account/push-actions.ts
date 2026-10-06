'use server'
import { deletePushSubscription, notifyUser, pushConfigured, savePushSubscription } from '@spa/services'
import { z } from 'zod'
import { type ActionResult, fail, fromZod, ok } from '@/lib/action'
import { audit } from '@/server/audit'
import { getSession } from '@/server/session'

// Push subscriptions are per user and device (platform-level), so these re-check the session, not a tenant.
const endpoint = z
  .url({ protocol: /^https$/, message: 'Invalid push endpoint' })
  .max(1000, 'Invalid push endpoint')
const subscription = z.object({
  endpoint,
  keys: z.object({ p256dh: z.string().min(16).max(200), auth: z.string().min(8).max(100) }),
})

async function signedIn() {
  const session = await getSession()
  return session?.user ?? null
}

export async function subscribePushAction(input: unknown): Promise<ActionResult> {
  const user = await signedIn()
  if (!user) return fail('Please sign in again.')
  if (!pushConfigured()) return fail('Notifications are not set up on this platform yet.')
  const parsed = subscription.safeParse(input)
  if (!parsed.success) return fromZod(parsed.error)
  await savePushSubscription(user.id, parsed.data)
  await audit({ actorUserId: user.id, action: 'push.subscribed', entity: 'push_subscription' })
  return ok('Notifications are on for this device')
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
