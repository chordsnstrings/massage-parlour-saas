'use client'
// F15 Video block field: a YouTube / Vimeo link, or an MP4/WebM clip uploaded to the spa's library
// (POST /files/upload?kind=video). The value is the link or the '/files/{id}' path (parseVideoUrl reads both).
import { parseVideoUrl } from '@spa/core'
import { Loader2, Upload, X } from 'lucide-react'
import { useParams } from 'next/navigation'
import { useId, useRef, useState } from 'react'
import { useT } from '@/i18n/client'
import { cn } from '@/lib/utils'

type Props = {
  field: { label?: string }
  id: string
  value: string | undefined
  onChange: (value: string) => void
  readOnly?: boolean
}

/** Same cap as services createVideoAsset (stored files are ≤ 8 MB). */
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024

const control =
  'w-full rounded-lg border bg-surface px-3 py-2 text-sm text-fg placeholder:text-muted/70 focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15'

export function VideoFieldControl({ field, id, value, onChange, readOnly }: Props) {
  const t = useT()
  // Spa dashboard routes name the spa `tenant`; the console Website Studio editor (R23) names it `slug`.
  const params = useParams<{ tenant?: string; slug?: string }>()
  const slug = (typeof params?.tenant === 'string' ? params.tenant : params?.slug) || null
  const input = useRef<HTMLInputElement>(null)
  const hint = useId()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const v = value ?? ''
  const parsed = parseVideoUrl(v)

  async function upload(file: File) {
    if (!slug) return
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(t('ui.media.tooLarge', { size: Math.round(MAX_UPLOAD_BYTES / 1024 / 1024) }))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const body = new FormData()
      body.set('file', file)
      const res = await fetch(`/files/upload?tenant=${encodeURIComponent(slug)}&kind=video`, {
        method: 'POST',
        body,
      })
      const json = (await res.json().catch(() => null)) as
        | { ok: true; asset: { url: string } }
        | { ok: false; error: string }
        | null
      if (json?.ok) onChange(json.asset.url)
      else setError(json?.error ?? t('ui.media.uploadFailed'))
    } catch {
      setError(t('ui.media.networkError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium">
        {field.label}
      </label>
      <input
        id={id}
        className={control}
        value={v}
        readOnly={readOnly}
        placeholder="https://youtu.be/… · https://vimeo.com/…"
        aria-describedby={hint}
        aria-invalid={v && !parsed ? true : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      <p id={hint} className={cn('text-xs', v && !parsed ? 'text-red-600' : 'text-muted')}>
        {v && !parsed
          ? 'Paste a YouTube or Vimeo link, or upload a video.'
          : parsed
            ? parsed.provider === 'file'
              ? 'Uploaded video'
              : parsed.provider === 'youtube'
                ? 'YouTube (privacy-enhanced, loads on play)'
                : 'Vimeo (loads on play)'
            : t('ui.media.videoFormats', { size: Math.round(MAX_UPLOAD_BYTES / 1024 / 1024) })}
      </p>
      {!readOnly && slug && (
        <div className="flex flex-wrap gap-2">
          <input
            ref={input}
            type="file"
            accept="video/mp4,video/webm"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void upload(f)
            }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => input.current?.click()}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-3 text-sm hover:bg-subtle disabled:opacity-60"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            {busy ? t('ui.media.uploadingVideo') : t('ui.media.uploadVideo')}
          </button>
          {v && (
            <button
              type="button"
              onClick={() => onChange('')}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-sm text-muted hover:bg-subtle"
            >
              <X className="size-4" /> {t('ui.media.removeVideo')}
            </button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}
