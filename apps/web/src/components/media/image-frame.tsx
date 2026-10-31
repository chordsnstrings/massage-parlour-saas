'use client'
import {
  type ImageFrame,
  type ImageProp,
  normalizeImage,
  toImageProp,
  ZOOM_MAX,
} from '@spa/services/site-kit'
import { RotateCcw } from 'lucide-react'
import { useRef, useState } from 'react'
import { DEVICES } from '@/components/site/fields'
import type { Device } from '@/components/site/types'
import { useT } from '@/i18n/client'
import { cn } from '@/lib/utils'
import { sized } from './types'

const clamp = (n: number) => Math.round(Math.min(100, Math.max(0, n)))

/**
 * Framing for a site-builder photo: focal point (drag/click the dot, or arrow keys; Shift = 10 %), Fill/Fit and
 * zoom; one frame for every device unless a tablet/desktop tab sets its own. Changes apply to the canvas as they happen.
 */
export function ImageFrameControl({
  value,
  onChange,
  readOnly,
}: {
  value: ImageProp
  onChange: (v: ImageProp) => void
  readOnly?: boolean
}) {
  const t = useT()
  // Starts on the base (all devices) frame: md/lg overrides are opt-in from the tabs.
  const [device, setDevice] = useState<Device>('base')
  const { src, frames } = normalizeImage(value)
  const eff: ImageFrame =
    device === 'lg'
      ? (frames.lg ?? frames.md ?? frames.base)
      : device === 'md'
        ? (frames.md ?? frames.base)
        : frames.base
  const own = device === 'base' || !!frames[device]
  const framed = typeof value === 'object' && !!value?.frame
  const set = (patch: Partial<ImageFrame>) => {
    if (readOnly) return
    const next = { ...eff, ...patch }
    if (next.x === eff.x && next.y === eff.y && next.fit === eff.fit && next.zoom === eff.zoom) return
    onChange(toImageProp(src, { ...frames, [device]: next }))
  }
  const reset = () => {
    if (device === 'base') onChange(src)
    else onChange(toImageProp(src, { ...frames, [device]: undefined }))
  }

  const pad = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const pointAt = (e: React.PointerEvent) => {
    const r = pad.current?.getBoundingClientRect()
    if (!r?.width || !r.height) return
    set({
      x: clamp(((e.clientX - r.left) / r.width) * 100),
      y: clamp(((e.clientY - r.top) / r.height) * 100),
    })
  }
  const onKey = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 1
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }
    const d = moves[e.key]
    if (!d) return
    e.preventDefault()
    set({ x: clamp(eff.x + d[0]), y: clamp(eff.y + d[1]) })
  }

  return (
    <div className="space-y-2 rounded-lg border bg-subtle/40 p-2" data-testid="image-frame">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-muted">{t('ui.media.frame')}</span>
        <div className="flex items-center gap-0.5 rounded-md bg-subtle p-0.5" role="tablist">
          {DEVICES.map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={device === key}
              title={label}
              onClick={() => setDevice(key)}
              className={cn(
                'relative grid h-6 w-8 place-items-center rounded text-muted transition-colors',
                device === key && 'bg-surface text-fg shadow-[0_1px_2px_rgb(0_0_0/0.06)]',
              )}
            >
              <Icon className="size-3" strokeWidth={1.5} />
              <span className="sr-only">{label}</span>
              {key !== 'base' && frames[key] && (
                <span className="absolute top-0.5 end-1 size-1 rounded-full bg-accent" />
              )}
            </button>
          ))}
        </div>
      </div>
      {/* Physical (LTR) coordinates on purpose: the focal point is a position in the photo, never mirrored. */}
      <div dir="ltr" className="grid place-items-center">
        <div
          ref={pad}
          className={cn('relative w-fit max-w-full touch-none select-none', !readOnly && 'cursor-crosshair')}
          onPointerDown={(e) => {
            if (readOnly) return
            dragging.current = true
            e.currentTarget.setPointerCapture(e.pointerId)
            pointAt(e)
          }}
          onPointerMove={(e) => {
            if (dragging.current) pointAt(e)
          }}
          onPointerUp={() => {
            dragging.current = false
          }}
          onPointerCancel={() => {
            dragging.current = false
          }}
        >
          {/* biome-ignore lint/performance/noImgElement: editor preview of a tenant image */}
          <img src={sized(src, 480)} alt="" draggable={false} className="block max-h-44 max-w-full rounded" />
          <div
            role="slider"
            tabIndex={readOnly ? -1 : 0}
            aria-label={t('ui.media.focalPoint')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={eff.x}
            aria-valuetext={`${eff.x}% ${eff.y}%`}
            data-testid="focal-dot"
            onKeyDown={onKey}
            style={{ left: `${eff.x}%`, top: `${eff.y}%` }}
            className="absolute size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-accent/80 shadow-[0_0_0_1px_rgb(0_0_0/0.35),0_2px_6px_rgb(0_0_0/0.3)] outline-none focus-visible:ring-4 focus-visible:ring-accent/40"
          />
        </div>
      </div>
      <p className="text-[11px] text-muted">{t('ui.media.focalHint')}</p>
      <div className="flex items-center gap-2">
        <div className="flex gap-1">
          {(['cover', 'contain'] as const).map((fit) => (
            <button
              key={fit}
              type="button"
              disabled={readOnly}
              aria-pressed={eff.fit === fit}
              onClick={() => set({ fit })}
              className={cn(
                'min-h-8 rounded-md border px-2.5 text-xs transition-colors',
                eff.fit === fit
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'text-muted hover:border-fg/25',
              )}
            >
              {fit === 'cover' ? t('ui.media.fill') : t('ui.media.fit')}
            </button>
          ))}
        </div>
        <label className="flex min-w-0 flex-1 items-center gap-2 text-[11px] text-muted">
          {t('ui.media.zoom')}
          <input
            type="range"
            min={1}
            max={ZOOM_MAX}
            step={0.05}
            value={eff.zoom}
            disabled={readOnly}
            onChange={(e) => set({ zoom: Number(e.target.value) })}
            className="min-w-0 flex-1 accent-[var(--color-accent,currentColor)]"
          />
          <span className="w-8 text-end tabular-nums">{eff.zoom.toFixed(2).replace(/0$/, '')}×</span>
        </label>
      </div>
      <div className="flex items-center justify-between text-[11px] text-muted">
        <span>
          {device === 'base' ? '' : own ? t('ui.media.frameOverridden') : t('ui.media.frameInherits')}
        </span>
        {!readOnly && (device === 'base' ? framed : own) && (
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
          >
            <RotateCcw className="size-3" /> {t('ui.media.resetFrame')}
          </button>
        )}
      </div>
    </div>
  )
}
