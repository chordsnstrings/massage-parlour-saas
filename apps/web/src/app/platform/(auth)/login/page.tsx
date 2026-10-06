import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { AuthLayout } from '@/components/auth/auth-layout'
import { LoginForm } from '@/components/auth/forms'
import { adminPath } from '@/lib/paths'
import { getSession, safeNext } from '@/server/session'

export const metadata: Metadata = { title: 'Super-admin sign in' }

export default async function PlatformLogin({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next, adminPath())
  if (await getSession()) redirect(next)
  return (
    <AuthLayout title="Super-admin" subtitle="Platform console for spamanagement.ae.">
      <LoginForm next={next} />
    </AuthLayout>
  )
}
