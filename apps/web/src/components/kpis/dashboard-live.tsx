'use client'
// R36: keeps the dashboard home's two live cards fresh. Every 30 s while the tab is visible (and on coming back to
// it) it asks for the cards' fingerprint and refreshes the page when it changed. `label` shows the "Live" note.
import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { dashboardPulseAction } from './today-actions'

export function DashboardLive({
  slug,
  branch,
  day,
  pulse,
  label,
}: {
  slug: string
  /** The page's ?branch= / ?day= (undefined = the default; day then follows the business date). */
  branch?: string
  day?: string
  pulse: string
  label?: string
}) {
  const router = useRouter()
  const last = useRef(pulse)

  useEffect(() => {
    last.current = pulse
  }, [pulse])

  useEffect(() => {
    let busy = false
    const check = async () => {
      if (busy || document.visibilityState !== 'visible') return
      busy = true
      try {
        const next = await dashboardPulseAction(slug, { branch, day })
        if (next && next !== last.current) {
          last.current = next
          router.refresh()
        }
      } catch {
        // Offline or signed out: try again next time.
      } finally {
        busy = false
      }
    }
    const id = setInterval(() => {
      void check()
    }, 30_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [slug, branch, day, router])

  if (!label) return null
  return (
    <span className="crm-muted inline-flex items-center gap-1.5 text-[length:var(--crm-fs-sub)]">
      <span className="size-1.5 rounded-full bg-[var(--crm-ok)] motion-safe:animate-pulse" aria-hidden />
      {label}
    </span>
  )
}
