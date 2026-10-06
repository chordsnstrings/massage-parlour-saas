'use client'
import { FieldLabel } from '@puckeditor/core'
import { Monitor, RotateCcw, Smartphone, Tablet } from 'lucide-react'
import { createContext, useContext, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import type { Bi, Device, Locale, Responsive } from './types'

/** Editor-wide state the custom fields read: which content language and device are being edited. */
export const EditorContext = createContext<{ locale: Locale; device: Device }>({ locale: 'en', device: 'lg' })
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
  const { locale } = useEditorContext()
  const v = value ?? { en: '' }
  const current = locale === 'ar' ? (v.ar ?? '') : v.en
  const set = (text: string) => onChange({ ...v, [locale]: text })
  const props = {
    id,
    value: current,
    readOnly,
    dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const),
    lang: locale,
    placeholder: locale === 'ar' ? v.en || 'بالعربية' : '',
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(e.target.value),
    className: cn(control, multiline && 'min-h-24 resize-y leading-relaxed'),
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
      {multiline ? <textarea rows={4} {...props} /> : <input type="text" {...props} />}
      {locale === 'ar' && !v.ar && v.en && !readOnly && (
        <button
          type="button"
          onClick={() => set(v.en)}
          className="mt-1.5 min-h-8 text-xs font-medium text-accent hover:underline"
        >
          Copy from English
        </button>
      )}
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
  useEffect(() => setDevice(ctx.device), [ctx.device])
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
