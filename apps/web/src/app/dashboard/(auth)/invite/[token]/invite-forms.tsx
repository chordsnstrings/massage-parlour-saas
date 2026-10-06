'use client'
import { useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/toast'
import { acceptInviteAction, signupAndAcceptAction } from './actions'

export function AcceptButton({ token }: { token: string }) {
  const [pending, start] = useTransition()
  return (
    <Button
      size="lg"
      className="w-full"
      pending={pending}
      onClick={() =>
        start(async () => {
          const res = await acceptInviteAction(token)
          if (res && !res.ok) toast.error(res.error)
        })
      }
    >
      Accept invitation
    </Button>
  )
}

export function SignupAndAcceptForm({ token, email }: { token: string; email: string }) {
  return (
    <ActionForm action={signupAndAcceptAction.bind(null, token)} className="space-y-5">
      <Field label="Email" name="email">
        <Input id="email" value={email} disabled readOnly />
      </Field>
      <Field label="Your name" name="name">
        <Input id="name" name="name" autoComplete="name" required autoFocus />
      </Field>
      <Field label="Password" name="password" hint="At least 10 characters.">
        <Input id="password" name="password" type="password" autoComplete="new-password" required />
      </Field>
      <SubmitButton size="lg" className="w-full">
        Create account & join
      </SubmitButton>
    </ActionForm>
  )
}
