import type { Metadata } from 'next'
import { AuthLayout } from '@/components/auth/auth-layout'
import { TwoFactorForm } from '@/components/auth/forms'
import { appPath } from '@/lib/paths'
import { safeNext } from '@/server/session'

export const metadata: Metadata = { title: 'Two-step verification' }

export default async function TwoFactorPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  return (
    <AuthLayout title="Two-step verification" subtitle="Enter the code from your authenticator app.">
      <TwoFactorForm next={safeNext((await searchParams).next, appPath())} />
    </AuthLayout>
  )
}
