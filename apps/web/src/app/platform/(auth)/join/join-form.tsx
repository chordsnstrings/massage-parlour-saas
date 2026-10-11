'use client'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { joinAdminAction, resendAdminVerificationAction } from './actions'

/** Name, email, password — only PLATFORM_ADMIN_EMAILS addresses get past the action. */
export function JoinForm() {
  return (
    <ActionForm action={joinAdminAction} className="space-y-5">
      <Field label="Your name" name="name">
        <Input id="name" name="name" autoComplete="name" required autoFocus />
      </Field>
      <Field label="Email" name="email">
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      <Field label="Password" name="password" hint="At least 10 characters.">
        <Input id="password" name="password" type="password" autoComplete="new-password" required />
      </Field>
      <SubmitButton size="lg" className="w-full">
        Create super-admin account
      </SubmitButton>
    </ActionForm>
  )
}

export function ResendLink() {
  return (
    <ActionForm action={resendAdminVerificationAction}>
      <SubmitButton variant="secondary" className="w-full">
        Send the link again
      </SubmitButton>
    </ActionForm>
  )
}
