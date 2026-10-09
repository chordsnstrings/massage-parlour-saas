import type { Metadata } from 'next'
import { AuthLayout } from '@/components/auth/auth-layout'
import { LegalLinks } from '@/components/auth/legal-links'
import { getT } from '@/i18n/server'
import { PATH_ROUTING } from '@/lib/paths'
import { canonicalUrls } from '@/server/origin'
import { getSession } from '@/server/session'
import { SignupForm } from './signup-form'

/** How a spa's web address (on the canonical domain) is previewed while typing its name. */
function siteAddress() {
  const sample = new URL(canonicalUrls().site('slug'))
  if (PATH_ROUTING) return { prefix: `${sample.host}/s/`, suffix: '' }
  return { prefix: '', suffix: sample.host.slice('slug'.length) }
}

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('auth.meta.signup') }
}

export default async function SignupPage() {
  const session = await getSession()
  const t = await getT()
  return (
    <AuthLayout
      title={session ? t('auth.signup.titleAdd') : t('auth.signup.title')}
      subtitle={session ? t('auth.signup.subtitleAdd') : t('auth.signup.subtitle')}
    >
      <SignupForm
        address={siteAddress()}
        signedIn={Boolean(session)}
        logo={{
          label: t('logo.signupLabel'),
          hint: t('logo.hint'),
          tooLarge: t('logo.tooLarge', { size: '1 MB' }),
        }}
      />
      <LegalLinks />
    </AuthLayout>
  )
}
