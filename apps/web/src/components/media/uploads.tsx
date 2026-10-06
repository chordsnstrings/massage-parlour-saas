'use client'
import { CheckCircle2, CircleAlert, ImageUp, Loader2, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ease } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { ACCEPT, formatBytes, MAX_UPLOAD_MB, type MediaItem } from './types'

export type Upload = {
  key: string
  name: string
  size: number
  progress: number
  status: 'queued' | 'uploading' | 'done' | 'error'
  error?: string
  asset?: MediaItem
}

const OK_TYPES = new Set(ACCEPT.split(','))
const CONCURRENCY = 2

/** One file → POST /files/upload with progress (fetch can't report upload progress; XHR can). */
function send(slug: string, file: File, onProgress: (p: number) => void) {
  return new Promise<MediaItem>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    // The tenant goes in the query so the server checks access before reading the body.
    xhr.open('POST', `/files/upload?tenant=${encodeURIComponent(slug)}`)
    xhr.responseType = 'json'
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.min(0.97, e.loaded / e.total))
    }
    xhr.onload = () => {
      const body = xhr.response as { ok?: boolean; error?: string; asset?: MediaItem } | null
      if (xhr.status === 200 && body?.ok && body.asset) resolve(body.asset)
      else reject(new Error(body?.error ?? 'Upload failed — please try again.'))
    }
    xhr.onerror = () => reject(new Error('Network error — check your connection.'))
    const fd = new FormData()
    fd.set('file', file)
    xhr.send(fd)
  })
}

/** Upload queue (2 at a time) with per-file progress; images are validated client-side first for quick feedback. */
export function useUploads(
  slug: string,
  opts: { onUploaded?: (asset: MediaItem) => void; onDrained?: () => void } = {},
) {
  const [uploads, setUploads] = useState<Upload[]>([])
  const queue = useRef<{ key: string; file: File }[]>([])
  const active = useRef(0)
  const handlers = useRef(opts)
  useEffect(() => {
    handlers.current = opts
  })

  const patch = useCallback((key: string, p: Partial<Upload>) => {
    setUploads((list) => list.map((u) => (u.key === key ? { ...u, ...p } : u)))
  }, [])

  const pump = useCallback(() => {
    while (active.current < CONCURRENCY && queue.current.length > 0) {
      const job = queue.current.shift()!
      active.current++
      patch(job.key, { status: 'uploading' })
      send(slug, job.file, (progress) => patch(job.key, { progress }))
        .then((asset) => {
          patch(job.key, { status: 'done', progress: 1, asset })
          handlers.current.onUploaded?.(asset)
        })
        .catch((e: Error) => patch(job.key, { status: 'error', error: e.message }))
        .finally(() => {
          active.current--
          if (active.current === 0 && queue.current.length === 0) handlers.current.onDrained?.()
          pump()
        })
    }
  }, [slug, patch])

  const add = useCallback(
    (files: FileList | File[]) => {
      const next: Upload[] = []
      for (const file of Array.from(files)) {
        const key = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
        const base = { key, name: file.name, size: file.size, progress: 0 }
        // An empty type (unknown to the OS) still goes up — the server sniffs the real format.
        if (file.type && !OK_TYPES.has(file.type)) {
          const error = file.type === 'image/svg+xml' ? 'SVG isn’t supported' : 'Not a supported image'
          next.push({ ...base, status: 'error', error })
        } else if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
          next.push({ ...base, status: 'error', error: `Larger than ${MAX_UPLOAD_MB} MB` })
        } else {
          next.push({ ...base, status: 'queued' })
          queue.current.push({ key, file })
        }
      }
      setUploads((list) => [...list.filter((u) => u.status !== 'done'), ...next].slice(-24))
      pump()
    },
    [pump],
  )

  const dismiss = useCallback((key: string) => {
    setUploads((list) => list.filter((u) => u.key !== key || u.status === 'uploading'))
  }, [])

  const busy = uploads.some((u) => u.status === 'queued' || u.status === 'uploading')
  return { uploads, add, dismiss, busy }
}

/** Drop target + file chooser. */
export function Dropzone({
  onFiles,
  compact,
  className,
}: {
  onFiles: (files: FileList) => void
  compact?: boolean
  className?: string
}) {
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  return (
    <section
      aria-label="Drop zone"
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false)
      }}
      onDrop={(e) => {
        e.preventDefault() // the page-level drop handler skips events that were already handled here
        setOver(false)
        if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files)
      }}
      className={cn(
        'flex rounded-xl border border-dashed transition-[border-color,background-color] duration-200',
        compact
          ? 'flex-col items-center gap-3 px-5 py-5 text-center sm:flex-row sm:text-start'
          : 'flex-col items-center gap-4 px-6 py-12 text-center',
        over ? 'border-accent bg-accent-soft/60' : 'bg-surface hover:border-fg/25',
        className,
      )}
    >
      <motion.div
        animate={{ y: over ? -3 : 0, scale: over ? 1.06 : 1 }}
        transition={{ duration: 0.2, ease }}
        className={cn(
          'grid shrink-0 place-items-center rounded-full',
          compact ? 'size-10' : 'size-12',
          over ? 'bg-accent text-accent-fg' : 'bg-subtle text-muted',
        )}
      >
        <ImageUp className="size-5" strokeWidth={1.5} />
      </motion.div>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-[15px] font-medium">{over ? 'Drop to upload' : 'Drop images here'}</p>
        <p className="text-sm text-muted">
          JPG, PNG, WebP, AVIF or GIF up to {MAX_UPLOAD_MB} MB — resized and optimised for the web
          automatically.
        </p>
      </div>
      <Button
        type="button"
        variant="secondary"
        className="min-h-11 sm:min-h-10"
        onClick={() => input.current?.click()}
      >
        Choose files
      </Button>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        multiple
        tabIndex={-1}
        className="sr-only"
        aria-label="Upload images"
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files)
          e.target.value = ''
        }}
      />
    </section>
  )
}

/** Per-file progress rows. */
export function UploadList({ uploads, onDismiss }: { uploads: Upload[]; onDismiss: (key: string) => void }) {
  return (
    <ul className="space-y-2" aria-label="Uploads">
      <AnimatePresence initial={false}>
        {uploads.map((u) => (
          <motion.li
            key={u.key}
            layout
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0, marginTop: 0 }}
            transition={{ duration: 0.2, ease }}
            className="overflow-hidden rounded-lg border bg-surface"
          >
            <div className="flex items-center gap-3 px-3.5 py-2.5">
              <span className="grid size-6 shrink-0 place-items-center">
                {u.status === 'done' ? (
                  <CheckCircle2 className="size-4 text-success" strokeWidth={1.75} />
                ) : u.status === 'error' ? (
                  <CircleAlert className="size-4 text-danger" strokeWidth={1.75} />
                ) : (
                  <Loader2 className="size-4 animate-spin text-muted" strokeWidth={1.75} />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{u.name}</p>
                <p className={cn('text-xs', u.status === 'error' ? 'text-danger' : 'text-muted')}>
                  {u.status === 'error'
                    ? u.error
                    : u.status === 'done'
                      ? `Uploaded · ${formatBytes(u.asset?.bytes)} WebP`
                      : u.status === 'queued'
                        ? 'Waiting…'
                        : u.progress >= 0.97
                          ? 'Optimising…'
                          : `${Math.round(u.progress * 100)}% of ${formatBytes(u.size)}`}
                </p>
              </div>
              {u.status !== 'uploading' && u.status !== 'queued' && (
                <button
                  type="button"
                  onClick={() => onDismiss(u.key)}
                  className="grid size-9 place-items-center rounded-md text-muted transition-colors hover:bg-subtle hover:text-fg"
                  aria-label={`Dismiss ${u.name}`}
                >
                  <X className="size-4" strokeWidth={1.5} />
                </button>
              )}
            </div>
            <div className="h-0.5 bg-subtle">
              <motion.div
                className={cn('h-full', u.status === 'error' ? 'bg-transparent' : 'bg-accent')}
                initial={false}
                animate={{ width: `${Math.round(u.progress * 100)}%` }}
                transition={{ duration: 0.25, ease }}
              />
            </div>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  )
}
