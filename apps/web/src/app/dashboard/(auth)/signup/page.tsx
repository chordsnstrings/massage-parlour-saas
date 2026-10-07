import type { Metadata } from 'next'
import { AuthLayout } from '@/components/auth/auth-layout'
import { PATH_ROUTING } from '@/lib/paths'
import { tenantSiteUrl } from '@/server/origin'
import { getSession } from '@/server/session'
import { SignupForm } from './signup-form'

/** How a spa's web address is previewed while typing its name — on the domain the visitor is using. */
async function siteAddress() {
  const sample = new URL(await tenantSiteUrl('slug'))
  if (PATH_ROUTING) return { prefix: `${sample.host}/s/`, suffix: '' }
  return { prefix: '', suffix: sample.host.slice('slug'.length) }
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
      <SignupForm address={await siteAddress()} signedIn={Boolean(session)} />
    </AuthLayout>
  )
}
