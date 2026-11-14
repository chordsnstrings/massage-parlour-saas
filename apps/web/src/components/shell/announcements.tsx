'use client'
// F20: platform announcements as dismissible banners in the spa dashboard (per member; never email/SMS).
import { X } from 'lucide-react'
import { useState, useTransition } from 'react'
import { dismissAnnouncementAction } from '@/app/dashboard/[tenant]/announcements/actions'
import { useT } from '@/i18n/client'
import type { ShownAnnouncement } from '@/server/announcements'

const TONE = { info: 'accent', warning: 'warning', critical: 'danger' } as const

export function Announcements({
  slug,
  items,
  platform,
}: {
  slug: string
  items: ShownAnnouncement[]
  platform: string
}) {
  const t = useT()
  const [hidden, setHidden] = useState<string[]>([])
  const [, start] = useTransition()
  const shown = items.filter((a) => !hidden.includes(a.id))
  if (shown.length === 0) return null
  return (
    <>
      {shown.map((a) => (
        <section
          key={a.id}
          className="crm-banner crm-announce"
          data-tone={TONE[a.severity]}
          role={a.severity === 'critical' ? 'alert' : 'status'}
          aria-label={t('shell.announcement.label', { platform })}
        >
          <div className="crm-announce-text">
            <strong>{a.title}</strong>
            <span>{a.body}</span>
          </div>
          <button
            type="button"
            className="crm-announce-close"
            aria-label={t('shell.announcement.dismiss')}
            title={t('shell.announcement.dismiss')}
            onClick={() => {
              setHidden((h) => [...h, a.id])
              start(async () => {
                await dismissAnnouncementAction(slug, a.id)
              })
            }}
          >
            <X className="size-3.5" strokeWidth={2} />
          </button>
        </section>
      ))}
    </>
  )
}
