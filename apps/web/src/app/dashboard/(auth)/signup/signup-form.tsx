'use client'
import { Check, Loader2, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import Link from 'next/link'
import { useEffect, useRef, useState, useTransition } from 'react'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { appPath } from '@/lib/paths'
import { checkSlugAction, signupAction } from './actions'

export function SignupForm({
  address,
  signedIn,
}: {
  address: { prefix: string; suffix: string }
  signedIn: boolean
}) {
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
          <Field label="Your name" name="name">
            <Input id="name" name="name" autoComplete="name" required />
          </Field>
          <Field label="Work email" name="email">
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </Field>
          <Field label="Password" name="password" hint="At least 10 characters.">
            <Input id="password" name="password" type="password" autoComplete="new-password" required />
          </Field>
        </>
      )}
      <Field label="Spa name" name="businessName">
        <Input
          id="businessName"
          name="businessName"
          placeholder="Serenity Spa"
          value={business}
          onChange={(e) => setBusiness(e.target.value)}
          required
        />
      </Field>
      <Field label="Web address" name="slug">
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
                <Loader2 className="size-3.5 animate-spin" /> Checking…
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
                {status.ok ? `${address.prefix}${slug}${address.suffix} is available` : status.reason}
              </motion.span>
            ) : null}
          </AnimatePresence>
        </div>
      </Field>
      <SubmitButton size="lg" className="w-full">
        {signedIn ? 'Create spa' : 'Create account'}
      </SubmitButton>
      {!signedIn && (
        <p className="text-center text-sm text-muted">
          Already have an account?{' '}
          <Link href={appPath('/login')} className="font-medium text-fg underline-offset-4 hover:underline">
            Sign in
          </Link>
        </p>
      )}
    </ActionForm>
  )
}
