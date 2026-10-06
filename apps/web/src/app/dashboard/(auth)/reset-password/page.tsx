import type { Metadata } from 'next'
import Link from 'next/link'
import { AuthLayout } from '@/components/auth/auth-layout'
import { ResetPasswordForm } from '@/components/auth/forms'
import { appPath } from '@/lib/paths'

export const metadata: Metadata = { title: 'Choose a new password' }

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>
}) {
  const { token, error } = await searchParams
  return (
    <AuthLayout title="Choose a new password">
      {token && !error ? (
        <ResetPasswordForm token={token} />
      ) : (
        <p className="text-[15px] text-muted">
          This link is invalid or has expired.{' '}
          <Link
            href={appPath('/forgot-password')}
            className="font-medium text-fg underline underline-offset-4"
          >
            Request a new one
          </Link>
          .
        </p>
      )}
    </AuthLayout>
  )
}
