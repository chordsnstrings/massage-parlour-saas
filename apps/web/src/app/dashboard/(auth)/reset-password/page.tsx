import type { Metadata } from 'next'
import Link from 'next/link'
import { AuthLayout } from '@/components/auth/auth-layout'
import { ResetPasswordForm } from '@/components/auth/forms'
import { getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('auth.meta.newPassword') }
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>
}) {
  const { token, error } = await searchParams
  const t = await getT()
  return (
    <AuthLayout title={t('auth.reset.title')}>
      {token && !error ? (
        <ResetPasswordForm token={token} />
      ) : (
        <p className="text-[15px] text-muted">
          {t('auth.reset.invalid')}{' '}
          <Link
            href={appPath('/forgot-password')}
            className="font-medium text-fg underline underline-offset-4"
          >
            {t('auth.reset.requestNew')}
          </Link>
          .
        </p>
      )}
    </AuthLayout>
  )
}
