import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { AuthLayout } from '@/components/auth/auth-layout'
import { LoginForm } from '@/components/auth/forms'
import { getSession, safeNext } from '@/server/session'

export const metadata: Metadata = { title: 'Sign in' }

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next)
  if (await getSession()) redirect(next)
  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to your spa.">
      <LoginForm next={next} signupHref="/signup" />
    </AuthLayout>
  )
}
