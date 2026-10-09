'use client'
import { FieldLabel } from '@puckeditor/core'
import { type ImageProp, imageSrc } from '@spa/services/site-kit'
import { ImageIcon, Images, X } from 'lucide-react'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useT } from '@/i18n/client'
import { cn } from '@/lib/utils'
import { ImageFrameControl } from './image-frame'
import { MediaPicker } from './media-picker'
import { sized } from './types'

type Props = {
  field: { label?: string }
  id: string
  /** A URL, or `{ src, frame }` once framed (focal point / fit / zoom, see site-kit/image.ts). */
  value: ImageProp
  onChange: (value: ImageProp) => void
  readOnly?: boolean
}

const control =
  'w-full rounded-lg border bg-surface px-3 py-2 text-sm text-fg placeholder:text-muted/70 transition-[border-color,box-shadow] duration-150 focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15'

/** Same-site paths and http(s) links only (no javascript:/data: URLs in pages). */
const usable = (v: string) => v === '' || /^\/(?!\/)/.test(v) || /^https?:\/\/[^\s]+$/i.test(v)

/**
 * Puck field for every image prop (via imageField()): thumbnail preview, "Choose from library" (search +
 * inline upload), a paste-a-URL fallback and framing (focal point, Fill/Fit, zoom). A new image starts unframed. The library needs a tenant; elsewhere only the URL input shows.
 */
export function ImageFieldControl({ field, id, value: raw, onChange, readOnly }: Props) {
  const value = imageSrc(raw)
  const params = useParams<{ tenant?: string }>()
  const slug = typeof params?.tenant === 'string' ? params.tenant : null
  const t = useT()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  const [broken, setBroken] = useState(false)
  useEffect(() => {
    setDraft(value)
    setBroken(false)
  }, [value])
  const valid = usable(draft.trim())
  const commit = () => {
    const next = draft.trim()
    if (usable(next) && next !== value) onChange(next)
  }

  return (
    <FieldLabel label={field.label ?? ''} el="div" readOnly={readOnly}>
      <div className="space-y-2">
        <div className="relative aspect-[16/10] overflow-hidden rounded-lg border bg-subtle">
          {value && !broken ? (
            // biome-ignore lint/performance/noImgElement: editor preview of a tenant image
            <img
              src={sized(value, 480)}
              alt=""
              className="size-full object-cover"
              onError={() => setBroken(true)}
            />
          ) : (
            <div className="grid size-full place-items-center text-muted">
              <span className="flex flex-col items-center gap-1.5 text-xs">
                <ImageIcon className="size-5" strokeWidth={1.5} />
                {broken ? t('ui.media.cantLoad') : t('ui.media.noImage')}
              </span>
            </div>
          )}
          {value && !readOnly && (
            <button
              type="button"
              onClick={() => onChange('')}
              aria-label={t('ui.media.removeImage')}
              className="absolute top-1.5 end-1.5 grid size-8 place-items-center rounded-full bg-surface/90 text-muted shadow-[0_1px_2px_rgb(0_0_0/0.08)] backdrop-blur transition-colors hover:text-fg"
            >
              <X className="size-4" strokeWidth={1.5} />
            </button>
          )}
        </div>
        {value && !broken && <ImageFrameControl value={raw} onChange={onChange} readOnly={readOnly} />}
        {slug && !readOnly && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border bg-surface px-3 text-[13px] font-medium transition-colors hover:border-accent/60 hover:text-accent"
          >
            <Images className="size-4" strokeWidth={1.5} />
            {value ? t('ui.media.replaceFromLibrary') : t('ui.media.chooseFromLibrary')}
          </button>
        )}
        <input
          id={id}
          type="url"
          inputMode="url"
          value={draft}
          readOnly={readOnly}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            }
          }}
          placeholder={slug ? 'or paste an image URL' : 'https://…'}
          aria-label={t('ui.media.imageUrl', { label: field.label ?? t('ui.media.image') })}
          aria-invalid={!valid}
          className={cn(control, !valid && 'border-danger')}
        />
        {!valid && <p className="text-[11px] text-danger">Use an https:// link or a /files/… path.</p>}
      </div>
      {slug && (
        <MediaPicker
          slug={slug}
          open={open}
          onOpenChange={setOpen}
          onPick={(item) => {
            onChange(item.url)
            setOpen(false)
          }}
        />
      )}
    </FieldLabel>
  )
}
