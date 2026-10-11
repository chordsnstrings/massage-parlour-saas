import type { Metadata } from 'next'
import { AuthLayout } from '@/components/auth/auth-layout'
import { ForgotPasswordForm } from '@/components/auth/forms'
import { getT } from '@/i18n/server'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('auth.meta.reset') }
}

export default async function ForgotPasswordPage() {
  const t = await getT()
  return (
    <AuthLayout title={t('auth.forgot.title')} subtitle={t('auth.forgot.subtitle')}>
      <ForgotPasswordForm />
    </AuthLayout>
  )
}
