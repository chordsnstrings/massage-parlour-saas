'use client'
import { authClient } from '@spa/auth/client'
import Link from 'next/link'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox, Input, Label } from '@/components/ui/input'
import { toast } from '@/components/ui/toast'
import { appPath } from '@/lib/paths'

const go = (next: string) => {
  window.location.href = next
}

function useSubmit() {
  const [pending, setPending] = useState(false)
  const run = async (
    fn: () => Promise<{ error?: { message?: string } | null } | undefined>,
    onOk: () => void,
  ) => {
    setPending(true)
    try {
      const res = await fn()
      if (res?.error) toast.error(res.error.message ?? 'Something went wrong.')
      else onOk()
    } finally {
      setPending(false)
    }
  }
  return { pending, run }
}

export function LoginForm({ next, signupHref }: { next: string; signupHref?: string }) {
  const { pending, run } = useSubmit()
  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault()
        const f = new FormData(e.currentTarget)
        run(
          () =>
            authClient.signIn.email({ email: String(f.get('email')), password: String(f.get('password')) }),
          () => go(next),
        )
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Password</Label>
          <Link
            href={appPath('/forgot-password')}
            className="text-[13px] text-muted transition-colors hover:text-fg"
          >
            Forgot password?
          </Link>
        </div>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <Button type="submit" size="lg" className="w-full" pending={pending}>
        Sign in
      </Button>
      {signupHref && (
        <p className="text-center text-sm text-muted">
          New to spamanagement?{' '}
          <Link href={signupHref} className="font-medium text-fg underline-offset-4 hover:underline">
            Create your spa
          </Link>
        </p>
      )}
    </form>
  )
}

export function TwoFactorForm({ next }: { next: string }) {
  const { pending, run } = useSubmit()
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
          () => go(next),
        )
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="code">{backup ? 'Backup code' : '6-digit code'}</Label>
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
        <Checkbox name="trust" /> Trust this device for 30 days
      </label>
      <Button type="submit" size="lg" className="w-full" pending={pending}>
        Verify
      </Button>
      <button
        type="button"
        className="w-full text-sm text-muted hover:text-fg"
        onClick={() => setBackup((b) => !b)}
      >
        {backup ? 'Use authenticator app instead' : 'Use a backup code'}
      </button>
    </form>
  )
}

export function ForgotPasswordForm() {
  const { pending, run } = useSubmit()
  const [sent, setSent] = useState(false)
  if (sent)
    return (
      <p className="anim-fade-in text-[15px] text-muted">
        If that email has an account, a reset link is on its way.
      </p>
    )
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
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required autoFocus />
      </div>
      <Button type="submit" size="lg" className="w-full" pending={pending}>
        Send reset link
      </Button>
    </form>
  )
}

export function ResetPasswordForm({ token }: { token: string }) {
  const { pending, run } = useSubmit()
  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault()
        const newPassword = String(new FormData(e.currentTarget).get('password'))
        run(
          () => authClient.resetPassword({ newPassword, token }),
          () => {
            toast.success('Password updated. Please sign in.')
            go(appPath('/login'))
          },
        )
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          minLength={10}
          autoComplete="new-password"
          required
        />
        <p className="text-[13px] text-muted">At least 10 characters.</p>
      </div>
      <Button type="submit" size="lg" className="w-full" pending={pending}>
        Set password
      </Button>
    </form>
  )
}
