'use client'
import { BellOff, BellRing, Smartphone } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useState } from 'react'
import {
  pushStatusAction,
  subscribePushAction,
  testPushAction,
  unsubscribePushAction,
} from '@/app/dashboard/account/push-actions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { toast } from '@/components/ui/toast'
import { resultText, useT } from '@/i18n/client'
import type { ActionResult } from '@/lib/action'
import { registerWorker } from '@/lib/sw'

type State = 'loading' | 'unconfigured' | 'unsupported' | 'denied' | 'off' | 'on'

const BADGE_TONE: Record<State, 'neutral' | 'success' | 'warning'> = {
  loading: 'neutral',
  unconfigured: 'neutral',
  unsupported: 'neutral',
  denied: 'warning',
  off: 'neutral',
  on: 'success',
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

async function currentSubscription() {
  const reg = await navigator.serviceWorker.getRegistration('/')
  return (await reg?.pushManager.getSubscription()) ?? null
}

/** "Enable notifications on this device": permission prompt → push subscription → saved for this user. */
export function NotificationsCard({ publicKey }: { publicKey: string | null }) {
  const t = useT()
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
    // "On" only when the server has this device for the signed-in user: on a shared front-desk computer the
    // browser subscription may still belong to whoever enabled it before (Enable moves it to this user).
    currentSubscription()
      .then(async (sub) => {
        const on = sub && Notification.permission === 'granted' && (await pushStatusAction(sub.endpoint)).on
        setState(on ? 'on' : 'off')
      })
      .catch(() => {
        setState('off')
      })
  }, [publicKey])

  const report = (res: ActionResult) => {
    if (res?.ok && res.message) toast.success(resultText(t, res) ?? '')
    else if (res && !res.ok) toast.error(resultText(t, res) ?? '')
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
      await registerWorker() // usually already registered by the dashboard (components/pwa); same URL + scope
      const reg = await navigator.serviceWorker.ready
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(publicKey),
        }))
      if (report(await subscribePushAction(sub.toJSON()))) setState('on')
    } catch {
      toast.error(t('account.push.failed'))
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

  return (
    <Card>
      <CardHeader
        title={t('account.push.title')}
        description={t('account.push.sub')}
        action={<Badge tone={BADGE_TONE[state]}>{t(`account.push.badge.${state}`)}</Badge>}
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
            <span className="max-w-md">{t(`account.push.text.${state}`)}</span>
          </p>
          <div className="flex shrink-0 flex-wrap gap-2">
            {state === 'off' && (
              <Button onClick={enable} pending={busy === 'enable'} className="min-h-11 sm:min-h-10">
                <BellRing /> {t('account.push.enable')}
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
                  {t('account.push.test')}
                </Button>
                <Button
                  variant="ghost"
                  onClick={disable}
                  pending={busy === 'disable'}
                  className="min-h-11 sm:min-h-10"
                >
                  {t('account.push.turnOff')}
                </Button>
              </>
            )}
          </div>
        </motion.div>
      </CardBody>
    </Card>
  )
}
