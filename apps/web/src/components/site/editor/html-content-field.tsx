'use client'
// R28 P2: the Studio editor's "Website content" field of an HtmlDesign block — every word and picture of a CRM-contract
// design that isn't CRM data, as plain fields (EN / AR follow the editor's language switch). P4: the page texts (text,
// alt / placeholder / aria-label / title, page title, meta description) and pictures of every design. Values are stored
// on the block (`content`, draft → publish with the page); the design file never changes
// (docs/design/r28-dynamic-html-designs.md).
import { FieldLabel, useGetPuck } from '@puckeditor/core'
import {
  contentUrlOk,
  HTML_IMAGE_SRC_MAX,
  HTML_IMAGE_URL,
  type HtmlContentBi,
  type HtmlContentParts,
  type HtmlContentSlot,
  type HtmlContentValue,
  type HtmlDesignContent,
  type HtmlDesignImage,
  type HtmlDesignText,
  htmlContentFrom,
  htmlContentLeftovers,
  htmlContentParts,
  htmlContentSlots,
  htmlDesignDocOf,
} from '@spa/core'
import { AlertTriangle, ChevronDown, EyeOff, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ImageFieldControl } from '@/components/media/image-field'
import { cn } from '@/lib/utils'
import { BilingualField, useEditorContext } from '../fields'
import { designContract, designKey } from '../html-crm'
import {
  clip,
  designListing,
  groupLabel,
  keyLabel,
  kindLabel,
  leftoverLabel,
  REASONS,
  rowId,
  textLabel,
} from './html-content-labels'

type Props = {
  field: { label?: string }
  name: string
  id: string
  value: HtmlDesignContent | undefined
  onChange: (value: HtmlDesignContent | undefined) => void
  readOnly?: boolean
}

const control =
  'w-full rounded-lg border bg-surface px-3 py-2 text-sm text-fg placeholder:text-muted/70 focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15'

/** Page-text rows shown at once (a big design has ~2000 texts): the search narrows them. */
const ROWS = 200
const pageLevel = (t: HtmlDesignText) => t.kind === 'title' || t.kind === 'meta'
/** Design pictures the console can show as a thumbnail (relative paths would load from the console). */
const THUMB = /^(?:data:|https:|\/)/i

export function HtmlContentField({ value, onChange, readOnly }: Props) {
  const { locale, html } = useEditorContext()
  const getPuck = useGetPuck()
  const block = getPuck().selectedItem?.props as Record<string, unknown> | undefined
  const ref = htmlDesignDocOf(block ?? {})
  const key = designKey(ref)
  const source = (typeof block?.html === 'string' && block.html) || (ref ? html?.docs[ref.file] : '') || ''
  const data = designContract(source, key)?.found?.literal?.data
  const slots = useMemo(() => htmlContentSlots(data), [data])
  const groups = useMemo(() => {
    const m = new Map<string, HtmlContentSlot[]>()
    for (const s of slots) m.set(s.group, [...(m.get(s.group) ?? []), s])
    return [...m]
  }, [slots])
  // P4: every design's page texts and pictures (with or without CRM_DATA), listed once per stored document.
  const { texts, images } = useMemo(() => designListing(source, key), [source, key])
  const textById = useMemo(() => new Map(texts.map((t) => [t.id, t])), [texts])
  const imageById = useMemo(() => new Map(images.map((x) => [x.id, x])), [images])
  const slotPaths = useMemo(() => new Set(slots.map((s) => s.path)), [slots])

  // Typing stays local and reaches the page 700 ms after the last change: the canvas reloads the whole design.
  const [local, setLocal] = useState<HtmlContentParts>(() => htmlContentParts(value))
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef({ local, onChange })
  latest.current = { local, onChange }
  useEffect(() => {
    if (!pending.current) setLocal(htmlContentParts(value))
  }, [value])
  useEffect(() => {
    return () => {
      if (!pending.current) return
      clearTimeout(pending.current)
      const next = latest.current.local
      latest.current.onChange(htmlContentFrom(next))
    }
  }, [])
  const commit = (next: HtmlContentParts) => {
    setLocal(next)
    if (pending.current) clearTimeout(pending.current)
    pending.current = setTimeout(() => {
      pending.current = null
      onChange(htmlContentFrom(next))
    }, 700)
  }
  const set = (path: string, v: HtmlContentValue | null) => {
    const values = { ...local.values }
    if (v) values[path] = v
    else delete values[path]
    commit({ ...local, values })
  }
  /** A page text (the guard is the design text's, as listed); both languages empty → back to the design's. */
  const setText = (id: string, t: HtmlContentBi | null) => {
    const listed = textById.get(id)
    const next = { ...local.texts }
    const en = t?.en.trim() ? t.en : ''
    const ar = t?.ar?.trim() ? t.ar : ''
    // English is required: an Arabic-only text keeps the design's English.
    if (listed && (en || ar))
      next[id] = { id, src: listed.src, t: { en: en || listed.text, ...(ar ? { ar } : {}) } }
    else delete next[id]
    commit({ ...local, texts: next })
  }
  const setPicture = (id: string, img: string | null) => {
    const image = imageById.get(id)
    const next = { ...local.pictures }
    if (image && img) next[id] = { id, src: image.src.slice(0, HTML_IMAGE_SRC_MAX), img }
    else delete next[id]
    commit({ ...local, pictures: next })
  }

  const leftovers = useMemo(
    () =>
      htmlContentLeftovers(data, htmlContentFrom(local), {
        spaName: html?.spaName ?? '',
        city: html?.city ?? '',
        arabic: true,
        page: { texts, images },
      }),
    [data, local, html?.spaName, html?.city, texts, images],
  )
  const staleTexts = Object.values(local.texts).filter((e) => textById.get(e.id)?.src !== e.src)
  const stalePictures = Object.values(local.pictures).filter(
    (p) => imageById.get(p.id)?.src.slice(0, HTML_IMAGE_SRC_MAX) !== p.src,
  )

  // Page texts: open by default only without CRM groups; rows exist only while open (a big design has thousands).
  const [textsChoice, setTextsOpen] = useState<boolean | null>(null)
  const textsOpen = textsChoice ?? groups.length === 0
  const [picturesOpen, setPicturesOpen] = useState(false)
  const [search, setSearch] = useState('')
  /** A leftover's page text, shown even past the first ROWS rows. */
  const [reveal, setReveal] = useState<string | null>(null)
  const rows = useMemo(() => {
    if (!textsOpen) return { sections: [] as [string, HtmlDesignText[]][], more: 0 }
    const q = search.trim().toLowerCase()
    const hit = (t: HtmlDesignText) => {
      if (!q) return true
      const own = local.texts[t.id]?.t
      return [t.text, t.group, own?.en ?? '', own?.ar ?? ''].some((s) => s.toLowerCase().includes(q))
    }
    const list = [
      ...texts.filter((t) => pageLevel(t) && hit(t)),
      ...texts.filter((t) => !pageLevel(t) && hit(t)),
    ]
    const shown = list.slice(0, ROWS)
    const extra = reveal ? textById.get(reveal) : undefined
    if (extra && !shown.includes(extra)) shown.push(extra)
    const sections = new Map<string, HtmlDesignText[]>()
    for (const t of shown) {
      const heading = pageLevel(t) ? 'Page title and description' : t.group || 'Page'
      sections.set(heading, [...(sections.get(heading) ?? []), t])
    }
    return { sections: [...sections], more: Math.max(0, list.length - ROWS) }
  }, [textsOpen, search, texts, textById, local.texts, reveal])

  const root = useRef<HTMLDivElement>(null)
  /** Scrolls to a field row (a data slot, `text:<id>` or `picture:<id>`), opening what hides it first. */
  const goTo = (path: string) => {
    if (path.startsWith('text:')) {
      setSearch('')
      setTextsOpen(true)
      setReveal(path.slice(5))
    } else if (path.startsWith('picture:')) setPicturesOpen(true)
    requestAnimationFrame(() => {
      const el = root.current?.querySelector<HTMLElement>(`#${rowId(path)}`)
      if (!el) return
      el.closest('details')?.setAttribute('open', '')
      el.scrollIntoView({ block: 'center' })
    })
  }

  const setCount =
    Object.keys(local.values).length + Object.keys(local.texts).length + Object.keys(local.pictures).length
  const changed = setCount ? `${setCount} changed.` : 'Nothing changed yet.'
  const labelCtx = { slots, texts, images }
  return (
    <div ref={root} className="space-y-3" data-testid="html-content">
      <FieldLabel label="Website content" el="div" />
      {data ? (
        <p className="text-xs text-muted">
          Words and pictures of this spa's site, over the design's own. Name, phones, address, hours,
          treatments, prices and team come live from the CRM. {changed}
        </p>
      ) : (
        <p className="text-xs text-muted">
          This design has no <code>window.CRM_DATA</code>: its story data is part of the file. Page texts and
          pictures below still change per spa. {changed}
        </p>
      )}
      {leftovers.length > 0 && (
        <div className="rounded-lg border border-amber-300/70 bg-amber-50 p-2.5 text-xs text-amber-900">
          <p className="mb-1.5 flex items-center gap-1.5 font-medium">
            <AlertTriangle className="size-3.5" /> {leftovers.length} still from the design
          </p>
          <ul className="space-y-1" aria-label="Still from the design">
            {leftovers.slice(0, 12).map((l) => (
              <li key={`${l.path}:${l.reason}`}>
                <button
                  type="button"
                  className="text-start underline-offset-2 hover:underline"
                  onClick={() => goTo(l.path)}
                >
                  <b>{leftoverLabel(l.path, labelCtx)}</b>: {REASONS[l.reason]}
                </button>
              </li>
            ))}
            {leftovers.length > 12 && <li>and {leftovers.length - 12} more</li>}
          </ul>
        </div>
      )}
      {groups.map(([group, list]) => (
        <details key={group} className="group rounded-lg border bg-surface" open={groups.length <= 3}>
          <Summary
            title={groupLabel(group, list)}
            changed={list.filter((s) => local.values[s.path]).length}
          />
          <div className="space-y-3 border-t px-3 py-3">
            {list.map((slot) => (
              <SlotRow
                key={slot.path}
                slot={slot}
                value={local.values[slot.path]}
                locale={locale}
                readOnly={readOnly}
                onSet={(v) => set(slot.path, v)}
              />
            ))}
          </div>
        </details>
      ))}
      {(texts.length > 0 || staleTexts.length > 0) && (
        <details
          className="group rounded-lg border bg-surface"
          open={textsOpen}
          onToggle={(e) => setTextsOpen(e.currentTarget.open)}
        >
          <Summary title={`Page texts (${texts.length})`} changed={Object.keys(local.texts).length} />
          {textsOpen && (
            <div className="space-y-3 border-t px-3 py-3">
              <p className="text-[11px] text-muted">
                Every heading, button, link, picture description, the page title and the search description.
              </p>
              <input
                type="search"
                className={control}
                aria-label="Search page texts"
                placeholder="Search page texts"
                value={search}
                onChange={(e) => {
                  setSearch(e.currentTarget.value)
                  setReveal(null)
                }}
              />
              {staleTexts.map((e) => (
                <Outdated
                  key={e.id}
                  id={textById.has(e.id) ? undefined : rowId(`text:${e.id}`)}
                  what={clip(e.t.en || e.t.ar || '', 60)}
                  readOnly={readOnly}
                  onRemove={() => setText(e.id, null)}
                />
              ))}
              {rows.sections.map(([heading, list]) => (
                <div key={heading} className="space-y-3">
                  <p className="text-[11px] font-semibold tracking-wide text-muted uppercase">{heading}</p>
                  {list.map((t) => {
                    const own = local.texts[t.id]
                    const path = /^data-crm=(.+)$/.exec(t.binding ?? '')?.[1]
                    return (
                      <TextRow
                        key={t.id}
                        text={t}
                        value={own?.src === t.src ? { ...own.t, en: own.t.en ?? '' } : undefined}
                        locale={locale}
                        readOnly={readOnly}
                        field={path && slotPaths.has(path) ? path : undefined}
                        onSet={(v) => setText(t.id, v)}
                        onGoTo={goTo}
                      />
                    )
                  })}
                </div>
              ))}
              {!rows.sections.length && <p className="text-xs text-muted">No page text matches.</p>}
              {rows.more > 0 && (
                <p className="text-xs text-muted">Refine the search to see more ({rows.more} not shown).</p>
              )}
            </div>
          )}
        </details>
      )}
      {(images.length > 0 || stalePictures.length > 0) && (
        <details
          className="group rounded-lg border bg-surface"
          open={picturesOpen}
          onToggle={(e) => setPicturesOpen(e.currentTarget.open)}
        >
          <Summary title={`Pictures (${images.length})`} changed={Object.keys(local.pictures).length} />
          {picturesOpen && (
            <div className="space-y-4 border-t px-3 py-3">
              <p className="text-[11px] text-muted">
                This spa's own pictures in the design's places; the design's framing stays.
              </p>
              {stalePictures.map((p) => (
                <Outdated
                  key={p.id}
                  id={imageById.has(p.id) ? undefined : rowId(`picture:${p.id}`)}
                  what={clip(p.img, 60)}
                  readOnly={readOnly}
                  onRemove={() => setPicture(p.id, null)}
                />
              ))}
              {images.map((image, n) => {
                const own = local.pictures[image.id]
                return (
                  <PictureRow
                    key={image.id}
                    image={image}
                    n={n}
                    value={own?.src === image.src.slice(0, HTML_IMAGE_SRC_MAX) ? own.img : undefined}
                    readOnly={readOnly}
                    onSet={(img) => setPicture(image.id, img)}
                  />
                )
              })}
            </div>
          )}
        </details>
      )}
    </div>
  )
}

function Summary({ title, changed }: { title: string; changed: number }) {
  return (
    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-medium">
      <span>{title}</span>
      <span className="flex items-center gap-2 text-xs font-normal text-muted">
        {changed > 0 && <span className="rounded-full bg-accent/10 px-2 py-0.5 text-accent">{changed}</span>}
        <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
      </span>
    </summary>
  )
}

/** A stored page text / picture the design no longer has there (never shown on the site): removable. */
function Outdated({
  id,
  what,
  readOnly,
  onRemove,
}: {
  id?: string
  what: string
  readOnly?: boolean
  onRemove: () => void
}) {
  return (
    <div
      id={id}
      className="flex items-center justify-between gap-2 rounded-md border border-amber-300/70 bg-amber-50 px-2.5 py-2 text-xs text-amber-900"
    >
      <span className="min-w-0 break-words">
        <b>Outdated: the design changed here.</b> {what}
      </span>
      <button
        type="button"
        className="shrink-0 rounded px-1.5 py-0.5 font-medium hover:bg-amber-100"
        onClick={onRemove}
        disabled={readOnly}
      >
        Remove
      </button>
    </div>
  )
}

function TextRow({
  text,
  value,
  locale,
  readOnly,
  field,
  onSet,
  onGoTo,
}: {
  text: HtmlDesignText
  value: HtmlContentBi | undefined
  locale: 'en' | 'ar'
  readOnly?: boolean
  /** The data slot a bound text shows (`data-crm=<path>`), when it is one. */
  field?: string
  onSet: (t: HtmlContentBi | null) => void
  onGoTo: (path: string) => void
}) {
  const id = rowId(`text:${text.id}`)
  const label = textLabel(text)
  if (text.bound)
    return (
      <div id={id} className="rounded-md bg-subtle px-2.5 py-2 text-xs text-muted" data-testid="page-text">
        <p className="font-medium text-fg">{kindLabel(text)}</p>
        <p className="line-clamp-2">{clip(text.text, 160)}</p>
        <p className="mt-1">
          Filled by the design from the CRM{text.binding ? ` (${text.binding})` : ''}.
          {field && (
            <button
              type="button"
              className="ms-1 font-medium text-accent hover:underline"
              onClick={() => onGoTo(field)}
            >
              Go to field
            </button>
          )}
        </p>
      </div>
    )
  return (
    <div id={id} data-testid="page-text">
      {value && (
        <div className="-mb-5 flex justify-end">
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted hover:bg-subtle hover:text-fg"
            onClick={() => onSet(null)}
            disabled={readOnly}
            aria-label={`Back to the design: ${label}`}
          >
            <RotateCcw className="size-3" /> Design
          </button>
        </div>
      )}
      <BilingualField
        field={{ label }}
        name={`text:${text.id}`}
        id={`${id}-text`}
        value={value}
        multiline={text.kind === 'meta' || text.text.length > 160}
        readOnly={readOnly}
        onChange={(v) => onSet(v ?? null)}
      />
      <p className={cn('mt-1 line-clamp-2 text-[11px] text-muted', locale === 'ar' && 'text-end')}>
        Design: {clip(text.text, 160)}
      </p>
    </div>
  )
}

function PictureRow({
  image,
  n,
  value,
  readOnly,
  onSet,
}: {
  image: HtmlDesignImage
  n: number
  value: string | undefined
  readOnly?: boolean
  onSet: (img: string | null) => void
}) {
  const id = rowId(`picture:${image.id}`)
  const [bad, setBad] = useState(false)
  return (
    <div id={id}>
      {!value && THUMB.test(image.src) && (
        // biome-ignore lint/performance/noImgElement: the design's own picture, editor only
        <img src={image.src} alt="" className="mb-1.5 h-20 w-full rounded-md border object-cover" />
      )}
      <ImageFieldControl
        field={{ label: `Picture ${n + 1}` }}
        id={`${id}-img`}
        value={value ?? ''}
        onChange={(v) => {
          // The frame is dropped: the design's own framing (or the template's adjustment) applies.
          const src = (typeof v === 'string' ? v : (v as { src?: string } | null)?.src)?.trim() ?? ''
          const ok = !src || (contentUrlOk(src) && HTML_IMAGE_URL.test(src))
          setBad(!ok)
          if (ok) onSet(src || null)
        }}
        readOnly={readOnly}
      />
      {bad && (
        <p className="mt-1 text-[11px] text-danger">Use a picture from the media library or an https link.</p>
      )}
      {image.kind === 'img' && (
        <p className="mt-1 text-[11px] text-muted">
          Its description is under Page texts → Picture description.
        </p>
      )}
    </div>
  )
}

function SlotRow({
  slot,
  value,
  locale,
  readOnly,
  onSet,
}: {
  slot: HtmlContentSlot
  value: HtmlContentValue | undefined
  locale: 'en' | 'ar'
  readOnly?: boolean
  onSet: (v: HtmlContentValue | null) => void
}) {
  const label = keyLabel(slot.key, slot.group)
  const id = rowId(slot.path)
  const hidden = Boolean(value && 'hide' in value)
  const design = slot.value
  const actions = (
    <span className="flex shrink-0 items-center gap-1">
      {value && (
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted hover:bg-subtle hover:text-fg"
          onClick={() => onSet(null)}
          disabled={readOnly}
          aria-label={`Back to the design: ${label}`}
        >
          <RotateCcw className="size-3" /> Design
        </button>
      )}
      {!hidden && slot.kind !== 'bool' && (
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted hover:bg-subtle hover:text-fg"
          onClick={() => onSet({ hide: true })}
          disabled={readOnly}
          aria-label={`Hide: ${label}`}
        >
          <EyeOff className="size-3" /> Hide
        </button>
      )}
    </span>
  )
  const head = (
    <div className="mb-1 flex items-center justify-between gap-2">
      <span className="text-xs font-medium text-fg">{label}</span>
      {actions}
    </div>
  )
  if (hidden)
    return (
      <div id={id} className="rounded-md bg-subtle px-2.5 py-2 text-xs text-muted">
        {head}
        Hidden on this spa's site.
      </div>
    )

  if (slot.kind === 'image')
    return (
      <div id={id}>
        {head}
        {!value && typeof design === 'string' && design && (
          // biome-ignore lint/performance/noImgElement: the design's own embedded picture (data: URL), editor only
          <img src={design} alt="" className="mb-1.5 h-20 w-full rounded-md border object-cover" />
        )}
        <ImageFieldControl
          field={{ label: value ? '' : 'Replace the design picture' }}
          id={`${id}-img`}
          value={value && 'img' in value ? value.img : ''}
          onChange={(v) => {
            const src = typeof v === 'string' ? v : (v as { src?: string } | null)?.src
            onSet(src ? { img: src } : null)
          }}
          readOnly={readOnly}
        />
      </div>
    )

  if (slot.kind === 'bool')
    return (
      <label id={id} className="flex items-center justify-between gap-2 text-sm">
        <span className="text-xs font-medium">{label}</span>
        <span className="flex items-center gap-2">
          {value && actions}
          <input
            type="checkbox"
            className="size-4 accent-[var(--accent)]"
            checked={value && 'on' in value ? value.on : Boolean(design)}
            disabled={readOnly}
            onChange={(e) => onSet({ on: e.currentTarget.checked })}
          />
        </span>
      </label>
    )

  if (slot.kind === 'tags') {
    const own = value && 'tags' in value ? value.tags : null
    const list = own ? (locale === 'ar' ? (own.ar ?? []) : own.en) : null
    return (
      <div id={id}>
        {head}
        <input
          className={control}
          dir={locale === 'ar' ? 'rtl' : 'ltr'}
          value={list ? list.join(', ') : ''}
          placeholder={Array.isArray(design) ? design.join(', ') : ''}
          disabled={readOnly}
          onChange={(e) => {
            const next = e.currentTarget.value
              .split(',')
              .map((x) => x.trim())
              .filter(Boolean)
            const base = own ?? { en: Array.isArray(design) ? design : [] }
            onSet({ tags: locale === 'ar' ? { ...base, ar: next } : { ...base, en: next } })
          }}
        />
        <p className="mt-1 text-[11px] text-muted">Separate with commas.</p>
      </div>
    )
  }

  if (slot.kind === 'color' || slot.kind === 'focus') {
    const v = value && 't' in value ? value.t.en : ''
    return (
      <div id={id}>
        {head}
        <span className="flex items-center gap-2">
          {slot.kind === 'color' && (
            <input
              type="color"
              className="h-9 w-10 rounded border"
              value={/^#[0-9a-f]{6}$/i.test(v || String(design)) ? v || String(design) : '#000000'}
              disabled={readOnly}
              onChange={(e) => onSet({ t: { en: e.currentTarget.value } })}
            />
          )}
          <input
            className={control}
            value={v}
            placeholder={String(design ?? '')}
            disabled={readOnly}
            onChange={(e) => {
              const t = e.currentTarget.value
              onSet(t ? { t: { en: t } } : null)
            }}
          />
        </span>
        {slot.kind === 'focus' && (
          <p className="mt-1 text-[11px] text-muted">Where the picture stays in view, like "50% 30%".</p>
        )}
      </div>
    )
  }

  if (slot.kind === 'video')
    return (
      <div id={id}>
        {head}
        <input
          className={control}
          value={value && 'video' in value ? value.video : ''}
          placeholder="https://… or /files/…"
          disabled={readOnly}
          onChange={(e) => {
            const v = e.currentTarget.value.trim()
            onSet(v ? { video: v } : null)
          }}
        />
      </div>
    )

  // text / longtext: the field's own label (with its EN/AR chip) names it; the actions sit above.
  const t = value && 't' in value ? value.t : undefined
  return (
    <div id={id}>
      <div className="-mb-5 flex justify-end">{actions}</div>
      <BilingualField
        field={{ label }}
        name={slot.path}
        id={`${id}-text`}
        value={t}
        multiline={slot.kind === 'longtext'}
        readOnly={readOnly}
        onChange={(v) =>
          onSet(v && (v.en || v.ar) ? { t: v.ar ? { en: v.en, ar: v.ar } : { en: v.en } } : null)
        }
      />
      {typeof design === 'string' && design && (
        <p className={cn('mt-1 line-clamp-2 text-[11px] text-muted', locale === 'ar' && 'text-end')}>
          Design: {design}
        </p>
      )}
    </div>
  )
}
