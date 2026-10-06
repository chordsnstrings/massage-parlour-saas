'use client'
import { LogOut, MapPin, RefreshCw } from 'lucide-react'
import { useTransition } from 'react'
import {
  changeLocationAction,
  connectGoogleAction,
  disconnectGoogleAction,
  syncGoogleReviewsAction,
} from '@/app/api/integrations/google/actions'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import type { ActionResult } from '@/lib/action'

const TOUCH = 'h-11 sm:h-10'

function useRun() {
  const [pending, start] = useTransition()
  const run = (fn: () => Promise<ActionResult>, after?: (r: Extract<ActionResult, { ok: true }>) => void) =>
    start(async () => {
      const r = await fn()
      if (!r) return
      if (r.ok) {
        if (r.message) toast.success(r.message)
        after?.(r)
      } else toast.error(r.error)
    })
  return { pending, run }
}

/** Sends the browser to Google's consent screen (the URL carries the signed state + PKCE challenge). */
export function ConnectGoogleButton({ slug, label = 'Connect Google' }: { slug: string; label?: string }) {
  const { pending, run } = useRun()
  return (
    <Button
      className={TOUCH}
      pending={pending}
      onClick={() =>
        run(
          () => connectGoogleAction(slug),
          (r) => {
            const url = r.data?.url
            if (typeof url === 'string') window.location.assign(url)
          },
        )
      }
    >
      {label}
    </Button>
  )
}

export function SyncGoogleButton({
  slug,
  variant = 'secondary',
}: {
  slug: string
  variant?: 'secondary' | 'primary'
}) {
  const { pending, run } = useRun()
  return (
    <Button
      variant={variant}
      className={TOUCH}
      pending={pending}
      onClick={() => run(() => syncGoogleReviewsAction(slug))}
    >
      {!pending && <RefreshCw />} Sync now
    </Button>
  )
}

export function ChangeLocationButton({ slug }: { slug: string }) {
  const { pending, run } = useRun()
  return (
    <Button
      variant="ghost"
      className={TOUCH}
      pending={pending}
      onClick={() => run(() => changeLocationAction(slug))}
    >
      {!pending && <MapPin />} Change location
    </Button>
  )
}

export function DisconnectGoogleButton({ slug }: { slug: string }) {
  const { pending, run } = useRun()
  return (
    <Button
      variant="ghost"
      className={`${TOUCH} text-danger hover:text-danger`}
      pending={pending}
      onClick={() => {
        if (window.confirm('Disconnect Google Business Profile? Reviews already imported stay here.'))
          run(() => disconnectGoogleAction(slug))
      }}
    >
      {!pending && <LogOut />} Disconnect
    </Button>
  )
}
