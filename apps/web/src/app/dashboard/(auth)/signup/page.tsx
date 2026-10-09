import { UAE_EMIRATES } from '@spa/core'
import { plans, platformDb } from '@spa/db'
import { asc, eq } from 'drizzle-orm'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { AuthLayout } from '@/components/auth/auth-layout'
import { LegalLinks } from '@/components/auth/legal-links'
import { getI18n, getT } from '@/i18n/server'
import { appPath, PATH_ROUTING } from '@/lib/paths'
import { todayDubai } from '@/lib/utils'
import { applicantState } from '@/server/applications'
import { adminUrl, canonicalUrls } from '@/server/origin'
import { getSession } from '@/server/session'
import { turnstileSiteKey } from '@/server/turnstile'
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

/**
 * "Apply for your spa" (PLAN §18.3). Signed in: the same form without the login fields ("another spa" copy only for a
 * login that already has one). `?plan=<id>` (pricing page cards) preselects that plan.
 */
export default async function SignupPage({ searchParams }: { searchParams: Promise<{ plan?: string }> }) {
  const session = await getSession()
  const state = session ? await applicantState(session.user.id) : null
  // One pending application per login: its waiting page instead of a second form.
  if (state?.application?.status === 'pending') redirect(appPath('/application'))
  // A PLATFORM_ADMIN_EMAILS login never applies (owner, 2026-10-09): its place is the console.
  if (state?.listedAdmin) redirect(await adminUrl())
  const { plan: wanted } = await searchParams
  const { t, fmt } = await getI18n()
  const planRows = await platformDb()
    .select()
    .from(plans)
    .where(eq(plans.active, true))
    .orderBy(asc(plans.sort), asc(plans.createdAt))
  const planOptions = planRows.map((p) => ({
    id: p.id,
    label:
      Number(p.setupFeeAed) > 0
        ? t('auth.signup.planOption', {
            name: p.name,
            price: fmt.aed(p.priceAed),
            fee: fmt.aed(p.setupFeeAed),
          })
        : t('auth.signup.planOptionNoFee', { name: p.name, price: fmt.aed(p.priceAed) }),
  }))
  return (
    <AuthLayout
      title={state?.hasSpa ? t('auth.signup.titleAdd') : t('auth.signup.title')}
      subtitle={state?.hasSpa ? t('auth.signup.subtitleAdd') : t('auth.signup.subtitle')}
    >
      <SignupForm
        address={siteAddress()}
        signedIn={Boolean(session)}
        plans={planOptions}
        planId={planOptions.find((p) => p.id === wanted)?.id ?? planOptions[0]?.id}
        emirates={UAE_EMIRATES.map((key) => ({ key, label: t(`auth.emirate.${key}`) }))}
        today={todayDubai()}
        logo={{
          label: t('logo.signupLabel'),
          hint: t('logo.hint'),
          tooLarge: t('logo.tooLarge', { size: '1 MB' }),
        }}
        turnstileSiteKey={await turnstileSiteKey()}
      />
      <LegalLinks />
    </AuthLayout>
  )
}
