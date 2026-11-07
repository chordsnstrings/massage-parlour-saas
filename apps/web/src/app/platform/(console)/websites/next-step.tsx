import type { WebsiteNextStep, WebsiteStatus } from '@spa/services'
import { ArrowUpRight } from 'lucide-react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { studioPath } from '@/lib/paths'

/** R23 website status labels (computed by services `websiteProgress`). */
export const WEBSITE_STATUS = {
  none: { label: 'Not started', tone: 'warning' },
  template: { label: 'Template chosen', tone: 'neutral' },
  draft: { label: 'Draft', tone: 'accent' },
  live: { label: 'Live', tone: 'success' },
} as const satisfies Record<WebsiteStatus, { label: string; tone: string }>

/** Status badge + the small "Unpublished changes" hint while live. */
export function WebsiteStatusBadge({ status, unpublished }: { status: WebsiteStatus; unpublished: boolean }) {
  const s = WEBSITE_STATUS[status]
  return (
    <span className="inline-flex flex-col items-end gap-1 md:items-start">
      <Badge tone={s.tone}>{s.label}</Badge>
      {unpublished && <span className="text-xs text-muted">Unpublished changes</span>}
    </span>
  )
}

/** The one next step for a spa's website: Choose template / Continue editing / Publish / Open site. */
export function NextStepButton({
  row,
  url,
  size = 'sm',
}: {
  row: { name: string; slug: string; next: WebsiteNextStep; homePageId: string | null }
  /** The spa's public address (open_site). */
  url: string
  size?: 'sm' | 'md'
}) {
  const cls = size === 'sm' ? 'h-10' : undefined
  if (row.next === 'open_site')
    return (
      <Button variant="secondary" size={size} asChild className={cls}>
        <a href={url} target="_blank" rel="noreferrer" aria-label={`Open site for ${row.name}`}>
          Open site <ArrowUpRight />
        </a>
      </Button>
    )
  const [href, label] =
    row.next === 'choose_template'
      ? [studioPath(row.slug, '#templates'), 'Choose template']
      : row.next === 'continue_editing'
        ? [studioPath(row.slug, row.homePageId ? `/editor/${row.homePageId}` : ''), 'Continue editing']
        : [studioPath(row.slug, '?publish=1'), 'Publish']
  return (
    <Button size={size} asChild className={cls}>
      <Link href={href} aria-label={`${label} for ${row.name}`}>
        {label}
      </Link>
    </Button>
  )
}
