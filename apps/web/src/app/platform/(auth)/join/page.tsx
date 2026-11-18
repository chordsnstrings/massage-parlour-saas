import { isListedAdminEmail, platformDb, user } from '@spa/db'
import { eq } from 'drizzle-orm'
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AuthLayout } from '@/components/auth/auth-layout'
import { SignOutButton } from '@/components/auth/sign-out-button'
import { Button } from '@/components/ui/button'
import { adminPath } from '@/lib/paths'
import { getSession } from '@/server/session'
import { JoinForm, ResendLink } from './join-form'

export const metadata: Metadata = { title: 'Create a super-admin account' }

/**
 * Admin host `/join` (owner, 2026-10-09): the only UI way for a PLATFORM_ADMIN_EMAILS address to get a login (the
 * public sign-up is the spa application form, which refuses these addresses). Signed in as a listed login that is not
 * verified yet → how to finish; verified → the console (requirePlatformAdmin promotes it and asks for 2FA).
 */
export default async function AdminJoinPage() {
  const session = await getSession()
  if (session && isListedAdminEmail(session.user.email)) {
    const [row] = await platformDb()
      .select({ verified: user.emailVerified })
      .from(user)
      .where(eq(user.id, session.user.id))
    if (row?.verified) redirect(adminPath())
    return (
      <AuthLayout title="Confirm your email" subtitle={`Signed in as ${session.user.email}.`}>
        <div className="space-y-5" data-testid="admin-join-pending">
          <div className="space-y-2 rounded-lg border bg-subtle p-4 text-sm">
            <p>
              We sent a confirmation link to <strong>{session.user.email}</strong>. Open it, then open the
              console: you will set up two-step verification (an authenticator app) before it opens.
            </p>
            <p className="text-muted">
              No email? An existing super-admin can confirm your address in the console → Company →
              Super-admins (Mark email verified).
            </p>
          </div>
          <Button size="lg" className="w-full" asChild>
            <Link href={adminPath()}>Open the console</Link>
          </Button>
          <ResendLink />
          <SignOutButton label="Sign out" />
        </div>
      </AuthLayout>
    )
  }
  return (
    <AuthLayout
      title="Create a super-admin account"
      subtitle="For platform super-admin addresses only. Spas apply on the sign-up page."
    >
      <JoinForm />
      <p className="mt-6 text-center text-sm text-muted">
        Already have an account?{' '}
        <Link href={adminPath('/login')} className="font-medium text-fg underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  )
}
