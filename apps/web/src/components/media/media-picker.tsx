'use client'
import { ImageIcon, ImageUp, Search, Sparkles } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useRef, useState, useTransition } from 'react'
import { listMediaAction } from '@/app/dashboard/[tenant]/media/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/page'
import { Sheet } from '@/components/ui/sheet'
import { useT } from '@/i18n/client'
import { ease } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { ACCEPT, type MediaItem, sized } from './types'
import { UploadList, useUploads } from './uploads'

type Source = 'upload' | 'ai' | undefined

/** "Choose from library" dialog used by the website editor's image fields: search, filter, upload inline, pick. */
export function MediaPicker({
  slug,
  open,
  onOpenChange,
  onPick,
}: {
  slug: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (item: MediaItem) => void
}) {
  const t = useT()
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('ui.media.pickerTitle')}
      description={t('ui.media.pickerSub')}
      className="md:max-w-3xl"
    >
      {open && <PickerBody slug={slug} onPick={onPick} />}
    </Sheet>
  )
}

function PickerBody({ slug, onPick }: { slug: string; onPick: (item: MediaItem) => void }) {
  const t = useT()
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const [source, setSource] = useState<Source>(undefined)
  const [items, setItems] = useState<MediaItem[] | null>(null)
  const [more, setMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, start] = useTransition()
  const input = useRef<HTMLInputElement>(null)
  const { uploads, add, dismiss } = useUploads(slug, {
    onUploaded: (asset) => {
      setItems((list) => [asset, ...(list ?? []).filter((i) => i.id !== asset.id)])
    },
  })

  useEffect(() => {
    const timer = setTimeout(() => setQuery(q.trim()), 250)
    return () => clearTimeout(timer)
  }, [q])

  useEffect(() => {
    start(async () => {
      const res = await listMediaAction(slug, { q: query || undefined, source })
      if (!res.ok) {
        setError(res.error)
        return
      }
      setError(null)
      setItems(res.items)
      setMore(res.more)
    })
  }, [slug, query, source])

  const loadMore = () =>
    start(async () => {
      const res = await listMediaAction(slug, { q: query || undefined, source, offset: items?.length ?? 0 })
      if (res.ok) {
        setItems((list) => [...(list ?? []), ...res.items])
        setMore(res.more)
      }
    })

  return (
    <section
      aria-label={t('ui.media.library')}
      className="space-y-4"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        if (e.dataTransfer.files.length) add(e.dataTransfer.files)
      }}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted"
            strokeWidth={1.5}
          />
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('ui.media.search')}
            aria-label={t('ui.media.search')}
            className="h-11 ps-9 sm:h-10"
          />
        </div>
        <div className="flex gap-2">
          <fieldset className="m-0 flex flex-1 rounded-lg border-0 bg-subtle p-0.5 sm:flex-none">
            <legend className="sr-only">{t('ui.media.source')}</legend>
            {(
              [
                [undefined, t('ui.media.all')],
                ['upload', t('ui.media.uploads')],
                ['ai', t('ui.media.ai')],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key ?? 'all'}
                type="button"
                aria-pressed={source === key}
                onClick={() => setSource(key)}
                className={cn(
                  'min-h-10 flex-1 rounded-md px-3 text-[13px] font-medium transition-colors sm:flex-none',
                  source === key
                    ? 'bg-surface text-fg shadow-[0_1px_2px_rgb(0_0_0/0.08)]'
                    : 'text-muted hover:text-fg',
                )}
              >
                {label}
              </button>
            ))}
          </fieldset>
          <Button
            type="button"
            variant="secondary"
            className="min-h-11 sm:min-h-10"
            onClick={() => input.current?.click()}
          >
            <ImageUp /> {t('ui.media.upload')}
          </Button>
          <input
            ref={input}
            type="file"
            accept={ACCEPT}
            multiple
            tabIndex={-1}
            className="sr-only"
            aria-label={t('ui.media.uploadToLibrary')}
            onChange={(e) => {
              if (e.target.files?.length) add(e.target.files)
              e.target.value = ''
            }}
          />
        </div>
      </div>

      {uploads.length > 0 && <UploadList uploads={uploads} onDismiss={dismiss} />}
      {error && <p className="text-sm text-danger">{error}</p>}

      {items === null ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static skeletons
            <Skeleton key={i} className="aspect-square" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center">
          <div className="grid size-11 place-items-center rounded-full bg-subtle text-muted">
            <ImageIcon className="size-5" strokeWidth={1.5} />
          </div>
          <p className="text-sm text-muted">
            {query || source ? t('ui.media.noMatch') : t('ui.media.empty')}
          </p>
        </div>
      ) : (
        <ul
          className={cn(
            'grid max-h-[52dvh] grid-cols-3 gap-2 overflow-y-auto p-0.5 transition-opacity sm:grid-cols-4',
            loading && 'opacity-60',
          )}
        >
          {items.map((item, i) => (
            <motion.li
              key={item.id}
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.2, ease, delay: Math.min(i, 12) * 0.015 }}
            >
              <button
                type="button"
                onClick={() => onPick(item)}
                aria-label={t('ui.media.useNamed', {
                  name: item.alt.en || item.filename || t('ui.media.image'),
                })}
                className="group relative block aspect-square w-full overflow-hidden rounded-lg border bg-subtle focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/25"
              >
                {/* biome-ignore lint/performance/noImgElement: library thumbnails */}
                <img
                  src={sized(item.url, 480)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="size-full object-cover transition-transform duration-300 motion-safe:group-hover:scale-[1.04]"
                />
                {item.source === 'ai' && (
                  <span className="absolute top-1.5 start-1.5 grid size-6 place-items-center rounded-full bg-surface/90 text-accent">
                    <Sparkles className="size-3" />
                  </span>
                )}
                <span className="absolute inset-0 grid place-items-center bg-accent/0 text-xs font-medium text-white opacity-0 transition-[opacity,background-color] group-hover:bg-black/30 group-hover:opacity-100 group-focus-visible:bg-black/30 group-focus-visible:opacity-100">
                  {t('ui.media.useImage')}
                </span>
              </button>
            </motion.li>
          ))}
        </ul>
      )}
      {more && (
        <div className="flex justify-center">
          <Button type="button" variant="ghost" onClick={loadMore} pending={loading}>
            {t('ui.media.showMore')}
          </Button>
        </div>
      )}
    </section>
  )
}
