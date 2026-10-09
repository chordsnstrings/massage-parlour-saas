import type { Metadata } from 'next'
import Link from 'next/link'
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
    <AuthLayout title="Super-admin" subtitle="Platform console for spamanagement.co.">
      <LoginForm next={next} />
      {/* Admin host only: the public sign-up is the spa application form (owner, 2026-10-09). */}
      <p className="mt-6 text-center text-sm text-muted">
        <Link href={adminPath('/join')} className="font-medium text-fg underline-offset-4 hover:underline">
          Create a super-admin account
        </Link>
      </p>
    </AuthLayout>
  )
}
