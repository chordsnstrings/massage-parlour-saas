import type { Metadata } from 'next'
import { AuthLayout } from '@/components/auth/auth-layout'
import { PATH_ROUTING } from '@/lib/paths'
import { getSession } from '@/server/session'
import { SignupForm } from './signup-form'

/** How a spa's web address is previewed while typing its name. */
function siteAddress() {
  if (PATH_ROUTING)
    return { prefix: `${new URL(process.env.APP_URL ?? 'http://localhost:3000').host}/s/`, suffix: '' }
  return { prefix: '', suffix: `.${process.env.ROOT_DOMAIN ?? 'localhost:3000'}` }
}

export const metadata: Metadata = { title: 'Create your spa' }

export default async function SignupPage() {
  const session = await getSession()
  return (
    <AuthLayout
      title={session ? 'Add a spa' : 'Create your spa'}
      subtitle={
        session
          ? 'Set up another business under your account.'
          : '14-day free trial. Your site goes live instantly.'
      }
    >
      <SignupForm address={siteAddress()} signedIn={Boolean(session)} />
    </AuthLayout>
  )
}
