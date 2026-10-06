'use client'
import type { IntakeField } from '@spa/db'
import { ArrowDown, ArrowUp, Plus, Sparkles, Trash2 } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { ActionForm, Field, FieldError, SubmitButton } from '@/components/ui/form'
import { Checkbox, Input, Label, Select, Textarea } from '@/components/ui/input'
import { toast } from '@/components/ui/toast'
import { applyRecommendedIntakeAction, saveIntakeTemplateAction } from './actions'

type Row = {
  uid: string
  key: string
  en: string
  ar: string
  type: IntakeField['type']
  options: string
  required: boolean
}

const TYPE_LABEL: Record<IntakeField['type'], string> = {
  yesno: 'Yes / no',
  text: 'Short answer',
  textarea: 'Long answer',
  select: 'Choice',
}

const slugKey = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^(\d)/, 'q_$1')
    .slice(0, 40) || 'question'

let seq = 0
const uid = () => `r${++seq}`

const toRow = (f: IntakeField): Row => ({
  uid: uid(),
  key: f.key,
  en: f.label.en,
  ar: f.label.ar ?? '',
  type: f.type,
  options: (f.options ?? []).join(', '),
  required: Boolean(f.required),
})

export function IntakeEditor({
  slug,
  initial,
}: {
  slug: string
  initial: { name: string; fields: IntakeField[]; waiver: { en: string; ar?: string } }
}) {
  const [rows, setRows] = useState<Row[]>(() => initial.fields.map(toRow))
  const patch = (id: string, p: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.uid === id ? { ...r, ...p } : r)))
  const move = (i: number, d: -1 | 1) =>
    setRows((rs) => {
      const next = [...rs]
      const [r] = next.splice(i, 1)
      next.splice(i + d, 0, r!)
      return next
    })

  const fieldsJson = JSON.stringify(
    rows.map((r) => ({
      key: r.key || slugKey(r.en),
      label: r.ar.trim() ? { en: r.en, ar: r.ar } : { en: r.en },
      type: r.type,
      ...(r.type === 'select'
        ? {
            options: r.options
              .split(',')
              .map((o) => o.trim())
              .filter(Boolean),
          }
        : {}),
      required: r.required,
    })),
  )

  return (
    <ActionForm action={saveIntakeTemplateAction.bind(null, slug)} className="grid gap-6 lg:grid-cols-12">
      <input type="hidden" name="fields" value={fieldsJson} />
      <Card className="lg:col-span-7 xl:col-span-8">
        <CardHeader
          title="Questions"
          description="Asked in the client’s language. Arabic labels fall back to English when empty."
          action={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-11 sm:h-8"
              onClick={() =>
                setRows((rs) => [
                  ...rs,
                  { uid: uid(), key: '', en: '', ar: '', type: 'yesno', options: '', required: false },
                ])
              }
            >
              <Plus /> Add question
            </Button>
          }
        />
        <CardBody className="space-y-3">
          <FieldError name="fields" />
          {rows.length === 0 && (
            <p className="rounded-lg bg-subtle px-4 py-6 text-center text-sm text-muted">No questions yet.</p>
          )}
          <ol className="space-y-3">
            <AnimatePresence initial={false}>
              {rows.map((r, i) => (
                <motion.li
                  key={r.uid}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  className="rounded-xl border bg-bg/60 p-4 sm:p-5"
                  data-testid="intake-question"
                >
                  <div className="mb-4 flex items-center justify-between gap-2">
                    <span className="text-xs font-medium uppercase tracking-[0.06em] text-muted">
                      Question {i + 1}
                    </span>
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-11 sm:size-8"
                        aria-label="Move up"
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-11 sm:size-8"
                        aria-label="Move down"
                        disabled={i === rows.length - 1}
                        onClick={() => move(i, 1)}
                      >
                        <ArrowDown />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-11 hover:text-danger sm:size-8"
                        aria-label="Remove question"
                        onClick={() => setRows((rs) => rs.filter((x) => x.uid !== r.uid))}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-12">
                    <div className="space-y-1.5 sm:col-span-6">
                      <Label htmlFor={`${r.uid}-en`}>Label (English)</Label>
                      <Input
                        id={`${r.uid}-en`}
                        value={r.en}
                        onChange={(e) => patch(r.uid, { en: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1.5 sm:col-span-6">
                      <Label htmlFor={`${r.uid}-ar`}>Label (Arabic)</Label>
                      <Input
                        id={`${r.uid}-ar`}
                        dir="rtl"
                        lang="ar"
                        value={r.ar}
                        onChange={(e) => patch(r.uid, { ar: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1.5 sm:col-span-4">
                      <Label htmlFor={`${r.uid}-type`}>Answer type</Label>
                      <Select
                        id={`${r.uid}-type`}
                        value={r.type}
                        onChange={(e) => patch(r.uid, { type: e.target.value as Row['type'] })}
                      >
                        {Object.entries(TYPE_LABEL).map(([v, l]) => (
                          <option key={v} value={v}>
                            {l}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="space-y-1.5 sm:col-span-5">
                      <Label htmlFor={`${r.uid}-key`}>Key</Label>
                      <Input
                        id={`${r.uid}-key`}
                        value={r.key}
                        placeholder={slugKey(r.en || 'question')}
                        className="font-mono text-[13px]"
                        onChange={(e) =>
                          patch(r.uid, { key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })
                        }
                      />
                    </div>
                    <label className="flex min-h-11 items-center gap-2.5 text-sm sm:col-span-3 sm:mt-6">
                      <Checkbox
                        checked={r.required}
                        onChange={(e) => patch(r.uid, { required: e.target.checked })}
                      />
                      Required
                    </label>
                    {r.type === 'select' && (
                      <div className="space-y-1.5 sm:col-span-12">
                        <Label htmlFor={`${r.uid}-opts`}>Options</Label>
                        <Input
                          id={`${r.uid}-opts`}
                          value={r.options}
                          placeholder="Light, Medium, Firm"
                          onChange={(e) => patch(r.uid, { options: e.target.value })}
                        />
                        <p className="text-[13px] text-muted">Separate with commas.</p>
                      </div>
                    )}
                  </div>
                </motion.li>
              ))}
            </AnimatePresence>
          </ol>
        </CardBody>
      </Card>
      <div className="space-y-6 lg:col-span-5 xl:col-span-4">
        <Card className="lg:sticky lg:top-6">
          <CardHeader title="Form & waiver" description="Shown above the signature box." />
          <CardBody className="space-y-5">
            <Field label="Form name" name="name">
              <Input id="name" name="name" defaultValue={initial.name} required />
            </Field>
            <Field label="Waiver (English)" name="waiverEn">
              <Textarea id="waiverEn" name="waiverEn" rows={7} defaultValue={initial.waiver.en} />
            </Field>
            <Field label="Waiver (Arabic)" name="waiverAr">
              <Textarea
                id="waiverAr"
                name="waiverAr"
                dir="rtl"
                lang="ar"
                rows={7}
                defaultValue={initial.waiver.ar ?? ''}
              />
            </Field>
            <SubmitButton className="w-full" size="lg">
              Save new version
            </SubmitButton>
          </CardBody>
        </Card>
      </div>
    </ActionForm>
  )
}

export function RecommendedButton({ slug, hasTemplate }: { slug: string; hasTemplate: boolean }) {
  const [pending, start] = useTransition()
  return (
    <Button
      variant={hasTemplate ? 'secondary' : 'primary'}
      pending={pending}
      onClick={() => {
        if (hasTemplate && !window.confirm('Replace the current questions with the recommended form?')) return
        start(async () => {
          const r = await applyRecommendedIntakeAction(slug)
          if (r?.ok) toast.success(r.message ?? 'Saved')
          else if (r) toast.error(r.error)
        })
      }}
    >
      <Sparkles /> Use recommended template
    </Button>
  )
}
