import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { AuthLayout } from '@/components/auth/auth-layout'
import { LoginForm } from '@/components/auth/forms'
import { getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { getSession, safeNext } from '@/server/session'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('auth.meta.signIn') }
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next, appPath())
  if (await getSession()) redirect(next)
  const t = await getT()
  return (
    <AuthLayout title={t('auth.login.title')} subtitle={t('auth.login.subtitle')}>
      <LoginForm next={next} signupHref={appPath('/signup')} />
    </AuthLayout>
  )
}
