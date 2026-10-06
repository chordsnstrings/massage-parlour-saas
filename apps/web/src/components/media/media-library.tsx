'use client'
import { ImageIcon, Search, Sparkles, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Stagger, StaggerItem } from '@/components/ui/motion'
import { EmptyState } from '@/components/ui/page'
import { ease, spring } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { AssetSheet } from './asset-sheet'
import { isStored, type MediaItem, sized } from './types'
import { Dropzone, UploadList, useUploads } from './uploads'

type Filter = { source?: 'upload' | 'ai'; tag?: string; q?: string }

const SOURCES = [
  { key: undefined, label: 'All' },
  { key: 'upload', label: 'Uploads' },
  { key: 'ai', label: 'AI images' },
] as const

/** The /media page body: drop zone + progress, filters, masonry grid and the details sheet. */
export function MediaLibrary({
  slug,
  base,
  origin,
  items,
  tags,
  filter,
  moreHref,
}: {
  slug: string
  base: string
  origin: string
  items: MediaItem[]
  tags: string[]
  filter: Filter
  moreHref: string | null
}) {
  const router = useRouter()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = items.find((i) => i.id === selectedId) ?? null
  const { uploads, add, dismiss } = useUploads(slug, { onDrained: () => router.refresh() })
  const [dragging, setDragging] = useState(false)
  const depth = useRef(0)

  // Files dragged anywhere over the page → full-window drop overlay.
  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth.current++
      setDragging(true)
    }
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setDragging(false)
    }
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault()
    }
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth.current = 0
      setDragging(false)
      if (e.defaultPrevented) return // dropped on the Dropzone, which already queued the files
      e.preventDefault()
      if (e.dataTransfer?.files.length) add(e.dataTransfer.files)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [add])

  const href = (next: Filter) => {
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries(next)) if (v) p.set(k, v)
    const qs = p.toString()
    return qs ? `${base}?${qs}` : base
  }
  const [q, setQ] = useState(filter.q ?? '')
  const filtered = Boolean(filter.source || filter.tag || filter.q)

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="space-y-3">
        <Dropzone compact onFiles={add} />
        {uploads.length > 0 && <UploadList uploads={uploads} onDismiss={dismiss} />}
      </div>

      <div className="space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <nav aria-label="Image source" className="flex w-full rounded-lg bg-subtle p-0.5 md:w-auto">
            {SOURCES.map((s) => {
              const active = filter.source === s.key
              return (
                <Link
                  key={s.label}
                  href={href({ ...filter, source: s.key })}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'relative grid min-h-10 flex-1 place-items-center rounded-md px-4 text-[13px] font-medium transition-colors md:flex-none',
                    active ? 'text-fg' : 'text-muted hover:text-fg',
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="media-source"
                      transition={spring}
                      className="absolute inset-0 rounded-md bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.08)]"
                    />
                  )}
                  <span className="relative">{s.label}</span>
                </Link>
              )
            })}
          </nav>
          <form
            className="relative w-full md:max-w-xs"
            onSubmit={(e) => {
              e.preventDefault()
              router.push(href({ ...filter, q: q.trim() || undefined }))
            }}
          >
            <Search
              className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted"
              strokeWidth={1.5}
            />
            <Input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, alt text or tag"
              aria-label="Search images"
              className="h-11 ps-9 md:h-10"
            />
          </form>
        </div>

        {tags.length > 0 && (
          <nav className="flex flex-wrap items-center gap-1.5" aria-label="Tags">
            {tags.map((t) => {
              const on = filter.tag === t
              return (
                <Link
                  key={t}
                  href={href({ ...filter, tag: on ? undefined : t })}
                  aria-pressed={on}
                  className={cn(
                    'inline-flex min-h-9 items-center gap-1 rounded-full border px-3 text-xs font-medium transition-colors',
                    on
                      ? 'border-accent bg-accent-soft text-accent'
                      : 'text-muted hover:border-fg/25 hover:text-fg',
                  )}
                >
                  #{t}
                  {on && <X className="size-3" />}
                </Link>
              )
            })}
          </nav>
        )}
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border bg-surface">
          <EmptyState
            icon={
              filtered ? (
                <Search className="size-5" strokeWidth={1.5} />
              ) : (
                <ImageIcon className="size-5" strokeWidth={1.5} />
              )
            }
            title={filtered ? 'No images match' : 'Your library is empty'}
            description={
              filtered
                ? 'Try another filter or search.'
                : 'Upload photos of your rooms, team and treatments — they’re optimised automatically and ready for your website.'
            }
            action={
              filtered ? (
                <Link href={base} className="text-sm font-medium text-accent hover:underline">
                  Clear filters
                </Link>
              ) : undefined
            }
          />
        </div>
      ) : (
        <Stagger className="columns-2 gap-3 sm:columns-3 sm:gap-4 lg:columns-4 2xl:columns-5">
          {items.map((item) => (
            <StaggerItem key={item.id} className="mb-3 break-inside-avoid sm:mb-4">
              <Tile item={item} onOpen={() => setSelectedId(item.id)} />
            </StaggerItem>
          ))}
        </Stagger>
      )}

      {moreHref && (
        <div className="flex justify-center">
          <Link
            href={moreHref}
            scroll={false}
            className="inline-flex min-h-11 items-center rounded-lg border bg-surface px-5 text-sm font-medium transition-colors hover:bg-subtle"
          >
            Show more
          </Link>
        </div>
      )}

      <AssetSheet
        slug={slug}
        item={selected}
        origin={origin}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null)
        }}
      />

      <AnimatePresence>
        {dragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15, ease }}
            className="pointer-events-none fixed inset-0 z-[60] grid place-items-center bg-accent/10 p-6 backdrop-blur-[2px]"
          >
            <div className="rounded-2xl border-2 border-dashed border-accent bg-surface/95 px-10 py-8 text-center shadow-pop">
              <p className="text-base font-semibold">Drop to upload</p>
              <p className="text-sm text-muted">Images are added to your library</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function Tile({ item, onOpen }: { item: MediaItem; onOpen: () => void }) {
  const ratio = item.width && item.height ? `${item.width} / ${item.height}` : '4 / 3'
  const name = item.alt.en || item.filename || (item.source === 'ai' ? 'AI image' : 'Image')
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Edit ${name}`}
      className="group relative block w-full overflow-hidden rounded-xl border bg-subtle text-start transition-shadow hover:shadow-pop focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/25"
      style={{ aspectRatio: ratio }}
    >
      {/* biome-ignore lint/performance/noImgElement: thumbnails come from /files?w=480 already sized */}
      <img
        src={sized(item.url, 480)}
        alt={item.alt.en ?? ''}
        loading="lazy"
        decoding="async"
        className="size-full object-cover transition-transform duration-500 ease-[var(--ease-calm)] motion-safe:group-hover:scale-[1.03]"
      />
      <span className="absolute top-2 start-2 flex flex-wrap gap-1">
        {item.source === 'ai' && (
          <span className="inline-flex items-center gap-1 rounded-full bg-surface/90 px-2 py-0.5 text-[11px] font-medium text-accent backdrop-blur">
            <Sparkles className="size-3" /> AI
          </span>
        )}
        {!item.alt.en && (
          <span className="rounded-full bg-surface/90 px-2 py-0.5 text-[11px] font-medium text-warning backdrop-blur">
            No alt text
          </span>
        )}
        {!isStored(item.url) && (
          <span className="rounded-full bg-surface/90 px-2 py-0.5 text-[11px] font-medium text-danger backdrop-blur">
            Temporary
          </span>
        )}
      </span>
      <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-3 pt-10 pb-2.5 text-xs text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
        <span className="block truncate font-medium">{item.filename ?? name}</span>
        {item.width && item.height && (
          <span className="block opacity-80">
            {item.width} × {item.height}
          </span>
        )}
      </span>
    </button>
  )
}
