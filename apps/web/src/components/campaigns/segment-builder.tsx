'use client'
import { Loader2, Plus, Sparkles, Users, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'
import { previewSegmentAction, saveSegmentAction } from '@/app/dashboard/[tenant]/campaigns/actions'
import { Badge } from '@/components/ui/badge'
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/card'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { Input, Select } from '@/components/ui/input'
import { NumberTicker } from '@/components/ui/motion'
import { duration, ease } from '@/lib/motion'
import { cn, formatDate } from '@/lib/utils'
import {
  completeRules,
  GENDER_LABEL,
  LANGUAGE_LABEL,
  RULE_DEFS,
  RULE_GROUPS,
  type RuleKind,
  SEGMENT_PRESETS,
  type SegmentRule,
} from './rules'

type Row = { key: number; rule: SegmentRule }
type Preview = {
  count: number
  sample: { id: string; name: string; phone: string; language: string; lastVisitAt: string | null }[]
}

let nextKey = 1
const toRows = (rules: SegmentRule[]): Row[] => rules.map((rule) => ({ key: nextKey++, rule }))

export function SegmentBuilder({
  slug,
  segmentId,
  initialName,
  initialRules,
  services,
  tags,
}: {
  slug: string
  segmentId: string | null
  initialName: string
  initialRules: SegmentRule[]
  services: { id: string; name: string }[]
  tags: string[]
}) {
  const router = useRouter()
  const [name, setName] = useState(initialName)
  const [rows, setRows] = useState<Row[]>(() => toRows(initialRules))
  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [loading, startPreview] = useTransition()
  const request = useRef(0)

  const rules = rows.map((r) => r.rule)
  const ready = completeRules(rules)
  const rulesKey = JSON.stringify(ready)

  // Live preview, debounced; stale responses are ignored.
  useEffect(() => {
    const id = ++request.current
    const timer = setTimeout(() => {
      startPreview(async () => {
        const res = await previewSegmentAction(slug, JSON.parse(rulesKey))
        if (id !== request.current) return
        if (res?.ok) {
          setPreview(res.data as Preview)
          setPreviewError(null)
        } else setPreviewError(res?.error ?? 'Preview unavailable')
      })
    }, 300)
    return () => {
      clearTimeout(timer)
    }
  }, [slug, rulesKey])

  const update = (key: number, rule: SegmentRule) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, rule } : r)))
  const remove = (key: number) => setRows((rs) => rs.filter((r) => r.key !== key))
  const add = (kind: RuleKind) => {
    const rule = { ...RULE_DEFS[kind].defaults } as SegmentRule
    if (rule.kind === 'service' && services[0]) rule.serviceId = services[0].id
    if (rule.kind === 'tag' && tags[0]) rule.tag = tags[0]
    setRows((rs) => [...rs, { key: nextKey++, rule }])
  }
  const applyPreset = (key: string) => {
    const preset = SEGMENT_PRESETS.find((p) => p.key === key)
    if (!preset) return
    setRows(toRows(preset.rules))
    setName(preset.name)
  }

  return (
    <div className="grid gap-6 lg:grid-cols-12 lg:gap-8">
      <div className="min-w-0 space-y-6 lg:col-span-7">
        <Card>
          <CardHeader
            title="Start from a preset"
            description="Pick one to fill in the conditions, then adjust."
          />
          <CardBody className="flex gap-2 overflow-x-auto sm:flex-wrap sm:overflow-visible">
            {SEGMENT_PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => applyPreset(p.key)}
                title={p.description}
                className={cn(
                  'inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-4 text-sm transition-[background-color,border-color,transform] duration-150 hover:-translate-y-px hover:border-accent/40 hover:bg-accent-soft active:scale-[0.98]',
                  name === p.name && 'border-accent/50 bg-accent-soft text-fg',
                )}
              >
                <Sparkles className="size-3.5 text-accent" strokeWidth={1.75} />
                {p.name}
              </button>
            ))}
          </CardBody>
        </Card>

        <Card>
          <ActionForm
            action={saveSegmentAction.bind(null, slug, segmentId)}
            onSuccess={(r) => {
              const href = r.data?.href
              if (typeof href === 'string') router.push(href)
            }}
          >
            <input type="hidden" name="rules" value={JSON.stringify(rules)} />
            <CardHeader
              title="Who should be in it"
              description="Clients must match every condition."
              action={
                preview ? (
                  // Phones: the full preview sits below, so keep the live count in view here.
                  <Badge tone="accent" className="lg:hidden" aria-live="polite">
                    {preview.count} {preview.count === 1 ? 'client' : 'clients'}
                  </Badge>
                ) : null
              }
            />
            <CardBody className="space-y-6">
              <Field label="Segment name" name="name">
                <Input
                  id="name"
                  name="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Win back — summer"
                  maxLength={60}
                />
              </Field>

              <div className="space-y-2">
                <p className="text-sm font-medium">Conditions</p>
                {rows.length === 0 && (
                  <p className="rounded-lg border border-dashed px-4 py-5 text-sm text-muted">
                    No conditions yet — this segment includes every client who can receive marketing.
                  </p>
                )}
                <ol className="space-y-2">
                  <AnimatePresence initial={false}>
                    {rows.map((row, i) => (
                      <motion.li
                        key={row.key}
                        layout
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, height: 0, marginTop: 0 }}
                        transition={{ duration: duration.base, ease }}
                      >
                        {i > 0 && (
                          <p className="py-1 ps-4 text-xs font-medium uppercase tracking-[0.08em] text-muted">
                            and
                          </p>
                        )}
                        <RuleRow
                          rule={row.rule}
                          services={services}
                          tags={tags}
                          onChange={(rule) => update(row.key, rule)}
                          onRemove={() => remove(row.key)}
                        />
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ol>
                <div className="relative pt-2">
                  <Plus
                    className="pointer-events-none absolute start-3.5 top-[calc(50%+4px)] size-4 -translate-y-1/2 text-accent"
                    strokeWidth={1.75}
                  />
                  <Select
                    aria-label="Add a condition"
                    value=""
                    onChange={(e) => {
                      if (e.target.value) add(e.target.value as RuleKind)
                    }}
                    className="h-11 ps-10"
                  >
                    <option value="">Add a condition…</option>
                    {RULE_GROUPS.map((g) => (
                      <optgroup key={g} label={g}>
                        {(Object.keys(RULE_DEFS) as RuleKind[])
                          .filter((k) => RULE_DEFS[k].group === g)
                          .map((k) => (
                            <option key={k} value={k}>
                              {RULE_DEFS[k].label}
                            </option>
                          ))}
                      </optgroup>
                    ))}
                  </Select>
                </div>
              </div>
            </CardBody>
            <CardFooter>
              <SubmitButton variant="secondary" name="intent" value="save" className="w-full sm:w-auto">
                Save segment
              </SubmitButton>
              <SubmitButton name="intent" value="campaign" className="w-full sm:w-auto">
                Save &amp; write campaign
              </SubmitButton>
            </CardFooter>
          </ActionForm>
        </Card>
      </div>

      <aside className="min-w-0 lg:col-span-5">
        <Card className="lg:sticky lg:top-6" aria-label="Segment preview">
          <CardHeader
            title="Preview"
            action={
              loading ? (
                <Loader2 className="size-4 animate-spin text-muted" strokeWidth={1.75} aria-hidden />
              ) : null
            }
          />
          <CardBody className="space-y-5">
            <div>
              <p
                className="text-[40px] font-semibold leading-none tracking-tight"
                data-testid="segment-count"
              >
                {preview ? <NumberTicker value={preview.count} /> : '—'}
              </p>
              <p className="mt-2 text-sm text-muted">
                {preview?.count === 1 ? 'client matches' : 'clients match'}
                {ready.length < rules.length && ' · finish the highlighted condition'}
              </p>
              {previewError && <p className="mt-2 text-[13px] text-danger">{previewError}</p>}
            </div>
            {preview && preview.sample.length > 0 ? (
              <ul className="divide-y rounded-lg border">
                {preview.sample.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 font-medium">
                        <span className="truncate">{c.name}</span>
                        {c.language === 'ar' && <Badge tone="accent">AR</Badge>}
                      </p>
                      <p className="text-[13px] text-muted tabular-nums" dir="ltr">
                        {c.phone}
                      </p>
                    </div>
                    <p className="shrink-0 text-end text-[13px] text-muted">
                      <span className="hidden sm:inline">{c.lastVisitAt ? 'Last visit ' : ''}</span>
                      {c.lastVisitAt ? formatDate(c.lastVisitAt) : 'No visit yet'}
                    </p>
                  </li>
                ))}
              </ul>
            ) : preview ? (
              <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-8 text-center">
                <Users className="size-5 text-muted" strokeWidth={1.5} />
                <p className="text-sm text-muted">Nobody matches yet. Try loosening a condition.</p>
              </div>
            ) : null}
            {preview && preview.count > preview.sample.length && (
              <p className="text-[13px] text-muted">Showing the first {preview.sample.length}.</p>
            )}
            <p className="text-[13px] leading-relaxed text-muted">
              Only clients who have visited, have a mobile number and can receive marketing are counted —
              opted-out, blocklisted and clients tagged “no-marketing” are always left out.
            </p>
          </CardBody>
        </Card>
      </aside>
    </div>
  )
}

function RuleRow({
  rule,
  services,
  tags,
  onChange,
  onRemove,
}: {
  rule: SegmentRule
  services: { id: string; name: string }[]
  tags: string[]
  onChange: (rule: SegmentRule) => void
  onRemove: () => void
}) {
  const def = RULE_DEFS[rule.kind]
  const incomplete = (rule.kind === 'service' && !rule.serviceId) || (rule.kind === 'tag' && !rule.tag.trim())
  const control = 'h-10 w-auto min-w-0'
  let input: React.ReactNode = null
  if (def.number) {
    const { key, min, max } = def.number
    input = (
      <NumberInput
        label={def.label}
        min={min}
        max={max}
        value={(rule as Record<string, unknown>)[key] as number}
        onChange={(n) => onChange({ ...rule, [key]: n } as SegmentRule)}
        className={cn(control, key === 'aed' ? 'w-28' : 'w-20')}
      />
    )
  } else if (rule.kind === 'service') {
    input = (
      <Select
        aria-label="Treatment"
        value={rule.serviceId}
        onChange={(e) => onChange({ ...rule, serviceId: e.target.value })}
        className={cn(control, 'max-w-full')}
      >
        <option value="">Choose a treatment…</option>
        {services.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </Select>
    )
  } else if (rule.kind === 'gender') {
    input = (
      <Select
        aria-label="Gender"
        value={rule.gender}
        onChange={(e) => onChange({ ...rule, gender: e.target.value as typeof rule.gender })}
        className={control}
      >
        {Object.entries(GENDER_LABEL).map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </Select>
    )
  } else if (rule.kind === 'language') {
    input = (
      <Select
        aria-label="Language"
        value={rule.language}
        onChange={(e) => onChange({ ...rule, language: e.target.value as typeof rule.language })}
        className={control}
      >
        {Object.entries(LANGUAGE_LABEL).map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </Select>
    )
  } else if (rule.kind === 'tag') {
    input = (
      <>
        <Input
          aria-label="Tag"
          list="segment-tags"
          value={rule.tag}
          placeholder="vip"
          maxLength={40}
          onChange={(e) => onChange({ ...rule, tag: e.target.value })}
          className={cn(control, 'w-36')}
        />
        <datalist id="segment-tags">
          {tags.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </>
    )
  }
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg border bg-surface py-2 ps-4 pe-2 transition-colors',
        incomplete && 'border-warning/50',
      )}
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-2 text-sm">
        <span>{def.before}</span>
        {input}
        {def.after && <span>{def.after}</span>}
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove “${def.label}”`}
        className="grid size-11 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-subtle hover:text-fg"
      >
        <X className="size-4" strokeWidth={1.5} />
      </button>
    </div>
  )
}

/** Number box that lets people clear and retype; only in-range values reach the rule. */
function NumberInput({
  label,
  value,
  min,
  max,
  onChange,
  className,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (n: number) => void
  className?: string
}) {
  const [text, setText] = useState(String(value))
  useEffect(() => {
    setText((t) => (Number(t) === value ? t : String(value)))
  }, [value])
  return (
    <Input
      type="number"
      inputMode="numeric"
      aria-label={label}
      min={min}
      max={max}
      value={text}
      onChange={(e) => {
        setText(e.target.value)
        const n = Number(e.target.value)
        if (e.target.value !== '' && Number.isFinite(n) && n >= min && n <= max) onChange(n)
      }}
      onBlur={() => setText(String(value))}
      className={cn('tabular-nums', className)}
    />
  )
}
