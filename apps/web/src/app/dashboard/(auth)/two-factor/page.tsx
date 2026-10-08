import type { Metadata } from 'next'
import { AuthLayout } from '@/components/auth/auth-layout'
import { TwoFactorForm } from '@/components/auth/forms'
import { getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { safeNext } from '@/server/session'

// Static (English) title: app/platform/(auth)/two-factor re-exports `metadata` from this page.
export const metadata: Metadata = { title: 'Two-step verification' }

export default async function TwoFactorPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const t = await getT()
  return (
    <AuthLayout title={t('auth.twoFactor.title')} subtitle={t('auth.twoFactor.subtitle')}>
      <TwoFactorForm next={safeNext((await searchParams).next, appPath())} />
    </AuthLayout>
  )
}
