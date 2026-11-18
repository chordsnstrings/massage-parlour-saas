'use client'
import { Check, History, Link2, PenLine, RotateCcw, X } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useState, useTransition } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { Sheet } from '@/components/ui/sheet'
import { toast } from '@/components/ui/toast'
import type { ActionResult } from '@/lib/action'
import { spring } from '@/lib/motion'
import { cn } from '@/lib/utils'

export type VersionItem = {
  id: string
  status: 'draft' | 'published'
  label: string | null
  author: string | null
  createdAt: string
}

type Api = {
  list: () => Promise<ActionResult>
  label: (versionId: string, label: string) => Promise<ActionResult>
  restore: (versionId: string) => Promise<ActionResult>
  previewLink: (days: 1 | 7 | 30) => Promise<ActionResult>
}

const when = new Intl.DateTimeFormat('en-AE', {
  timeZone: 'Asia/Dubai',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})
const DAYS = [
  [1, '1 day'],
  [7, '7 days'],
  [30, '30 days'],
] as const

/**
 * Version history drawer (PLAN §11.6): versions with author and time, name a version, restore one as the
 * draft — plus a shareable, expiring preview link of the draft with its QR code for checking on a phone.
 */
export function VersionsSheet({
  api,
  dirty,
  onRestored,
}: {
  api: Api
  dirty: boolean
  onRestored: (data: Record<string, unknown>) => void
}) {
  const [open, setOpen] = useState(false)
  const [versions, setVersions] = useState<VersionItem[] | null>(null)
  const [loading, startLoad] = useTransition()
  const reload = () =>
    startLoad(async () => {
      const r = await api.list()
      if (r?.ok) setVersions(r.data?.versions as VersionItem[])
      else if (r) toast.error(r.error)
    })
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh each time the drawer opens
  useEffect(() => {
    if (open) reload()
  }, [open])

  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title="Versions & preview"
      description="Every publish is kept, and so is a draft once you name it or restore over it."
      trigger={
        <Button variant="ghost" size="icon" aria-label="Versions and preview link" title="Versions & preview">
          <History />
        </Button>
      }
    >
      <SharePreview api={api} />
      <section aria-label="Version history" className="mt-6">
        <h3 className="mb-2 text-[11px] font-semibold tracking-[0.08em] text-muted uppercase">History</h3>
        {versions === null ? (
          <div className="space-y-2" aria-busy={loading}>
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-xl bg-subtle" />
            ))}
          </div>
        ) : versions.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted">
            No versions yet.
          </p>
        ) : (
          <ol className="divide-y rounded-xl border">
            {versions.map((v, i) => (
              <VersionRow
                key={v.id}
                version={v}
                current={i === 0}
                draftKept={versions[0]?.status === 'draft'}
                dirty={dirty}
                api={api}
                onChanged={reload}
                onRestored={(data) => {
                  onRestored(data)
                  setOpen(false)
                }}
              />
            ))}
          </ol>
        )}
      </section>
    </Sheet>
  )
}

function SharePreview({ api }: { api: Api }) {
  const [days, setDays] = useState<1 | 7 | 30>(7)
  const [link, setLink] = useState<{ url: string; qr: string; expiresAt: string } | null>(null)
  const [pending, start] = useTransition()
  const create = () =>
    start(async () => {
      const r = await api.previewLink(days)
      if (r?.ok) setLink(r.data as typeof link)
      else if (r) toast.error(r.error)
    })
  return (
    <section aria-label="Share a preview" className="rounded-xl border bg-subtle/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Share a preview of the draft</p>
          <p className="text-xs text-muted">Anyone with the link can view it — no sign-in.</p>
        </div>
        <fieldset className="m-0 flex rounded-lg border-0 bg-surface p-0.5 shadow-[inset_0_0_0_1px_var(--border)]">
          <legend className="sr-only">Link expires after</legend>
          {DAYS.map(([d, label]) => (
            <button
              key={d}
              type="button"
              aria-pressed={days === d}
              onClick={() => setDays(d)}
              className={cn(
                'h-8 rounded-md px-2.5 text-xs font-medium transition-colors',
                days === d ? 'bg-accent-soft text-accent' : 'text-muted hover:text-fg',
              )}
            >
              {label}
            </button>
          ))}
        </fieldset>
      </div>
      <Button size="sm" className="mt-3" pending={pending} onClick={create}>
        {!pending && <Link2 />} {link ? 'Create a new link' : 'Create link'}
      </Button>
      {link && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={spring}
          className="mt-4 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-center"
        >
          <div className="min-w-0 space-y-2">
            <label className="block">
              <span className="sr-only">Preview link</span>
              <input
                readOnly
                value={link.url}
                onFocus={(e) => e.currentTarget.select()}
                className="h-10 w-full truncate rounded-lg border bg-surface px-3 font-mono text-xs"
              />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <CopyButton value={link.url} label="Copy link" />
              <span className="text-xs text-muted">
                Expires {when.format(new Date(link.expiresAt))} (Dubai)
              </span>
            </div>
          </div>
          <div
            role="img"
            aria-label="QR code for the preview link"
            className="mx-auto size-32 rounded-lg border bg-white p-1.5 [&_svg]:size-full"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: SVG generated server-side by the qrcode library
            dangerouslySetInnerHTML={{ __html: link.qr }}
          />
        </motion.div>
      )}
    </section>
  )
}

function VersionRow({
  version,
  current,
  draftKept,
  dirty,
  api,
  onChanged,
  onRestored,
}: {
  version: VersionItem
  current: boolean
  /** The newest version is a saved draft: restoring keeps it in the history. */
  draftKept: boolean
  dirty: boolean
  api: Api
  onChanged: () => void
  onRestored: (data: Record<string, unknown>) => void
}) {
  const [mode, setMode] = useState<'view' | 'name' | 'restore'>('view')
  const [label, setLabel] = useState(version.label ?? '')
  const [pending, start] = useTransition()
  const saveLabel = () =>
    start(async () => {
      const r = await api.label(version.id, label)
      if (r?.ok) {
        toast.success(r.message ?? 'Saved')
        setMode('view')
        onChanged()
      } else if (r) toast.error(r.fieldErrors?.label ?? r.error)
    })
  const restore = () =>
    start(async () => {
      const r = await api.restore(version.id)
      if (r?.ok) {
        onRestored(r.data?.data as Record<string, unknown>)
        toast.success(r.message ?? 'Restored')
      } else if (r) toast.error(r.error)
    })
  const title = version.label || (version.status === 'published' ? 'Published version' : 'Draft')
  return (
    <li className="px-3.5 py-3">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'mt-1.5 size-2 shrink-0 rounded-full',
            version.status === 'published' ? 'bg-success' : 'bg-muted/60',
          )}
        />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
            <span className={cn('truncate', !version.label && 'text-muted')}>{title}</span>
            <Badge tone={version.status === 'published' ? 'success' : 'neutral'}>
              {version.status === 'published' ? 'Published' : 'Draft'}
            </Badge>
            {current && <Badge tone="accent">Current</Badge>}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {when.format(new Date(version.createdAt))}
            {version.author ? ` · ${version.author}` : ''}
          </p>
        </div>
        {mode === 'view' && (
          <div className="flex shrink-0 gap-1">
            <Button
              size="icon"
              variant="ghost"
              className="size-9"
              aria-label={`Name version from ${when.format(new Date(version.createdAt))}`}
              title="Name this version"
              onClick={() => setMode('name')}
            >
              <PenLine />
            </Button>
            {!current && (
              <Button size="sm" variant="secondary" onClick={() => setMode('restore')}>
                <RotateCcw /> Restore
              </Button>
            )}
          </div>
        )}
      </div>
      {mode === 'name' && (
        <form
          className="mt-2.5 flex items-center gap-1.5 ps-5"
          onSubmit={(e) => {
            e.preventDefault()
            saveLabel()
          }}
        >
          <input
            aria-label="Version name"
            // biome-ignore lint/a11y/noAutofocus: inline naming
            autoFocus
            value={label}
            maxLength={60}
            placeholder="e.g. Before Ramadan"
            onChange={(e) => setLabel(e.target.value)}
            className="h-9 min-w-0 flex-1 rounded-lg border bg-surface px-2.5 text-sm focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
          />
          <Button
            type="submit"
            size="icon"
            className="size-9"
            aria-label="Save version name"
            pending={pending}
          >
            {!pending && <Check />}
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-9"
            aria-label="Cancel"
            onClick={() => setMode('view')}
          >
            <X />
          </Button>
        </form>
      )}
      {mode === 'restore' && (
        <div className="mt-2.5 ms-5 rounded-lg bg-subtle px-3 py-2.5 text-xs">
          <p className="text-muted">
            This becomes your new draft{dirty ? ' and replaces your unsaved changes' : ''}.
            {draftKept ? ' Your current saved draft stays in this list.' : ''} The live page doesn’t change
            until you publish.
          </p>
          <div className="mt-2 flex gap-1.5">
            <Button size="sm" pending={pending} onClick={restore}>
              Restore as draft
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMode('view')}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </li>
  )
}
