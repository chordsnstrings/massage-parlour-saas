import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AuthLayout } from '@/components/auth/auth-layout'
import { LoginForm } from '@/components/auth/forms'
import { adminPath } from '@/lib/paths'
import { appUrl } from '@/server/origin'
import { getSession, safeNext } from '@/server/session'

export const metadata: Metadata = { title: 'Super-admin sign in' }

export default async function PlatformLogin({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next, adminPath())
  if (await getSession()) redirect(next)
  return (
    <AuthLayout title="Super-admin" subtitle="Platform console for spamanagement.co.">
      {/* Password reset lives on the app host (admin host /forgot-password is a 404 whose prefetch never ends). */}
      <LoginForm next={next} forgotHref={await appUrl('/forgot-password')} />
      {/* Admin host only: the public sign-up is the spa application form (owner, 2026-10-09). */}
      <p className="mt-6 text-center text-sm text-muted">
        <Link href={adminPath('/join')} className="font-medium text-fg underline-offset-4 hover:underline">
          Create a super-admin account
        </Link>
      </p>
    </AuthLayout>
  )
}
