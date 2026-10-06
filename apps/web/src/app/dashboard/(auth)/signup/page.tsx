import type { Metadata } from 'next'
import { AuthLayout } from '@/components/auth/auth-layout'
import { getSession } from '@/server/session'
import { SignupForm } from './signup-form'

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
      <SignupForm rootDomain={process.env.ROOT_DOMAIN ?? 'localhost:3000'} signedIn={Boolean(session)} />
    </AuthLayout>
  )
}
