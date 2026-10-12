'use client'
// R28 P2: the Studio editor's "Website content" field of an HtmlDesign block — every word and picture of a CRM-contract
// design that isn't CRM data, as plain fields (EN / AR follow the editor's language switch). Values are stored on the
// block (`content`, draft → publish with the page); the design file never changes (docs/design/r28-dynamic-html-designs.md).
import { FieldLabel, useGetPuck } from '@puckeditor/core'
import {
  type HtmlContentLeftover,
  type HtmlContentSlot,
  type HtmlContentValue,
  type HtmlDesignContent,
  htmlContentLeftovers,
  htmlContentMap,
  htmlContentOf,
  htmlContentSlots,
  htmlDesignDocOf,
} from '@spa/core'
import { AlertTriangle, ChevronDown, EyeOff, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ImageFieldControl } from '@/components/media/image-field'
import { cn } from '@/lib/utils'
import { BilingualField, useEditorContext } from '../fields'
import { designContract, designKey } from '../html-crm'

type Props = {
  field: { label?: string }
  name: string
  id: string
  value: HtmlDesignContent | undefined
  onChange: (value: HtmlDesignContent | undefined) => void
  readOnly?: boolean
}
type Values = Record<string, HtmlContentValue>

const control =
  'w-full rounded-lg border bg-surface px-3 py-2 text-sm text-fg placeholder:text-muted/70 focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15'

/** Plain names for the keys designs use (anything else: the key in words). */
const KEY_LABELS: Record<string, string> = {
  label: 'Menu label',
  eyebrow: 'Small top line',
  title: 'Title',
  body: 'Text',
  text: 'Text',
  tags: 'Tags',
  cta: 'Show the buttons',
  image: 'Picture',
  still: 'Picture',
  image_alt: 'Picture description',
  focus: 'Picture focus',
  accent: 'Accent colour',
  logo_on_dark: 'Logo on dark backgrounds',
  experience_image: 'Picture',
  experience_image_alt: 'Picture description',
  whatsapp_message: 'WhatsApp message',
  whatsapp_service_message: 'WhatsApp message (with a treatment)',
}
const words = (k: string) => {
  const s = k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}
/** A slot's label; `label` is a scene's menu label only inside the story, elsewhere a button's text. */
const keyLabel = (k: string, group = '') =>
  k === 'label' && !group.startsWith('journey') ? 'Button label' : (KEY_LABELS[k] ?? words(k))

/** A group's heading: `journey[welcome]` → "Scene · Welcome", `spa.experience[1]` → "Experience 2", `booking` → "Booking". */
function groupLabel(group: string, slots: HtmlContentSlot[]): string {
  const named = slots.find((s) => s.key === 'label' && typeof s.value === 'string' && s.value.trim())
  const m = /^(?:.*\.)?([A-Za-z_][\w]*)\[([^\]]+)\]$/.exec(group)
  if (m) {
    const base = m[1] === 'journey' ? 'Scene' : words(m[1]!).replace(/s$/, '')
    const item = /^\d+$/.test(m[2]!) ? String(Number(m[2]) + 1) : words(m[2]!)
    return `${base} · ${named ? String(named.value) : item}`
  }
  if (group === 'contact') return 'WhatsApp messages'
  return words(group.split('.').pop() ?? group)
}

const REASONS: Record<HtmlContentLeftover['reason'], string> = {
  'other-spa': "names the design's spa",
  city: 'names another city',
  phone: 'has a phone number',
  email: 'has an email address',
  test: 'test or filler text',
  arabic: 'no Arabic yet',
  stale: 'no longer in the design',
}

const rowId = (path: string) => `hc-${path.replace(/[^\w-]/g, '_')}`

export function HtmlContentField({ value, onChange, readOnly }: Props) {
  const { locale, html } = useEditorContext()
  const getPuck = useGetPuck()
  const block = getPuck().selectedItem?.props as Record<string, unknown> | undefined
  const ref = htmlDesignDocOf(block ?? {})
  const source = (typeof block?.html === 'string' && block.html) || (ref ? html?.docs[ref.file] : '') || ''
  const data = designContract(source, designKey(ref))?.found?.literal?.data
  const slots = useMemo(() => htmlContentSlots(data), [data])
  const groups = useMemo(() => {
    const m = new Map<string, HtmlContentSlot[]>()
    for (const s of slots) m.set(s.group, [...(m.get(s.group) ?? []), s])
    return [...m]
  }, [slots])

  // Typing stays local and reaches the page 700 ms after the last change: the canvas reloads the whole design.
  const [local, setLocal] = useState<Values>(() => htmlContentMap(value))
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef({ local, onChange })
  latest.current = { local, onChange }
  useEffect(() => {
    if (!pending.current) setLocal(htmlContentMap(value))
  }, [value])
  useEffect(() => {
    return () => {
      if (!pending.current) return
      clearTimeout(pending.current)
      const next = latest.current.local
      latest.current.onChange(htmlContentOf(next))
    }
  }, [])
  const commit = (next: Values) => {
    setLocal(next)
    if (pending.current) clearTimeout(pending.current)
    pending.current = setTimeout(() => {
      pending.current = null
      onChange(htmlContentOf(next))
    }, 700)
  }
  const set = (path: string, v: HtmlContentValue | null) => {
    const next = { ...local }
    if (v) next[path] = v
    else delete next[path]
    commit(next)
  }

  const labels = useMemo(() => {
    const m = new Map<string, string>()
    for (const [group, list] of groups)
      for (const s of list) m.set(s.path, `${groupLabel(group, list)} · ${keyLabel(s.key, group)}`)
    return m
  }, [groups])
  const leftovers = useMemo(
    () =>
      htmlContentLeftovers(data, htmlContentOf(local), {
        spaName: html?.spaName ?? '',
        city: html?.city ?? '',
        arabic: true,
      }),
    [data, local, html?.spaName, html?.city],
  )

  if (!data)
    return (
      <div className="space-y-2 text-sm text-muted">
        <FieldLabel label="Website content" el="div" />
        <p>
          This design has no <code>window.CRM_DATA</code>, so its words and pictures are part of the file.
          Change them with Ask AI or upload a new version of the file.
        </p>
      </div>
    )

  const setCount = Object.keys(local).length
  return (
    <div className="space-y-3" data-testid="html-content">
      <FieldLabel label="Website content" el="div" />
      <p className="text-xs text-muted">
        Words and pictures of this spa's site, over the design's own. Name, phones, address, hours,
        treatments, prices and team come live from the CRM.{' '}
        {setCount ? `${setCount} changed.` : 'Nothing changed yet.'}
      </p>
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
                  onClick={() => {
                    const el = document.getElementById(rowId(l.path))
                    if (el) {
                      el.closest('details')?.setAttribute('open', '')
                      el.scrollIntoView({ block: 'center' })
                    }
                  }}
                >
                  <b>{labels.get(l.path) ?? l.path}</b>: {REASONS[l.reason]}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {groups.map(([group, list]) => {
        const changed = list.filter((s) => local[s.path]).length
        return (
          <details key={group} className="group rounded-lg border bg-surface" open={groups.length <= 3}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-medium">
              <span>{groupLabel(group, list)}</span>
              <span className="flex items-center gap-2 text-xs font-normal text-muted">
                {changed > 0 && (
                  <span className="rounded-full bg-accent/10 px-2 py-0.5 text-accent">{changed}</span>
                )}
                <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
              </span>
            </summary>
            <div className="space-y-3 border-t px-3 py-3">
              {list.map((slot) => (
                <SlotRow
                  key={slot.path}
                  slot={slot}
                  value={local[slot.path]}
                  locale={locale}
                  readOnly={readOnly}
                  onSet={(v) => set(slot.path, v)}
                />
              ))}
            </div>
          </details>
        )
      })}
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
