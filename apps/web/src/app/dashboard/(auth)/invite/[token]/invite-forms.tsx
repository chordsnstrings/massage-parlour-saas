'use client'
import { useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/toast'
import { resultText, useT } from '@/i18n/client'
import { acceptInviteAction, signupAndAcceptAction } from './actions'

export function AcceptButton({ token }: { token: string }) {
  const t = useT()
  const [pending, start] = useTransition()
  return (
    <Button
      size="lg"
      className="w-full"
      pending={pending}
      onClick={() =>
        start(async () => {
          const res = await acceptInviteAction(token)
          if (res && !res.ok) toast.error(resultText(t, res) ?? '')
        })
      }
    >
      {t('auth.invite.accept')}
    </Button>
  )
}

export function SignupAndAcceptForm({ token, email }: { token: string; email: string }) {
  const t = useT()
  return (
    <ActionForm action={signupAndAcceptAction.bind(null, token)} className="space-y-5">
      <Field label={t('auth.email')} name="email">
        <Input id="email" value={email} disabled readOnly />
      </Field>
      <Field label={t('auth.yourName')} name="name">
        <Input id="name" name="name" autoComplete="name" required autoFocus />
      </Field>
      <Field label={t('auth.password')} name="password" hint={t('auth.passwordHint')}>
        <Input id="password" name="password" type="password" autoComplete="new-password" required />
      </Field>
      <SubmitButton size="lg" className="w-full">
        {t('auth.invite.submit')}
      </SubmitButton>
    </ActionForm>
  )
}
