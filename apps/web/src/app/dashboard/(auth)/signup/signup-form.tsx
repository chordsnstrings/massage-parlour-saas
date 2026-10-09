'use client'
import { Check, Loader2, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import Link from 'next/link'
import { useEffect, useRef, useState, useTransition } from 'react'
import { LogoInput } from '@/components/media/logo-input'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { Input, Select, Textarea } from '@/components/ui/input'
import { useT } from '@/i18n/client'
import { appPath } from '@/lib/paths'
import { checkSlugAction, signupAction } from './actions'

/** "Apply for your spa" (PLAN §18.3): login (when signed out) + spa details; the owner reviews it before it opens. */
export function SignupForm({
  address,
  signedIn,
  plans,
  planId,
  emirates,
  today,
  logo,
}: {
  address: { prefix: string; suffix: string }
  signedIn: boolean
  plans: { id: string; label: string }[]
  /** Preselected plan (`?plan=` from the pricing page, else the first). */
  planId?: string
  emirates: { key: string; label: string }[]
  today: string
  logo: { label: string; hint: string; tooLarge: string }
}) {
  const t = useT()
  const [business, setBusiness] = useState('')
  const [slug, setSlug] = useState('')
  const [touched, setTouched] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean; reason?: string } | null>(null)
  const [checking, startCheck] = useTransition()
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const effectiveSlug = touched ? slug : business
  useEffect(() => {
    clearTimeout(timer.current)
    if (!effectiveSlug.trim()) {
      setStatus(null)
      return
    }
    timer.current = setTimeout(() => {
      startCheck(async () => {
        const res = await checkSlugAction(effectiveSlug)
        if (!touched) setSlug(res.slug)
        setStatus({ ok: res.ok, reason: res.reason })
      })
    }, 300)
    return () => clearTimeout(timer.current)
  }, [effectiveSlug, touched])

  return (
    <ActionForm action={signupAction} className="space-y-5">
      {!signedIn && (
        <>
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">
            {t('auth.signup.loginSection')}
          </h2>
          <Field label={t('auth.yourName')} name="name">
            <Input id="name" name="name" autoComplete="name" required />
          </Field>
          <Field label={t('auth.signup.workEmail')} name="email">
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </Field>
          <Field label={t('auth.password')} name="password" hint={t('auth.passwordHint')}>
            <Input id="password" name="password" type="password" autoComplete="new-password" required />
          </Field>
        </>
      )}
      <h2 className="pt-2 text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">
        {t('auth.signup.spaSection')}
      </h2>
      <Field label={t('auth.signup.phone')} name="phone" hint={t('auth.signup.phoneHint')}>
        <Input id="phone" name="phone" type="tel" autoComplete="tel" inputMode="tel" required />
      </Field>
      <Field label={t('auth.signup.spaName')} name="businessName">
        <Input
          id="businessName"
          name="businessName"
          placeholder={t('auth.signup.spaPlaceholder')}
          value={business}
          onChange={(e) => setBusiness(e.target.value)}
          required
        />
      </Field>
      <Field label={t('auth.signup.address')} name="slug">
        <div className="flex items-stretch overflow-hidden rounded-lg border bg-surface transition-[border-color,box-shadow] focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/15">
          {address.prefix && (
            <span className="flex items-center border-e bg-subtle px-3 text-sm text-muted">
              {address.prefix}
            </span>
          )}
          <input
            id="slug"
            name="slug"
            value={slug}
            onChange={(e) => {
              setTouched(true)
              setSlug(e.target.value.toLowerCase())
            }}
            className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-sm outline-none"
            placeholder="serenity-spa"
            autoCapitalize="none"
            spellCheck={false}
          />
          {address.suffix && (
            <span className="flex items-center border-s bg-subtle px-3 text-sm text-muted">
              {address.suffix}
            </span>
          )}
        </div>
        <div className="h-5 text-[13px]">
          <AnimatePresence mode="wait" initial={false}>
            {checking ? (
              <motion.span
                key="c"
                className="inline-flex items-center gap-1.5 text-muted"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <Loader2 className="size-3.5 animate-spin" /> {t('auth.signup.checking')}
              </motion.span>
            ) : status ? (
              <motion.span
                key={status.ok ? 'ok' : 'no'}
                className={`inline-flex items-center gap-1.5 ${status.ok ? 'text-success' : 'text-danger'}`}
                initial={{ opacity: 0, y: 2 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                {status.ok ? <Check className="size-3.5" /> : <X className="size-3.5" />}
                {status.ok
                  ? t('auth.signup.available', { address: `${address.prefix}${slug}${address.suffix}` })
                  : status.reason}
              </motion.span>
            ) : null}
          </AnimatePresence>
        </div>
      </Field>
      <div className="grid gap-5 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Field label={t('auth.signup.emirate')} name="emirate">
          <Select id="emirate" name="emirate" defaultValue="" required>
            <option value="" disabled>
              {t('auth.signup.emiratePick')}
            </option>
            {emirates.map((e) => (
              <option key={e.key} value={e.key}>
                {e.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('auth.signup.street')} name="street">
          <Input
            id="street"
            name="street"
            autoComplete="street-address"
            placeholder={t('auth.signup.streetPlaceholder')}
            required
          />
        </Field>
      </div>
      <Field label={logo.label} name="logo" hint={logo.hint}>
        <LogoInput tooLargeText={logo.tooLarge} />
      </Field>
      {plans.length > 0 && (
        <Field label={t('auth.signup.plan')} name="planId">
          <Select id="planId" name="planId" defaultValue={planId}>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label={t('auth.signup.start')} name="start">
        <Input id="start" name="start" type="date" min={today} defaultValue={today} required />
      </Field>
      <Field label={t('auth.signup.notes')} name="notes">
        <Textarea id="notes" name="notes" rows={3} placeholder={t('auth.signup.notesPlaceholder')} />
      </Field>
      <SubmitButton size="lg" className="w-full">
        {signedIn ? t('auth.signup.submitAdd') : t('auth.signup.submit')}
      </SubmitButton>
      {!signedIn && (
        <p className="text-center text-sm text-muted">
          {t('auth.signup.haveAccount')}{' '}
          <Link href={appPath('/login')} className="font-medium text-fg underline-offset-4 hover:underline">
            {t('auth.signup.signIn')}
          </Link>
        </p>
      )}
    </ActionForm>
  )
}
