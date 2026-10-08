'use client'
import type { ImportField, ImportKind } from '@spa/services'
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  RotateCcw,
  Upload,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import Link from 'next/link'
import { useRef, useState } from 'react'
import { Card, Grid, Pill, Stat } from '@/components/crm'
import { Button } from '@/components/ui/button'
import { Label, Select } from '@/components/ui/input'
import { type Column, DataTable } from '@/components/ui/table'
import { toast } from '@/components/ui/toast'
import { useI18n } from '@/i18n/client'
import { duration, ease } from '@/lib/motion'
import { cn } from '@/lib/utils'

const MAX_BYTES = 5 * 1024 * 1024

type PreviewRow = {
  row: number
  display: Record<string, string>
  errors: string[]
  dupOfRow: number | null
  exists: boolean
}
type Preview = {
  fileName: string
  headers: string[]
  samples: string[]
  mapping: string[]
  missing: string[]
  counts: { total: number; errors: number; fileDuplicates: number; existing: number }
  rows: PreviewRow[]
}
type Summary = {
  total: number
  created: number
  updated: number
  skipped: number
  errorCount: number
  errors: { row: number; message: string }[]
}
type Mode = 'update' | 'skip'

type Translate = ReturnType<typeof useI18n>['t']

function downloadText(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function Steps({ step, t }: { step: 0 | 1 | 2; t: Translate }) {
  return (
    <ol className="flex items-center gap-2 text-sm sm:gap-3" aria-label={t('settings.data.wizard.steps')}>
      {[
        t('settings.data.wizard.upload'),
        t('settings.data.wizard.check'),
        t('settings.data.wizard.done'),
      ].map((label, i) => (
        <li
          key={label}
          className="flex items-center gap-2 sm:gap-3"
          aria-current={i === step ? 'step' : undefined}
        >
          {i > 0 && (
            <span aria-hidden className={cn('h-px w-5 sm:w-10', i <= step ? 'bg-accent' : 'bg-border')} />
          )}
          <span
            className={cn(
              'grid size-6 place-items-center rounded-full border text-xs font-medium transition-colors duration-200',
              i < step && 'border-accent bg-accent text-accent-fg',
              i === step && 'border-accent text-accent',
              i > step && 'text-muted',
            )}
          >
            {i < step ? <Check className="size-3.5" strokeWidth={2} /> : i + 1}
          </span>
          <span className={cn(i === step ? 'font-medium text-fg' : 'text-muted')}>{label}</span>
        </li>
      ))}
    </ol>
  )
}

export function ImportWizard({
  kind,
  fields,
  uploadUrl,
  templateUrl,
  done,
  historyHref,
}: {
  kind: ImportKind
  fields: ImportField[]
  uploadUrl: string
  templateUrl: string
  done: { label: string; href: string }
  historyHref: string
}) {
  const { t, fmt } = useI18n()
  const w = (key: string, params?: Record<string, string | number>) =>
    t(`settings.data.wizard.${key}` as Parameters<Translate>[0], params)
  const rowsText = (n: number) => w('rows', { count: n })
  /** Field label in the viewer's language (services keep the English label as the fallback). */
  const label = (f: ImportField) => t.maybe(`settings.data.fields.${kind}.${f.key}`) ?? f.label
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [mapping, setMapping] = useState<string[]>([])
  const [mode, setMode] = useState<Mode>('update')
  const [busy, setBusy] = useState<'preview' | 'commit' | null>(null)
  const [drag, setDrag] = useState(false)
  const [result, setResult] = useState<{ summary: Summary; errorCsv: string | null } | null>(null)
  const request = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const fieldByKey = new Map(fields.map((f) => [f.key, f]))

  async function send(body: {
    file: File
    mode: 'preview' | 'commit'
    mapping?: string[]
    onDuplicate?: Mode
  }) {
    const fd = new FormData()
    fd.set('kind', kind)
    fd.set('mode', body.mode)
    fd.set('file', body.file)
    if (body.mapping) fd.set('mapping', JSON.stringify(body.mapping))
    if (body.onDuplicate) fd.set('onDuplicate', body.onDuplicate)
    try {
      const res = await fetch(uploadUrl, { method: 'POST', body: fd })
      return (await res.json()) as
        | { ok: true; preview?: Preview; summary?: Summary; errorCsv?: string | null }
        | { ok: false; error: string }
    } catch {
      return { ok: false as const, error: w('generic') }
    }
  }

  async function loadPreview(f: File, map?: string[]) {
    const id = ++request.current
    setBusy('preview')
    const res = await send({ file: f, mode: 'preview', mapping: map })
    if (id !== request.current) return
    setBusy(null)
    if (!res.ok || !res.preview) {
      toast.error(res.ok ? w('unreadable') : res.error)
      return
    }
    setPreview(res.preview)
    setMapping(res.preview.mapping)
  }

  function choose(f: File | undefined) {
    if (!f) return
    if (f.size > MAX_BYTES) {
      toast.error(w('tooLarge'))
      return
    }
    setFile(f)
    setPreview(null)
    void loadPreview(f)
  }

  function remap(col: number, key: string) {
    const next = mapping.map((k, i) => (i === col ? key : key && k === key ? '' : k))
    setMapping(next)
    if (file) void loadPreview(file, next)
  }

  async function commit() {
    if (!file) return
    setBusy('commit')
    const res = await send({ file, mode: 'commit', mapping, onDuplicate: mode })
    setBusy(null)
    if (!res.ok || !res.summary) {
      toast.error(res.ok ? w('failed') : res.error)
      return
    }
    setResult({ summary: res.summary, errorCsv: res.errorCsv ?? null })
    toast.success(w('finished'))
  }

  function reset() {
    request.current++
    setFile(null)
    setPreview(null)
    setMapping([])
    setResult(null)
    setBusy(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  const step: 0 | 1 | 2 = result ? 2 : preview ? 1 : 0
  const c = preview?.counts
  const ready = c ? c.total - c.errors - c.fileDuplicates - (mode === 'skip' ? c.existing : 0) : 0
  // First + last name are previewed as the combined name they are saved as.
  const shown = [
    ...new Set(mapping.map((k) => (k === 'firstName' || k === 'lastName' ? 'name' : k))),
  ].flatMap((k) => {
    const f = fieldByKey.get(k)
    return f && !f.ignored ? [f] : []
  })
  const LONG = new Set(['notes', 'description'])
  const ignoredMapped = mapping.some((k) => fieldByKey.get(k)?.ignored)

  const statusOf = (r: PreviewRow) =>
    r.errors.length ? (
      <Pill tone="bad">{w('badge.error')}</Pill>
    ) : r.dupOfRow != null ? (
      <Pill>{w('badge.repeats', { row: r.dupOfRow })}</Pill>
    ) : r.exists ? (
      mode === 'update' ? (
        <Pill tone="acc">{w('badge.update')}</Pill>
      ) : (
        <Pill>{w('badge.skip')}</Pill>
      )
    ) : (
      <Pill tone="ok">{w('badge.new')}</Pill>
    )

  const columns: Column<PreviewRow>[] = [
    {
      key: '_row',
      header: w('row'),
      className: 'w-16',
      cell: (r) => <span className="tabular-nums text-muted">{r.row}</span>,
    },
    ...shown.map((f, i) => ({
      key: f.key,
      header: label(f),
      primary: i === 0,
      className: LONG.has(f.key) ? 'min-w-48' : 'whitespace-nowrap',
      cell: (r: PreviewRow) => <span className="break-words">{r.display[f.key] || '—'}</span>,
    })),
    {
      key: '_status',
      header: w('status'),
      className: 'min-w-52',
      cell: (r) => (
        <span className="inline-flex flex-col items-end gap-1.5 md:items-start">
          {statusOf(r)}
          {r.errors.length > 0 && <span className="text-[13px] text-danger">{r.errors.join(' · ')}</span>}
        </span>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <Steps step={step} t={t} />
      <AnimatePresence mode="wait" initial={false}>
        {step === 0 && (
          <motion.div
            key="upload"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: duration.base, ease }}
            className="grid gap-6 lg:grid-cols-12"
          >
            <Card className="lg:col-span-8">
              <label
                htmlFor="csv-file"
                data-drag={drag}
                onDragOver={(e) => {
                  e.preventDefault()
                  setDrag(true)
                }}
                onDragLeave={() => {
                  setDrag(false)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  setDrag(false)
                  choose(e.dataTransfer.files[0])
                }}
                className="flex min-h-60 cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-subtle/40 px-6 py-10 text-center transition-[border-color,background-color] duration-200 focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/15 hover:border-accent/60 data-[drag=true]:border-accent data-[drag=true]:bg-accent-soft/60"
              >
                <span className="grid size-12 place-items-center rounded-full bg-surface text-accent shadow-soft">
                  {busy ? (
                    <Loader2 className="size-5 animate-spin" strokeWidth={1.5} />
                  ) : (
                    <Upload className="size-5" strokeWidth={1.5} />
                  )}
                </span>
                <span className="text-[15px] font-medium">
                  {busy ? (
                    w('reading', { name: file?.name ?? w('file') })
                  ) : (
                    <>
                      {w('drop')}{' '}
                      <span className="text-accent underline underline-offset-4">{w('browse')}</span>
                    </>
                  )}
                </span>
                <span className="max-w-sm text-sm text-muted">{w('dropHint')}</span>
                <input
                  ref={inputRef}
                  id="csv-file"
                  type="file"
                  accept=".csv,.txt,text/csv"
                  aria-label={w('csvFile')}
                  className="sr-only"
                  disabled={busy != null}
                  onChange={(e) => {
                    choose(e.target.files?.[0])
                  }}
                />
              </label>
            </Card>
            <Card className="lg:col-span-4" title={w('recognised')} sub={w('recognisedSub')}>
              <div className="space-y-5">
                <ul className="flex flex-wrap gap-2">
                  {fields.map((f) => (
                    <li key={f.key}>
                      <Pill tone={f.required ? 'acc' : 'neutral'}>
                        {label(f)}
                        {f.required && ' *'}
                      </Pill>
                    </li>
                  ))}
                </ul>
                <Button asChild variant="secondary" className="h-11 w-full md:h-10">
                  <a href={templateUrl}>
                    <Download strokeWidth={1.5} /> {w('downloadTemplate')}
                  </a>
                </Button>
              </div>
            </Card>
          </motion.div>
        )}

        {step === 1 && preview && c && (
          <motion.div
            key="check"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: duration.base, ease }}
            className="space-y-6"
          >
            <Card>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
                    <FileSpreadsheet className="size-4" strokeWidth={1.5} />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-medium">{preview.fileName}</p>
                    <p className="text-sm text-muted" aria-live="polite">
                      {w('counts', {
                        rows: rowsText(c.total),
                        errors: fmt.number(c.errors),
                        existing: fmt.number(c.existing),
                      })}
                      {c.fileDuplicates ? ` · ${w('repeated', { count: fmt.number(c.fileDuplicates) })}` : ''}
                    </p>
                  </div>
                </div>
                <Button variant="ghost" onClick={reset} className="h-11 self-start sm:self-auto md:h-10">
                  <RotateCcw strokeWidth={1.5} /> {w('another')}
                </Button>
              </div>
            </Card>

            <Card
              className={cn('transition-opacity duration-200', busy === 'preview' && 'opacity-70')}
              title={w('match')}
              sub={w('matchSub')}
              actions={
                busy === 'preview' ? <Loader2 className="size-4 animate-spin text-muted" aria-hidden /> : null
              }
            >
              <div className="space-y-5">
                <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-3">
                  {preview.headers.map((h, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional and never reorder
                    <div key={i} className="min-w-0 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <Label htmlFor={`map-${i}`} className="truncate">
                          {h}
                        </Label>
                        {mapping[i] && !fieldByKey.get(mapping[i]!)?.ignored && (
                          <Check className="size-3.5 shrink-0 text-accent" strokeWidth={2} aria-hidden />
                        )}
                      </div>
                      <Select
                        id={`map-${i}`}
                        value={mapping[i] ?? ''}
                        onChange={(e) => {
                          remap(i, e.target.value)
                        }}
                        className="h-11 md:h-10"
                      >
                        <option value="">{w('dontImport')}</option>
                        {fields.map((f) => (
                          <option key={f.key} value={f.key}>
                            {label(f)}
                            {f.required ? ' *' : ''}
                          </option>
                        ))}
                      </Select>
                      <p className="truncate text-[13px] text-muted">
                        {preview.samples[i] ? w('sample', { value: preview.samples[i]! }) : w('emptyColumn')}
                      </p>
                    </div>
                  ))}
                </div>
                {preview.missing.length > 0 && (
                  <p className="flex items-start gap-2 rounded-lg bg-warning-soft px-4 py-3 text-sm text-warning">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" strokeWidth={1.5} />
                    {w('missing', { fields: preview.missing.join(', ') })}
                  </p>
                )}
                {ignoredMapped && <p className="text-[13px] text-muted">{w('emailIgnored')}</p>}
              </div>
            </Card>

            <Card title={w(`copy.${kind}.question`)} sub={w('matches', { count: c.existing })}>
              <div>
                <fieldset className="grid gap-3 sm:grid-cols-2">
                  <legend className="sr-only">{w(`copy.${kind}.question`)}</legend>
                  {(
                    [
                      ['update', w(`copy.${kind}.update`), w(`copy.${kind}.updateHint`)],
                      ['skip', w('skip'), w('onlyNew')],
                    ] as const
                  ).map(([value, text, hint]) => (
                    <label
                      key={value}
                      className={cn(
                        'flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border px-4 py-3.5 transition-[border-color,background-color] duration-150',
                        mode === value ? 'border-accent bg-accent-soft/50' : 'hover:border-fg/20',
                      )}
                    >
                      <input
                        type="radio"
                        name="onDuplicate"
                        value={value}
                        checked={mode === value}
                        onChange={() => {
                          setMode(value)
                        }}
                        className="mt-1 size-4 accent-[var(--accent)]"
                      />
                      <span className="space-y-0.5">
                        <span className="block text-sm font-medium">{text}</span>
                        <span className="block text-[13px] text-muted">{hint}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>
              </div>
            </Card>

            <Card
              title={w('preview')}
              sub={w('previewSub', { count: Math.min(preview.rows.length, 20) })}
              flush
            >
              <DataTable columns={columns} rows={preview.rows} rowKey={(r) => String(r.row)} />
              <div className="flex flex-col-reverse items-stretch gap-3 border-t px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted">
                  {c.errors > 0 ? w('errorRows', { count: c.errors }) : w('noErrors')}
                </p>
                <Button
                  onClick={commit}
                  pending={busy === 'commit'}
                  disabled={busy != null || preview.missing.length > 0 || ready <= 0}
                  className="h-11 md:h-10"
                >
                  {w(`importN.${kind}`, { count: Math.max(ready, 0) })} <ArrowRight strokeWidth={1.5} />
                </Button>
              </div>
            </Card>
          </motion.div>
        )}

        {step === 2 && result && (
          <motion.div
            key="done"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: duration.base, ease }}
            className="space-y-6"
          >
            <Card>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <span className="grid size-11 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
                  <CheckCircle2 className="size-5" strokeWidth={1.5} />
                </span>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <h2 className="text-[15px] font-semibold tracking-tight">{w('finished')}</h2>
                  <p className="text-sm text-muted">
                    {w('finishedBody', {
                      count: result.summary.total,
                      file: preview?.fileName ?? file?.name ?? '',
                    })}
                  </p>
                </div>
              </div>
            </Card>
            <Grid cols="g4">
              <Stat label={w('created')} value={fmt.number(result.summary.created)} />
              <Stat label={w('updated')} value={fmt.number(result.summary.updated)} />
              <Stat label={w('skipped')} value={fmt.number(result.summary.skipped)} />
              <Stat label={w('errors')} value={fmt.number(result.summary.errorCount)} />
            </Grid>
            {result.summary.errorCount > 0 && (
              <Card
                title={w('fix')}
                sub={w('fixSub')}
                actions={
                  result.errorCsv && (
                    <Button
                      variant="secondary"
                      className="h-11 md:h-10"
                      onClick={() => {
                        downloadText(`${kind}-import-errors.csv`, result.errorCsv!)
                      }}
                    >
                      <Download strokeWidth={1.5} /> {w('downloadErrors')}
                    </Button>
                  )
                }
              >
                <div>
                  <ul className="divide-y rounded-lg border text-sm">
                    {result.summary.errors.slice(0, 10).map((e) => (
                      <li key={e.row} className="flex gap-4 px-4 py-3">
                        <span className="w-16 shrink-0 tabular-nums text-muted">
                          {w('rowN', { row: e.row })}
                        </span>
                        <span className="min-w-0 text-danger">{e.message}</span>
                      </li>
                    ))}
                  </ul>
                  {result.summary.errorCount > 10 && (
                    <p className="mt-3 text-[13px] text-muted">
                      {w('more', { count: fmt.number(result.summary.errorCount - 10) })}
                    </p>
                  )}
                </div>
              </Card>
            )}
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button asChild className="h-11 md:h-10">
                <Link href={done.href}>
                  {done.label} <ArrowRight strokeWidth={1.5} />
                </Link>
              </Button>
              <Button variant="secondary" onClick={reset} className="h-11 md:h-10">
                <Upload strokeWidth={1.5} /> {w('importAnother')}
              </Button>
              <Button asChild variant="ghost" className="h-11 md:h-10">
                <Link href={historyHref}>{w('back')}</Link>
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
