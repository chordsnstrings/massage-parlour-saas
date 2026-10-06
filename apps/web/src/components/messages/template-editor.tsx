'use client'
import { Plus, RotateCcw } from 'lucide-react'
import { motion } from 'motion/react'
import { useRef, useState } from 'react'
import { saveTemplateAction } from '@/app/dashboard/[tenant]/messages/actions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardFooter, CardHeader } from '@/components/ui/card'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { Textarea } from '@/components/ui/input'
import { spring } from '@/lib/motion'
import { cn } from '@/lib/utils'
import {
  KIND_HINT,
  KIND_LABEL,
  type MessageKind,
  previewTemplate,
  TEMPLATE_VARIABLES,
  unknownVariables,
  VARIABLE_LABEL,
} from './shared'

type Lang = 'en' | 'ar'
type Pair = Record<Lang, string>

export function TemplateEditor({
  slug,
  kinds,
  defaults,
  saved,
  samples,
}: {
  slug: string
  kinds: MessageKind[]
  defaults: Record<string, Pair>
  /** Current text per kind (the tenant's override, or the default). */
  saved: Record<string, Pair>
  samples: Record<Lang, Record<string, string>>
}) {
  const [kind, setKind] = useState<MessageKind>(kinds[0] ?? 'booking_confirmation')
  const [drafts, setDrafts] = useState<Record<string, Pair>>({})
  const [focused, setFocused] = useState<Lang>('en')
  const refs = { en: useRef<HTMLTextAreaElement>(null), ar: useRef<HTMLTextAreaElement>(null) }

  const current = (k: string) => drafts[k] ?? saved[k] ?? defaults[k] ?? { en: '', ar: '' }
  const value = current(kind)
  const def = defaults[kind] ?? { en: '', ar: '' }
  const isCustom = (k: string) => saved[k]?.en !== defaults[k]?.en || saved[k]?.ar !== defaults[k]?.ar
  const dirty = (k: string) =>
    Boolean(drafts[k]) && (drafts[k]?.en !== saved[k]?.en || drafts[k]?.ar !== saved[k]?.ar)
  const atDefault = value.en === def.en && value.ar === def.ar

  const set = (lang: Lang, text: string) =>
    setDrafts((d) => ({ ...d, [kind]: { ...current(kind), [lang]: text } }))

  const insert = (variable: string) => {
    const el = refs[focused].current
    const token = `{${variable}}`
    const text = value[focused]
    const start = el?.selectionStart ?? text.length
    const end = el?.selectionEnd ?? text.length
    set(focused, text.slice(0, start) + token + text.slice(end))
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(start + token.length, start + token.length)
    })
  }

  return (
    <div className="grid gap-6 lg:grid-cols-12 lg:gap-8">
      <nav aria-label="Message kinds" className="min-w-0 lg:col-span-3">
        <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-col lg:gap-0.5 lg:px-0">
          {kinds.map((k) => (
            <li key={k} className="shrink-0">
              <button
                type="button"
                onClick={() => setKind(k)}
                aria-current={k === kind ? 'true' : undefined}
                className={cn(
                  'relative flex h-11 w-full items-center justify-between gap-3 rounded-lg border px-3.5 text-sm transition-colors lg:h-10 lg:border-transparent',
                  k === kind ? 'text-fg' : 'text-muted hover:bg-subtle/70 hover:text-fg',
                )}
              >
                {k === kind && (
                  <motion.span
                    layoutId="template-kind"
                    transition={spring}
                    className="absolute inset-0 rounded-lg border bg-surface lg:border-transparent lg:bg-subtle"
                  />
                )}
                <span className="relative whitespace-nowrap">{KIND_LABEL[k]}</span>
                {(dirty(k) || isCustom(k)) && (
                  <span
                    className={cn(
                      'relative size-1.5 shrink-0 rounded-full',
                      dirty(k) ? 'bg-warning' : 'bg-accent',
                    )}
                    title={dirty(k) ? 'Unsaved changes' : 'Customised'}
                  />
                )}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <Card className="min-w-0 lg:col-span-9">
        <ActionForm
          key={kind}
          action={saveTemplateAction.bind(null, slug)}
          onSuccess={() =>
            setDrafts((d) => {
              const { [kind]: _, ...rest } = d
              return rest
            })
          }
        >
          <input type="hidden" name="kind" value={kind} />
          <CardHeader
            title={
              <span className="flex flex-wrap items-center gap-2">
                {KIND_LABEL[kind]}
                {isCustom(kind) ? <Badge tone="accent">Customised</Badge> : <Badge>Default</Badge>}
              </span>
            }
            description={KIND_HINT[kind]}
          />
          <div className="px-5 pt-5 sm:px-6">
            <p className="text-[13px] font-medium">Insert a variable</p>
            <p className="mt-0.5 text-[13px] text-muted">
              Adds it where your cursor is in the {focused === 'ar' ? 'Arabic' : 'English'} message.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {TEMPLATE_VARIABLES.map((v) => (
                <button
                  key={v}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insert(v)}
                  title={VARIABLE_LABEL[v]}
                  className="inline-flex h-9 items-center gap-1 rounded-full border bg-surface px-3 font-mono text-xs text-fg transition-[background-color,border-color,transform] duration-150 hover:-translate-y-px hover:border-accent/40 hover:bg-accent-soft active:scale-[0.97]"
                >
                  <Plus className="size-3 text-accent" strokeWidth={2} />
                  {`{${v}}`}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-8 px-5 py-6 sm:px-6 xl:grid-cols-2">
            {(['en', 'ar'] as const).map((lang) => {
              const unknown = unknownVariables(value[lang])
              return (
                <div key={lang} className="min-w-0 space-y-4">
                  <Field
                    label={lang === 'en' ? 'English' : 'Arabic'}
                    name={lang}
                    hint={`${value[lang].length} / 1000`}
                  >
                    <Textarea
                      ref={refs[lang]}
                      id={lang}
                      name={lang}
                      dir={lang === 'ar' ? 'rtl' : 'ltr'}
                      lang={lang}
                      rows={5}
                      value={value[lang]}
                      onFocus={() => setFocused(lang)}
                      onChange={(e) => set(lang, e.target.value)}
                      className="leading-relaxed"
                    />
                  </Field>
                  {unknown.length > 0 && (
                    <p className="text-[13px] text-warning">
                      Unknown {unknown.length === 1 ? 'variable' : 'variables'}:{' '}
                      {unknown.map((u) => `{${u}}`).join(', ')}
                    </p>
                  )}
                  <div>
                    <p className="text-xs font-medium uppercase tracking-[0.06em] text-muted">
                      Preview{lang === 'ar' ? ' (Arabic)' : ''}
                    </p>
                    <div className="mt-2 rounded-xl bg-subtle/70 p-3 sm:p-4">
                      <div
                        data-testid={`preview-${lang}`}
                        dir={lang === 'ar' ? 'rtl' : 'ltr'}
                        className="ms-auto w-fit max-w-[92%] whitespace-pre-wrap break-words rounded-xl rounded-se-sm bg-accent-soft px-3.5 py-2.5 text-sm leading-relaxed text-fg"
                      >
                        {previewTemplate(value[lang], samples[lang] ?? {}) || (
                          <span className="text-muted">Nothing to send yet</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <CardFooter className="justify-between">
            <Button
              type="button"
              variant="ghost"
              disabled={atDefault}
              onClick={() => setDrafts((d) => ({ ...d, [kind]: { ...def } }))}
            >
              <RotateCcw /> Reset to default
            </Button>
            <div className="flex items-center gap-3">
              {dirty(kind) && (
                <span className="hidden text-[13px] text-muted sm:inline">Unsaved changes</span>
              )}
              <SubmitButton disabled={!dirty(kind)}>Save template</SubmitButton>
            </div>
          </CardFooter>
        </ActionForm>
      </Card>
    </div>
  )
}
