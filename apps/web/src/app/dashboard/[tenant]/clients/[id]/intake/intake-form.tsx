'use client'
import type { IntakeField } from '@spa/db'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { SignaturePad } from '@/components/clients/signature-pad'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { Checkbox, Input, Textarea } from '@/components/ui/input'
import { toast } from '@/components/ui/toast'
import type { ActionResult } from '@/lib/action'
import { appPath } from '@/lib/paths'
import { submitIntakeAction } from '../../actions'

const T = {
  en: {
    intro: 'Please answer honestly — it helps your therapist keep you safe and comfortable.',
    yes: 'Yes',
    no: 'No',
    required: 'Required',
    waiver: 'Consent',
    agree: 'I have read and accept the above',
    sign: 'Signature',
    signHint: 'Sign here with your finger',
    clear: 'Clear',
    submit: 'Sign and submit',
    for: 'Client',
  },
  ar: {
    intro: 'يرجى الإجابة بصدق، فذلك يساعد المعالج على ضمان سلامتك وراحتك.',
    yes: 'نعم',
    no: 'لا',
    required: 'مطلوب',
    waiver: 'الإقرار والموافقة',
    agree: 'لقد قرأت ما ورد أعلاه وأوافق عليه',
    sign: 'التوقيع',
    signHint: 'وقّع هنا بإصبعك',
    clear: 'مسح',
    submit: 'التوقيع والإرسال',
    for: 'العميل',
  },
} as const

const pill =
  'flex min-h-12 cursor-pointer items-center justify-center rounded-xl border bg-surface px-5 text-[15px] transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.98] has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:font-medium has-[:checked]:text-accent has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-accent/15'

export function IntakeForm({
  slug,
  clientId,
  clientName,
  spaName,
  lang,
  template,
}: {
  slug: string
  clientId: string
  clientName: string
  spaName: string
  lang: 'en' | 'ar'
  template: { name: string; fields: IntakeField[]; waiver: { en: string; ar?: string }; version: number }
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [errors, setErrors] = useState<Record<string, string>>({})
  const t = T[lang]
  // A plain onSubmit (not a form action) so React doesn't reset answers when validation fails.
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    start(async () => {
      const r: ActionResult = await submitIntakeAction(slug, clientId, lang, null, fd)
      if (!r) return
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {})
        toast.error(r.error)
        const first = Object.keys(r.fieldErrors ?? {})[0]
        if (first)
          document.getElementById(`err-${first}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        return
      }
      toast.success(r.message ?? 'Saved')
      const id = r.data?.id
      router.push(appPath(`/${slug}/clients/${clientId}${typeof id === 'string' ? `/intake/${id}` : ''}`))
    })
  }
  const err = (name: string) =>
    errors[name] ? (
      <p id={`err-${name}`} className="anim-fade-in text-[13px] text-danger">
        {errors[name]}
      </p>
    ) : null
  const label = (f: IntakeField) => (lang === 'ar' && f.label.ar) || f.label.en
  const waiver = (lang === 'ar' && template.waiver.ar) || template.waiver.en
  return (
    <div dir={lang === 'ar' ? 'rtl' : 'ltr'} lang={lang}>
      <form onSubmit={onSubmit} noValidate className="space-y-6">
        <header className="space-y-2 pt-2">
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted">{spaName}</p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{template.name}</h1>
          <p className="text-[15px] text-muted">
            {t.for}: <span className="font-medium text-fg">{clientName}</span>
          </p>
          <p className="text-[15px] text-muted">{t.intro}</p>
        </header>

        <Card>
          <CardBody className="divide-y p-0 sm:p-0">
            {template.fields.map((f, i) => {
              const name = `q_${f.key}`
              return (
                <fieldset key={f.key} className="space-y-3 px-5 py-5 sm:px-7 sm:py-6">
                  <legend className="contents">
                    <span className="flex items-baseline gap-3 text-[16px] font-medium leading-snug">
                      <span className="text-sm text-muted tabular-nums">{i + 1}.</span>
                      <span>
                        {label(f)}
                        {f.required && (
                          <span className="text-danger">
                            {' '}
                            *<span className="sr-only">{t.required}</span>
                          </span>
                        )}
                      </span>
                    </span>
                  </legend>
                  {f.type === 'yesno' && (
                    <div className="grid grid-cols-2 gap-3 sm:max-w-sm">
                      {(['yes', 'no'] as const).map((v) => (
                        <label key={v} className={pill}>
                          <input type="radio" name={name} value={v} className="sr-only" />
                          {t[v]}
                        </label>
                      ))}
                    </div>
                  )}
                  {f.type === 'select' && (
                    <div className="flex flex-wrap gap-3">
                      {(f.options ?? []).map((o) => (
                        <label key={o} className={pill}>
                          <input type="radio" name={name} value={o} className="sr-only" />
                          {o}
                        </label>
                      ))}
                    </div>
                  )}
                  {f.type === 'text' && (
                    <Input
                      name={name}
                      aria-label={label(f)}
                      className="h-12 text-[15px]"
                      autoComplete="off"
                    />
                  )}
                  {f.type === 'textarea' && (
                    <Textarea name={name} aria-label={label(f)} rows={3} className="text-[15px]" />
                  )}
                  {err(name)}
                </fieldset>
              )
            })}
          </CardBody>
        </Card>

        <Card>
          <CardBody className="space-y-5 sm:px-7">
            <h2 className="text-[15px] font-semibold">{t.waiver}</h2>
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-fg/90">{waiver}</p>
            <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl bg-subtle/70 px-4 text-[15px]">
              <Checkbox name="agree" className="size-5" />
              {t.agree}
            </label>
            {err('agree')}
            <SignaturePad name="signature" label={t.sign} hint={t.signHint} clearLabel={t.clear} />
            {err('signature')}
          </CardBody>
        </Card>

        <Button type="submit" size="lg" pending={pending} className="h-14 w-full text-base">
          {t.submit}
        </Button>
      </form>
    </div>
  )
}
