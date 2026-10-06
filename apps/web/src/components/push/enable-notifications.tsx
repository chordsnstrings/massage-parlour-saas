'use client'
import { BellOff, BellRing, Smartphone } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useState } from 'react'
import {
  subscribePushAction,
  testPushAction,
  unsubscribePushAction,
} from '@/app/dashboard/account/push-actions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { toast } from '@/components/ui/toast'
import type { ActionResult } from '@/lib/action'
import { appPath } from '@/lib/paths'

type State = 'loading' | 'unconfigured' | 'unsupported' | 'denied' | 'off' | 'on'

const BADGE: Record<State, { label: string; tone: 'neutral' | 'success' | 'warning' }> = {
  loading: { label: '…', tone: 'neutral' },
  unconfigured: { label: 'Not set up', tone: 'neutral' },
  unsupported: { label: 'Unavailable', tone: 'neutral' },
  denied: { label: 'Blocked', tone: 'warning' },
  off: { label: 'Off', tone: 'neutral' },
  on: { label: 'On', tone: 'success' },
}

/** Base64url VAPID key → bytes for PushManager.subscribe(). */
function keyBytes(base64url: string) {
  const padded = `${base64url}${'='.repeat((4 - (base64url.length % 4)) % 4)}`
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

const supported = () =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window

// The worker prefixes notification links with the app surface base ("/app" with path routing).
const workerUrl = () => {
  const base = appPath('/') === '/' ? '' : appPath('/')
  return `/sw.js${base ? `?base=${encodeURIComponent(base)}` : ''}`
}

async function currentSubscription() {
  const reg = await navigator.serviceWorker.getRegistration('/')
  return (await reg?.pushManager.getSubscription()) ?? null
}

/** "Enable notifications on this device": permission prompt → push subscription → saved for this user. */
export function NotificationsCard({ publicKey }: { publicKey: string | null }) {
  const [state, setState] = useState<State>(publicKey ? 'loading' : 'unconfigured')
  const [busy, setBusy] = useState<'enable' | 'disable' | 'test' | null>(null)

  useEffect(() => {
    if (!publicKey) return
    if (!supported()) {
      setState('unsupported')
      return
    }
    if (Notification.permission === 'denied') {
      setState('denied')
      return
    }
    currentSubscription()
      .then((sub) => {
        setState(sub && Notification.permission === 'granted' ? 'on' : 'off')
      })
      .catch(() => {
        setState('off')
      })
  }, [publicKey])

  const report = (res: ActionResult) => {
    if (res?.ok && res.message) toast.success(res.message)
    else if (res && !res.ok) toast.error(res.error)
    return Boolean(res?.ok)
  }

  async function enable() {
    if (!publicKey) return
    setBusy('enable')
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'off')
        return
      }
      await navigator.serviceWorker.register(workerUrl(), { scope: '/' })
      const reg = await navigator.serviceWorker.ready
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(publicKey),
        }))
      if (report(await subscribePushAction(sub.toJSON()))) setState('on')
    } catch {
      toast.error("Couldn't turn on notifications in this browser.")
    } finally {
      setBusy(null)
    }
  }

  async function disable() {
    setBusy('disable')
    try {
      const sub = await currentSubscription()
      if (sub) {
        await unsubscribePushAction(sub.endpoint).then(report)
        await sub.unsubscribe()
      }
      setState('off')
    } finally {
      setBusy(null)
    }
  }

  async function test() {
    setBusy('test')
    try {
      const sub = await currentSubscription()
      if (!sub) {
        setState('off')
        return
      }
      report(await testPushAction(sub.endpoint))
    } finally {
      setBusy(null)
    }
  }

  const badge = BADGE[state]
  return (
    <Card>
      <CardHeader
        title="Notifications on this device"
        description="New online bookings, document expiry reminders and your weekly insights — on this phone or computer."
        action={<Badge tone={badge.tone}>{badge.label}</Badge>}
      />
      <CardBody className="pt-4 sm:pt-5">
        <motion.div
          key={state}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="flex items-start gap-3 text-sm text-muted">
            <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-subtle text-muted">
              {state === 'on' ? (
                <BellRing className="size-4" strokeWidth={1.5} />
              ) : state === 'unsupported' ? (
                <Smartphone className="size-4" strokeWidth={1.5} />
              ) : (
                <BellOff className="size-4" strokeWidth={1.5} />
              )}
            </span>
            <span className="max-w-md">
              {state === 'unconfigured' &&
                "Push notifications aren't set up on this platform yet. They'll appear here once your provider switches them on."}
              {state === 'unsupported' &&
                'This browser can’t receive notifications. On iPhone, add the app to your Home Screen first (Share → Add to Home Screen), then open it from there.'}
              {state === 'denied' &&
                'Notifications are blocked for this site. Allow them in your browser’s site settings, then come back here.'}
              {state === 'off' && 'Get a ping the moment something needs you. You can turn it off any time.'}
              {state === 'on' && 'This device will be notified. Each phone or computer is set up separately.'}
              {state === 'loading' && 'Checking this device…'}
            </span>
          </p>
          <div className="flex shrink-0 flex-wrap gap-2">
            {state === 'off' && (
              <Button onClick={enable} pending={busy === 'enable'} className="min-h-11 sm:min-h-10">
                <BellRing /> Enable notifications
              </Button>
            )}
            {state === 'on' && (
              <>
                <Button
                  variant="secondary"
                  onClick={test}
                  pending={busy === 'test'}
                  className="min-h-11 sm:min-h-10"
                >
                  Send a test
                </Button>
                <Button
                  variant="ghost"
                  onClick={disable}
                  pending={busy === 'disable'}
                  className="min-h-11 sm:min-h-10"
                >
                  Turn off
                </Button>
              </>
            )}
          </div>
        </motion.div>
      </CardBody>
    </Card>
  )
}
