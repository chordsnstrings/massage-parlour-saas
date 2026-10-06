'use client'
import { FieldLabel } from '@puckeditor/core'
import {
  dubaiLocalInstant,
  MAX_SECTION_CSS_BYTES,
  type SectionSchedule,
  scheduleState,
  scopeSectionCss,
} from '@spa/services/site-kit'
import { Loader2, Monitor, RotateCcw, Smartphone, Sparkles, Tablet } from 'lucide-react'
import { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from 'react'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import type { Bi, Device, Locale, Responsive } from './types'

/** AI copy assists (PLAN §11.6 P3): rewrite in the spa's brand voice or translate between EN and AR. */
export type AiOp = 'rewrite' | 'shorten' | 'warmer' | 'to-ar' | 'to-en'
export type AiAssist = {
  /** False when ModelArk isn't configured for this install: the menu explains instead of failing. */
  ready: boolean
  run: (
    op: AiOp,
    text: string,
    locale: Locale,
  ) => Promise<{ ok: true; text: string } | { ok: false; error: string }>
}

/** Editor-wide state the custom fields read: content language, device and (in the tenant editor) AI assists. */
export const EditorContext = createContext<{ locale: Locale; device: Device; ai?: AiAssist }>({
  locale: 'en',
  device: 'lg',
})
export const useEditorContext = () => useContext(EditorContext)

const control =
  'w-full rounded-lg border bg-surface px-3 py-2 text-sm text-fg placeholder:text-muted/70 transition-[border-color,box-shadow] duration-150 focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15'

type FieldRenderProps<V> = {
  field: { label?: string }
  name: string
  id: string
  value: V
  onChange: (value: V) => void
  readOnly?: boolean
}

/** Bilingual text input bound to the editor's EN/AR toggle. Arabic shows the English text as a guide. */
export function BilingualField({
  field,
  id,
  value,
  onChange,
  readOnly,
  multiline,
}: FieldRenderProps<Bi | undefined> & { multiline?: boolean }) {
  const { locale, ai } = useEditorContext()
  const [busy, setBusy] = useState(false)
  const v = value ?? { en: '' }
  const current = locale === 'ar' ? (v.ar ?? '') : v.en
  const set = (text: string) => onChange({ ...v, [locale]: text })
  const props = {
    id,
    // FieldLabel renders a <div> (it carries the EN/AR chip), so name the control explicitly.
    'aria-label': field.label,
    value: current,
    readOnly: readOnly || busy,
    dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const),
    lang: locale,
    placeholder: locale === 'ar' ? v.en || 'بالعربية' : '',
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(e.target.value),
    className: cn(control, multiline && 'min-h-24 resize-y leading-relaxed', ai && !readOnly && 'pe-10'),
  }
  const assist = async (op: AiOp) => {
    if (!ai) return
    const source = op === 'to-ar' ? v.en : op === 'to-en' ? (v.ar ?? '') : current
    const target: Locale = op === 'to-ar' ? 'ar' : op === 'to-en' ? 'en' : locale
    setBusy(true)
    try {
      const r = await ai.run(op, source, op === 'to-en' ? 'ar' : op === 'to-ar' ? 'en' : locale)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      onChange({ ...v, [target]: r.text })
      if (target !== locale) toast.success(target === 'ar' ? 'Arabic added' : 'English added')
    } finally {
      setBusy(false)
    }
  }
  return (
    <FieldLabel
      label={field.label ?? ''}
      el="div"
      readOnly={readOnly}
      icon={
        <span
          className={cn(
            'rounded px-1 text-[10px] font-semibold tracking-wide',
            locale === 'ar' ? 'bg-warning-soft text-warning' : 'bg-accent-soft text-accent',
          )}
        >
          {locale.toUpperCase()}
        </span>
      }
    >
      <div className="relative">
        {multiline ? <textarea rows={4} {...props} /> : <input type="text" {...props} />}
        {ai && !readOnly && (
          <AiMenu
            ai={ai}
            busy={busy}
            label={field.label ?? 'text'}
            has={{ current: !!current.trim(), en: !!v.en.trim(), ar: !!v.ar?.trim() }}
            onPick={assist}
          />
        )}
      </div>
      {locale === 'ar' && !v.ar && v.en && !readOnly && (
        <button
          type="button"
          onClick={() => (ai?.ready ? assist('to-ar') : set(v.en))}
          disabled={busy}
          className="mt-1.5 min-h-8 text-xs font-medium text-accent hover:underline disabled:opacity-50"
        >
          {ai?.ready ? 'Translate from English with AI' : 'Copy from English'}
        </button>
      )}
    </FieldLabel>
  )
}

const AI_ITEMS: { op: AiOp; label: string; needs: 'current' | 'en' | 'ar' }[] = [
  { op: 'rewrite', label: 'Rewrite', needs: 'current' },
  { op: 'shorten', label: 'Shorten', needs: 'current' },
  { op: 'warmer', label: 'Make it warmer', needs: 'current' },
  { op: 'to-ar', label: 'Translate EN → AR', needs: 'en' },
  { op: 'to-en', label: 'Translate AR → EN', needs: 'ar' },
]

/** ✨ menu inside a bilingual field. Closes on outside click / Escape; explains when AI isn't set up. */
function AiMenu({
  ai,
  busy,
  label,
  has,
  onPick,
}: {
  ai: AiAssist
  busy: boolean
  label: string
  has: { current: boolean; en: boolean; ar: boolean }
  onPick: (op: AiOp) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const menuId = useId()
  useEffect(() => {
    if (!open) return
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node))
        setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])
  return (
    <div ref={ref} className="absolute end-1 top-1">
      <button
        type="button"
        aria-label={`AI assist for ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        disabled={busy}
        onClick={() => setOpen((o) => !o)}
        className="grid size-8 place-items-center rounded-md text-accent transition-colors hover:bg-accent-soft disabled:opacity-60"
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Sparkles className="size-4" strokeWidth={1.75} />
        )}
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          className="anim-pop-in absolute end-0 top-9 z-30 w-56 rounded-xl border bg-surface p-1 shadow-pop"
        >
          {!ai.ready && (
            <p className="px-3 py-2 text-xs leading-relaxed text-muted">
              AI writing help isn’t set up for this spa yet — ask your account manager to switch it on.
            </p>
          )}
          {AI_ITEMS.map((item) => (
            <button
              key={item.op}
              type="button"
              role="menuitem"
              disabled={!ai.ready || !has[item.needs]}
              onClick={() => {
                setOpen(false)
                onPick(item.op)
              }}
              className="flex min-h-10 w-full items-center rounded-lg px-3 text-start text-sm transition-colors hover:bg-subtle disabled:pointer-events-none disabled:opacity-45"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const formatBytes = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`)

/** Section-scoped custom CSS (owner/designer only): live notes on anything the sanitiser drops. */
export function CustomCssField({
  field,
  id,
  value,
  onChange,
  readOnly,
}: FieldRenderProps<string | undefined>) {
  const css = value ?? ''
  const bytes = useMemo(() => new TextEncoder().encode(css).length, [css])
  const result = useMemo(() => scopeSectionCss(css, 'preview'), [css])
  return (
    <FieldLabel label={field.label ?? 'Custom CSS'} el="div" readOnly={readOnly}>
      <textarea
        id={id}
        value={css}
        readOnly={readOnly}
        rows={7}
        dir="ltr"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        placeholder={':scope { border-top: 1px solid currentColor }\nh2 { letter-spacing: .04em }'}
        onChange={(e) => onChange(e.target.value)}
        className={cn(control, 'min-h-32 resize-y font-mono text-xs leading-relaxed')}
      />
      <p className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-muted">
        <span>Only affects this section. :scope is the section itself.</span>
        <span className={cn('shrink-0 tabular-nums', bytes > MAX_SECTION_CSS_BYTES && 'text-danger')}>
          {formatBytes(bytes)} / 4 KB
        </span>
      </p>
      {result.removed.length > 0 && (
        <p className="mt-1 text-[11px] leading-relaxed text-warning">Ignored: {result.removed.join(', ')}</p>
      )}
    </FieldLabel>
  )
}

const SCHEDULE_TEXT = {
  always: 'Always shown',
  live: 'Showing now',
  upcoming: 'Hidden until the start date',
  ended: 'Ended — hidden from visitors',
} as const

/** Why a schedule can't be saved, or null. */
function scheduleError(v: SectionSchedule): string | null {
  const from = dubaiLocalInstant(v.from)
  const to = dubaiLocalInstant(v.to, true)
  return from && to && from >= to ? '“Until” must be after “Show from” — not saved yet.' : null
}

/**
 * Show-between dates for a section, in Dubai time. Each end is a date with an optional time: a date-only
 * "Until" includes that whole day. Hidden sections stay visible (badged) in the editor.
 */
export function ScheduleField({
  field,
  id,
  value,
  onChange,
  readOnly,
}: FieldRenderProps<SectionSchedule | undefined>) {
  const saved = value ?? {}
  // Local copy so an invalid range can be shown (and fixed) without being saved.
  const [v, setV] = useState<SectionSchedule>(saved)
  const savedKey = `${saved.from ?? ''}|${saved.to ?? ''}`
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-sync only when the stored value changes
  useEffect(() => {
    setV(value ?? {})
  }, [savedKey])
  const error = scheduleError(v)
  const state = scheduleState(error ? saved : v)
  const update = (next: SectionSchedule) => {
    const out: SectionSchedule = {}
    if (next.from) out.from = next.from
    if (next.to) out.to = next.to
    setV(out)
    if (!scheduleError(out)) onChange(out)
  }
  const input = (key: 'from' | 'to', label: string) => {
    const raw = typeof v[key] === 'string' ? v[key]! : ''
    const date = raw.slice(0, 10)
    const time = raw.length > 10 ? raw.slice(11, 16) : ''
    return (
      <fieldset className="m-0 flex min-w-0 flex-col gap-1 border-0 p-0">
        <legend className="mb-1 p-0 text-[11px] font-medium text-muted">{label}</legend>
        <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-1.5">
          <input
            id={`${id}-${key}`}
            type="date"
            aria-label={`${label} date`}
            value={date}
            readOnly={readOnly}
            onChange={(e) =>
              update({ ...v, [key]: e.target.value && (time ? `${e.target.value}T${time}` : e.target.value) })
            }
            className={cn(control, 'min-h-10 py-1.5 text-[13px]')}
          />
          <input
            id={`${id}-${key}-time`}
            type="time"
            aria-label={`${label} time (optional)`}
            value={time}
            readOnly={readOnly}
            disabled={!date}
            onChange={(e) => update({ ...v, [key]: e.target.value ? `${date}T${e.target.value}` : date })}
            className={cn(control, 'min-h-10 py-1.5 text-[13px] disabled:opacity-50')}
          />
        </div>
      </fieldset>
    )
  }
  return (
    <FieldLabel label={field.label ?? 'Schedule'} el="div" readOnly={readOnly}>
      <div className="grid gap-2">
        {input('from', 'Show from')}
        {input('to', 'Until')}
        <p className="text-[11px] text-muted">Leave the time empty to include the whole day.</p>
        {error && (
          <p role="alert" className="text-[11px] font-medium text-danger">
            {error}
          </p>
        )}
        <p className="flex items-center justify-between text-[11px] text-muted">
          <span className={cn(state === 'upcoming' || state === 'ended' ? 'text-warning' : undefined)}>
            {SCHEDULE_TEXT[state]} · Dubai time
          </span>
          {(v.from || v.to) && !readOnly && (
            <button
              type="button"
              onClick={() => update({})}
              className="inline-flex min-h-8 items-center gap-1 font-medium text-accent hover:underline"
            >
              <RotateCcw className="size-3" /> Clear
            </button>
          )}
        </p>
      </div>
    </FieldLabel>
  )
}

const DEVICES: { key: Device; label: string; Icon: typeof Smartphone }[] = [
  { key: 'base', label: 'Mobile', Icon: Smartphone },
  { key: 'md', label: 'Tablet', Icon: Tablet },
  { key: 'lg', label: 'Desktop', Icon: Monitor },
]

/**
 * Per-device value (PLAN §11.3): edits apply to the device selected in the editor's viewport switcher.
 * A dot marks devices with their own override; "Reset" makes a device inherit again.
 */
export function ResponsiveField<T extends string>({
  field,
  value,
  onChange,
  readOnly,
  options,
  fallback,
}: FieldRenderProps<Responsive<T> | undefined> & { options: { value: T; label: string }[]; fallback: T }) {
  const ctx = useEditorContext()
  const [device, setDevice] = useState<Device>(ctx.device)
  useEffect(() => {
    setDevice(ctx.device)
  }, [ctx.device])
  const v: Responsive<T> = value ?? { base: fallback }
  const own = (d: Device) => (d === 'base' ? true : v[d] !== undefined)
  const effective = (d: Device): T =>
    d === 'lg' ? (v.lg ?? v.md ?? v.base) : d === 'md' ? (v.md ?? v.base) : v.base
  const set = (d: Device, next: T | undefined) => {
    const out = { ...v, [d]: next }
    if (next === undefined) delete out[d]
    onChange(out as Responsive<T>)
  }
  return (
    <FieldLabel label={field.label ?? ''} el="div" readOnly={readOnly}>
      <div className="space-y-2">
        <div className="flex items-center gap-1 rounded-lg bg-subtle p-0.5" role="tablist">
          {DEVICES.map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={device === key}
              title={label}
              onClick={() => setDevice(key)}
              className={cn(
                'relative grid h-7 flex-1 place-items-center rounded-md text-muted transition-colors',
                device === key && 'bg-surface text-fg shadow-[0_1px_2px_rgb(0_0_0/0.06)]',
              )}
            >
              <Icon className="size-3.5" strokeWidth={1.5} />
              <span className="sr-only">{label}</span>
              {key !== 'base' && own(key) && (
                <span className="absolute top-1 end-2 size-1.5 rounded-full bg-accent" />
              )}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              disabled={readOnly}
              onClick={() => set(device, o.value)}
              className={cn(
                'min-h-8 rounded-md border px-2.5 text-xs transition-colors',
                effective(device) === o.value
                  ? own(device)
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-dashed border-accent/60 text-accent'
                  : 'text-muted hover:border-fg/25',
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
        {device !== 'base' && (
          <p className="flex items-center justify-between text-[11px] text-muted">
            {own(device)
              ? 'Overridden on this device'
              : `Inherits from ${device === 'lg' ? 'tablet' : 'mobile'}`}
            {own(device) && (
              <button
                type="button"
                onClick={() => set(device, undefined)}
                className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
              >
                <RotateCcw className="size-3" /> Reset
              </button>
            )}
          </p>
        )}
      </div>
    </FieldLabel>
  )
}
