'use client'
import { authClient } from '@spa/auth/client'
import Link from 'next/link'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox, Input, Label } from '@/components/ui/input'
import { toast } from '@/components/ui/toast'
import { appPath } from '@/lib/paths'
import { authErrorText, useAuthT } from './errors'

const go = (next: string) => {
  window.location.href = next
}

/**
 * Where to go after signing in. During a Claude connector authorization (OAuth) the sign-in response carries the
 * next step of that flow (`{ redirect: true, url }`: consent page or back to Claude); otherwise `next`.
 */
const after = (data: unknown, next: string) => {
  const d = data as { redirect?: boolean; url?: unknown } | undefined
  return d?.redirect && typeof d.url === 'string' ? d.url : next
}

function useSubmit() {
  const t = useAuthT()
  const [pending, setPending] = useState(false)
  const run = async (
    fn: () => Promise<
      { data?: unknown; error?: { code?: string; message?: string; status?: number } | null } | undefined
    >,
    onOk: (data?: unknown) => void,
  ) => {
    setPending(true)
    try {
      const res = await fn()
      if (res?.error) toast.error(authErrorText(t, res.error))
      else onOk(res?.data)
    } finally {
      setPending(false)
    }
  }
  return { pending, run, t }
}

/** Sign-in of a login whose spa application was rejected (PLAN §18.3): the account is closed; reason if shared. */
function ClosedNotice({ reason, onBack }: { reason?: string; onBack: () => void }) {
  const t = useAuthT()
  return (
    <div role="alert" data-testid="account-closed" className="anim-fade-in space-y-4">
      <div className="space-y-2 rounded-lg border border-warning bg-warning-soft p-4 text-sm">
        <p className="font-semibold">{t('auth.closed.title')}</p>
        <p>{t('auth.closed.body')}</p>
        {reason && <p>{t('auth.closed.reason', { reason })}</p>}
      </div>
      <p className="text-sm text-muted">{t('auth.closed.contact')}</p>
      <Button type="button" variant="secondary" className="w-full" onClick={onBack}>
        {t('auth.closed.back')}
      </Button>
    </div>
  )
}

/** `forgotHref`: the reset page lives on the app host only (the admin sign-in passes its absolute URL). */
export function LoginForm({
  next,
  signupHref,
  forgotHref = appPath('/forgot-password'),
}: {
  next: string
  signupHref?: string
  forgotHref?: string
}) {
  const { pending, run, t } = useSubmit()
  const [closed, setClosed] = useState<{ reason?: string } | null>(null)
  if (closed) return <ClosedNotice reason={closed.reason} onBack={() => setClosed(null)} />
  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault()
        const f = new FormData(e.currentTarget)
        run(
          async () => {
            const res = await authClient.signIn.email({
              email: String(f.get('email')),
              password: String(f.get('password')),
            })
            const err = res.error as { code?: string; reason?: string } | null
            if (err?.code === 'ACCOUNT_DISABLED') {
              setClosed({ reason: err.reason })
              return { data: { closed: true } }
            }
            return res
          },
          // With 2FA on, the client plugin already sent the browser to /two-factor (keeping ?next); don't override it.
          (data) => {
            const d = data as { twoFactorRedirect?: boolean; closed?: boolean } | undefined
            if (!d?.twoFactorRedirect && !d?.closed) go(after(data, next))
          },
        )
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="email">{t('auth.email')}</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">{t('auth.password')}</Label>
          <Link href={forgotHref} className="text-[13px] text-muted transition-colors hover:text-fg">
            {t('auth.login.forgot')}
          </Link>
        </div>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <Button type="submit" size="lg" className="w-full" pending={pending}>
        {t('auth.login.submit')}
      </Button>
      {signupHref && (
        <p className="text-center text-sm text-muted">
          {t('auth.login.new')}{' '}
          <Link href={signupHref} className="font-medium text-fg underline-offset-4 hover:underline">
            {t('auth.login.create')}
          </Link>
        </p>
      )}
    </form>
  )
}

export function TwoFactorForm({ next }: { next: string }) {
  const { pending, run, t } = useSubmit()
  const [backup, setBackup] = useState(false)
  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault()
        const f = new FormData(e.currentTarget)
        const code = String(f.get('code')).replace(/\s/g, '')
        const trustDevice = f.get('trust') === 'on'
        run(
          () =>
            backup
              ? authClient.twoFactor.verifyBackupCode({ code, trustDevice })
              : authClient.twoFactor.verifyTotp({ code, trustDevice }),
          (data) => go(after(data, next)),
        )
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="code">{backup ? t('auth.twoFactor.backupCode') : t('auth.twoFactor.code')}</Label>
        <Input
          id="code"
          name="code"
          inputMode={backup ? 'text' : 'numeric'}
          autoComplete="one-time-code"
          className="tabular text-center text-lg tracking-[0.4em]"
          required
          autoFocus
        />
      </div>
      <label className="flex items-center gap-2.5 text-sm text-muted">
        <Checkbox name="trust" /> {t('auth.twoFactor.trust')}
      </label>
      <Button type="submit" size="lg" className="w-full" pending={pending}>
        {t('auth.twoFactor.verify')}
      </Button>
      <button
        type="button"
        className="w-full text-sm text-muted hover:text-fg"
        onClick={() => setBackup((b) => !b)}
      >
        {backup ? t('auth.twoFactor.useApp') : t('auth.twoFactor.useBackup')}
      </button>
    </form>
  )
}

export function ForgotPasswordForm() {
  const { pending, run, t } = useSubmit()
  const [sent, setSent] = useState(false)
  if (sent) return <p className="anim-fade-in text-[15px] text-muted">{t('auth.forgot.sent')}</p>
  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault()
        const email = String(new FormData(e.currentTarget).get('email'))
        run(
          () => authClient.requestPasswordReset({ email, redirectTo: appPath('/reset-password') }),
          () => setSent(true),
        )
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="email">{t('auth.email')}</Label>
        <Input id="email" name="email" type="email" required autoFocus />
      </div>
      <Button type="submit" size="lg" className="w-full" pending={pending}>
        {t('auth.forgot.submit')}
      </Button>
    </form>
  )
}

export function ResetPasswordForm({ token }: { token: string }) {
  const { pending, run, t } = useSubmit()
  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault()
        const newPassword = String(new FormData(e.currentTarget).get('password'))
        run(
          () => authClient.resetPassword({ newPassword, token }),
          () => {
            toast.success(t('auth.reset.done'))
            go(appPath('/login'))
          },
        )
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="password">{t('auth.reset.newPassword')}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          minLength={10}
          autoComplete="new-password"
          required
        />
        <p className="text-[13px] text-muted">{t('auth.passwordHint')}</p>
      </div>
      <Button type="submit" size="lg" className="w-full" pending={pending}>
        {t('auth.reset.submit')}
      </Button>
    </form>
  )
}
