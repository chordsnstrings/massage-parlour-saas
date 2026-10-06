import type { Metadata } from 'next'
import { AuthLayout } from '@/components/auth/auth-layout'
import { ForgotPasswordForm } from '@/components/auth/forms'

export const metadata: Metadata = { title: 'Reset password' }

export default function ForgotPasswordPage() {
  return (
    <AuthLayout title="Reset your password" subtitle="We'll email you a secure link.">
      <ForgotPasswordForm />
    </AuthLayout>
  )
}
