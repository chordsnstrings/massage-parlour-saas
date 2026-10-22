import type { Metadata } from 'next'
import Link from 'next/link'
import { AuthLayout } from '@/components/auth/auth-layout'
import { getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { findInvitation } from '@/server/invitations'
import { getSession } from '@/server/session'
import { AcceptButton, SignupAndAcceptForm } from './invite-forms'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('auth.meta.invite') }
}

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const [invite, session] = await Promise.all([findInvitation(token), getSession()])
  const t = await getT()
  if (!invite) {
    return (
      <AuthLayout title={t('auth.invite.expired')} subtitle={t('auth.invite.expiredSub')}>
        <Link href={appPath('/login')} className="text-sm font-medium underline underline-offset-4">
          {t('auth.invite.goSignIn')}
        </Link>
      </AuthLayout>
    )
  }
  // The spa name is emphasised inside the translated sentence (typed names are never translated).
  const [before, after] = t('auth.invite.join', { spa: '\u0000', role: invite.roleName }).split('\u0000')
  const subtitle = (
    <>
      {before}
      <span className="font-medium text-fg">{invite.tenantName}</span>
      {after}
    </>
  )
  if (session) {
    const match = session.user.email.toLowerCase() === invite.email.toLowerCase()
    return (
      <AuthLayout title={t('auth.invite.invited')} subtitle={subtitle}>
        {match ? (
          <AcceptButton token={token} />
        ) : (
          <p className="text-[15px] text-muted">
            {t('auth.invite.wrongEmail', { email: invite.email, current: session.user.email })}
          </p>
        )}
      </AuthLayout>
    )
  }
  return (
    <AuthLayout title={t('auth.invite.invited')} subtitle={subtitle}>
      <SignupAndAcceptForm token={token} email={invite.email} />
      <p className="mt-6 text-center text-sm text-muted">
        {t('auth.invite.haveAccount')}{' '}
        <Link
          href={appPath(`/login?next=${appPath(`/invite/${token}`)}`)}
          className="font-medium text-fg underline-offset-4 hover:underline"
        >
          {t('auth.invite.signInAccept')}
        </Link>
      </p>
    </AuthLayout>
  )
}
