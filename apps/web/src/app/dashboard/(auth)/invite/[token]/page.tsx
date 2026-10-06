import type { Metadata } from 'next'
import Link from 'next/link'
import { AuthLayout } from '@/components/auth/auth-layout'
import { appPath } from '@/lib/paths'
import { findInvitation } from '@/server/invitations'
import { getSession } from '@/server/session'
import { AcceptButton, SignupAndAcceptForm } from './invite-forms'

export const metadata: Metadata = { title: 'Invitation' }

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const [invite, session] = await Promise.all([findInvitation(token), getSession()])
  if (!invite) {
    return (
      <AuthLayout title="Invitation expired" subtitle="Ask your manager to send a new invitation link.">
        <Link href={appPath('/login')} className="text-sm font-medium underline underline-offset-4">
          Go to sign in
        </Link>
      </AuthLayout>
    )
  }
  const subtitle = (
    <>
      Join <span className="font-medium text-fg">{invite.tenantName}</span> as {invite.roleName}.
    </>
  )
  if (session) {
    const match = session.user.email.toLowerCase() === invite.email.toLowerCase()
    return (
      <AuthLayout title="You're invited" subtitle={subtitle}>
        {match ? (
          <AcceptButton token={token} />
        ) : (
          <p className="text-[15px] text-muted">
            This invitation is for <span className="text-fg">{invite.email}</span>, but you're signed in as{' '}
            {session.user.email}. Sign out and use the invited email.
          </p>
        )}
      </AuthLayout>
    )
  }
  return (
    <AuthLayout title="You're invited" subtitle={subtitle}>
      <SignupAndAcceptForm token={token} email={invite.email} />
      <p className="mt-6 text-center text-sm text-muted">
        Already have an account?{' '}
        <Link
          href={appPath(`/login?next=${appPath(`/invite/${token}`)}`)}
          className="font-medium text-fg underline-offset-4 hover:underline"
        >
          Sign in to accept
        </Link>
      </p>
    </AuthLayout>
  )
}
