'use client'
import {
  decodeHtmlBytes,
  HTML_IMAGE_SRC_MAX,
  HTML_IMAGE_URL,
  type HtmlDesignImage,
  type HtmlImageAdjust,
  htmlDesignDocument,
  htmlImageFramed,
  listHtmlDesignImages,
} from '@spa/core'
import { ImageIcon, Monitor, RotateCcw, Smartphone } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { MediaPicker } from '@/components/media/media-picker'
import { HtmlDesignFrame } from '@/components/site/html-design-frame'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/form'
import { Checkbox, Input, Select } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { loadHtmlDesignAction } from './actions'
import { uploadTooLarge } from './upload-sheet'

type Spa = { slug: string; name: string }
type Adjusts = Record<string, HtmlImageAdjust>

const toMap = (list: HtmlImageAdjust[]) => Object.fromEntries(list.map((a) => [a.id, a]))
const clamp = (n: number) => Math.round(Math.min(100, Math.max(0, n)))

/**
 * "Upload HTML" file field: once a file is chosen it is read in the browser (never run here) and its images are
 * listed in the adjuster, whose choices travel with the upload in the hidden `images` field. R24: a file over 5 MB is
 * refused here at once (and again on submit), and the "Phone fixes" switch (off = exact) drives the preview too.
 */
export function HtmlFileField({ spas, hint }: { spas: Spa[]; hint: string }) {
  const [html, setHtml] = useState<string | null>(null)
  const [tooLarge, setTooLarge] = useState<string | null>(null)
  const [phoneFixes, setPhoneFixes] = useState(false)
  return (
    <>
      <Field label="HTML file" name="file" hint={hint}>
        <Input
          id="file"
          name="file"
          type="file"
          accept="text/html,.html,.htm"
          className="h-auto py-2.5"
          aria-invalid={tooLarge ? true : undefined}
          onChange={(e) => {
            const f = e.currentTarget.files?.[0]
            const big = uploadTooLarge('html', f)
            setTooLarge(big)
            if (!f || big) return setHtml(null)
            // Read like the browser and the upload route do (the file's own encoding), never blindly as UTF-8.
            f.arrayBuffer().then(
              (b) => setHtml(decodeHtmlBytes(new Uint8Array(b)).html),
              () => setHtml(null),
            )
          }}
        />
        {tooLarge && (
          <p role="alert" className="text-[13px] text-danger" data-testid="html-file-too-large">
            {tooLarge}
          </p>
        )}
      </Field>
      <label className="flex items-start gap-3 rounded-xl border p-4 text-sm">
        <Checkbox
          name="phoneFixes"
          className="mt-0.5"
          checked={phoneFixes}
          onChange={(e) => setPhoneFixes(e.currentTarget.checked)}
        />
        <span className="space-y-1">
          <span className="block font-medium">Phone fixes</span>
          <span className="block text-muted">
            Off = shown exactly like the file (recommended). On = the platform adds a phone viewport and keeps
            images and wide elements inside phone screens — this changes how the design looks.
          </span>
        </span>
      </label>
      {html !== null && (
        <HtmlImageAdjuster key={html.length} html={html} initial={[]} spas={spas} phoneFixes={phoneFixes} />
      )}
    </>
  )
}

/** The adjuster of a stored HTML template: its design (up to 5 MB) is loaded when the sheet opens. */
export function TemplateImageAdjuster({
  id,
  ...rest
}: { id: string } & Omit<React.ComponentProps<typeof HtmlImageAdjuster>, 'html'>) {
  const [state, setState] = useState<{ html: string } | { error: string } | null>(null)
  useEffect(() => {
    let live = true
    loadHtmlDesignAction(id).then(
      (r) => {
        if (live) setState(r)
      },
      () => {
        if (live) setState({ error: 'Could not load the design. Try again.' })
      },
    )
    return () => {
      live = false
    }
  }, [id])
  // Until it is shown, saving keeps the adjustments as they are.
  const keep = <input type="hidden" name="images" value={JSON.stringify(rest.initial)} />
  if (!state) return <p className="text-[13px] text-muted">{keep}Loading the design…</p>
  if ('error' in state)
    return (
      <p role="alert" className="text-[13px] text-danger">
        {keep}
        {state.error}
      </p>
    )
  return <HtmlImageAdjuster html={state.html} {...rest} />
}

/** Lists every image of a design with focal point, Fill / Fit and replace; previews the result at 360 / 1280. */
export function HtmlImageAdjuster({
  html,
  initial,
  spas,
  phoneFixes,
}: {
  html: string
  initial: HtmlImageAdjust[]
  spas: Spa[]
  /** The design's "Phone fixes" switch (the preview shows what spa sites will show). */
  phoneFixes: boolean
}) {
  const images = useMemo(() => listHtmlDesignImages(html), [html])
  const [adjust, setAdjust] = useState<Adjusts>(() => toMap(initial))
  const [spa, setSpa] = useState(spas[0]?.slug ?? '')
  const [width, setWidth] = useState<360 | 1280>(360)
  const list = useMemo(() => images.flatMap((i) => (adjust[i.id] ? [adjust[i.id]!] : [])), [images, adjust])

  const update = (img: HtmlDesignImage, patch: Partial<HtmlImageAdjust> | null) =>
    setAdjust((all) => {
      const next = { ...all }
      if (patch === null) delete next[img.id]
      else
        next[img.id] = {
          ...(all[img.id] ?? { id: img.id, src: img.src.slice(0, HTML_IMAGE_SRC_MAX) }),
          ...patch,
        }
      return next
    })

  return (
    <section className="space-y-4 rounded-xl border p-4" aria-label="Adjust images">
      <input type="hidden" name="images" value={JSON.stringify(list)} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Adjust images ({images.length})</p>
          <p className="text-[13px] text-muted">
            {phoneFixes ? 'Phone fixes keep images inside the screen. ' : ''}Drag the dot to choose what stays
            in view when an image is cropped.
          </p>
        </div>
        {spas.length > 0 && images.length > 0 && (
          <label className="flex items-center gap-2 text-[13px] text-muted">
            Library of
            <Select value={spa} onChange={(e) => setSpa(e.currentTarget.value)} className="h-9 w-auto">
              {spas.map((s) => (
                <option key={s.slug} value={s.slug}>
                  {s.name}
                </option>
              ))}
            </Select>
          </label>
        )}
      </div>
      {images.length === 0 ? (
        <p className="text-[13px] text-muted">No images found in this file.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {images.map((img, i) => (
            <ImageCard
              key={img.id}
              index={i + 1}
              image={img}
              value={adjust[img.id]}
              spa={spa}
              onChange={(p) => update(img, p)}
            />
          ))}
        </ul>
      )}
      <Preview html={html} adjust={list} width={width} onWidth={setWidth} phoneFixes={phoneFixes} />
    </section>
  )
}

function ImageCard({
  index,
  image,
  value,
  spa,
  onChange,
}: {
  index: number
  image: HtmlDesignImage
  value: HtmlImageAdjust | undefined
  spa: string
  onChange: (patch: Partial<HtmlImageAdjust> | null) => void
}) {
  const [picker, setPicker] = useState(false)
  const [url, setUrl] = useState(value?.replace ?? '')
  const x = value?.x ?? 50
  const y = value?.y ?? 50
  // R28 P4: a replace-only entry is not framed (no forced fill); the buttons show what the render does.
  const fit = value?.fit ?? (value && htmlImageFramed(value) ? 'cover' : undefined)
  const shown = value?.replace ?? image.src
  const box = useRef<HTMLDivElement>(null)
  const label = `Image ${index}`

  const place = (e: React.PointerEvent) => {
    const r = box.current?.getBoundingClientRect()
    if (!r?.width || !r.height) return
    onChange({
      x: clamp(((e.clientX - r.left) / r.width) * 100),
      y: clamp(((e.clientY - r.top) / r.height) * 100),
    })
  }
  const urlOk = !url || HTML_IMAGE_URL.test(url)

  return (
    <li className="space-y-2.5 rounded-lg border p-3" data-testid={`html-image-${image.id}`}>
      <p className="flex items-center gap-2 text-[13px]">
        <span className="font-medium">{label}</span>
        <span className="text-muted">{image.kind === 'bg' ? 'background' : 'image'}</span>
        <span
          className="min-w-0 flex-1 truncate text-muted"
          title={image.src.startsWith('data:') ? undefined : image.src}
        >
          {image.src.startsWith('data:') ? 'embedded' : image.src}
        </span>
      </p>
      <div className="flex justify-center rounded-md bg-subtle p-2">
        {/* Thumbnail sized to the image so the dot's position is the focal point in image coordinates. */}
        <div
          ref={box}
          className="relative inline-block touch-none cursor-crosshair select-none"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            place(e)
          }}
          onPointerMove={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) place(e)
          }}
        >
          {shown ? (
            // biome-ignore lint/performance/noImgElement: arbitrary design image, not a Next asset
            <img src={shown} alt="" draggable={false} className="block max-h-36 max-w-full" />
          ) : (
            <span className="flex size-24 items-center justify-center text-muted">
              <ImageIcon className="size-5" />
            </span>
          )}
          <button
            type="button"
            aria-label={`${label} focal point: ${x}% across, ${y}% down (arrow keys move it)`}
            data-testid="focal-dot"
            className="absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-accent shadow ring-1 ring-black/30"
            style={{ left: `${x}%`, top: `${y}%` }}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 10 : 2
              const d = {
                ArrowLeft: [-step, 0],
                ArrowRight: [step, 0],
                ArrowUp: [0, -step],
                ArrowDown: [0, step],
              }[e.key]
              if (!d) return
              e.preventDefault()
              onChange({ x: clamp(x + d[0]!), y: clamp(y + d[1]!) })
            }}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {(['cover', 'contain'] as const).map((f) => (
          <Button
            key={f}
            type="button"
            size="sm"
            variant={fit === f ? 'secondary' : 'ghost'}
            aria-pressed={fit === f}
            onClick={() => onChange({ fit: f })}
          >
            {f === 'cover' ? 'Fill' : 'Fit'}
          </Button>
        ))}
      </div>
      {image.kind === 'img' && (
        <fieldset className="flex flex-wrap items-center gap-1.5">
          <legend className="sr-only">{label} alignment</legend>
          {([undefined, 'left', 'center', 'right'] as const).map((a) => (
            <Button
              key={a ?? 'design'}
              type="button"
              size="sm"
              variant={value?.align === a ? 'secondary' : 'ghost'}
              aria-pressed={value?.align === a}
              onClick={() => onChange({ align: a })}
            >
              {a ? { left: 'Left', center: 'Centre', right: 'Right' }[a] : 'As designed'}
            </Button>
          ))}
        </fieldset>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {spa && (
          <Button type="button" size="sm" variant="ghost" onClick={() => setPicker(true)}>
            Replace…
          </Button>
        )}
        {value && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={`Reset ${label}`}
            onClick={() => {
              setUrl('')
              onChange(null)
            }}
          >
            <RotateCcw />
          </Button>
        )}
      </div>
      <Input
        aria-label={`${label} replacement URL`}
        placeholder="Or paste an image URL (https://…)"
        value={url}
        onChange={(e) => setUrl(e.currentTarget.value.trim())}
        onBlur={() => {
          // Only a changed URL: leaving the field untouched must not add an (empty) adjustment.
          if (urlOk && url !== (value?.replace ?? '')) onChange({ replace: url || undefined })
        }}
        className={cn('h-9', !urlOk && 'border-danger')}
      />
      {!urlOk && (
        <p className="text-[13px] text-danger">Use an https:// address or a file from the library.</p>
      )}
      {spa && (
        <MediaPicker
          slug={spa}
          open={picker}
          onOpenChange={setPicker}
          onPick={(item) => {
            setPicker(false)
            setUrl(item.url)
            onChange({ replace: item.url })
          }}
        />
      )}
    </li>
  )
}

/** The design with the adjustments, in the same kind of sandbox as the spa site (opaque origin, links inert). */
function Preview({
  html,
  adjust,
  width,
  onWidth,
  phoneFixes,
}: {
  html: string
  adjust: HtmlImageAdjust[]
  width: 360 | 1280
  onWidth: (w: 360 | 1280) => void
  phoneFixes: boolean
}) {
  const wrap = useRef<HTMLDivElement>(null)
  const [room, setRoom] = useState(640)
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => {
      if (e) setRoom(e.contentRect.width)
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
    }
  }, [])
  const scale = Math.min(1, room / width)
  const height = 520
  // A design can be 5 MB: built once per change, not on every resize.
  const doc = useMemo(
    () => htmlDesignDocument(html, {}, true, adjust, {}, { phoneFixes }),
    [html, adjust, phoneFixes],
  )
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <p className="flex-1 text-[13px] font-medium">Preview</p>
        {([360, 1280] as const).map((w) => (
          <Button
            key={w}
            type="button"
            size="sm"
            variant={width === w ? 'secondary' : 'ghost'}
            aria-pressed={width === w}
            onClick={() => onWidth(w)}
          >
            {w === 360 ? <Smartphone /> : <Monitor />} {w}px
          </Button>
        ))}
      </div>
      <div ref={wrap} className="overflow-hidden rounded-lg border" style={{ height: height * scale }}>
        <HtmlDesignFrame
          title="Design preview"
          data-testid="html-images-preview"
          html={doc}
          sandbox="allow-scripts"
          style={{ width, height, border: 0, transform: `scale(${scale})`, transformOrigin: '0 0' }}
        />
      </div>
    </div>
  )
}
