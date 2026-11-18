import { plans, platformDb } from '@spa/db'
import { eq } from 'drizzle-orm'
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AuthLayout } from '@/components/auth/auth-layout'
import { SignOutButton } from '@/components/auth/sign-out-button'
import { Button } from '@/components/ui/button'
import { getI18n, getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { applicantState } from '@/server/applications'
import { adminUrl, canonicalUrls } from '@/server/origin'
import { requireUser } from '@/server/session'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('auth.meta.application') }
}

/**
 * The applicant's page (PLAN §18.3): before approval it is all a login without a spa can open — no 2FA needed here
 * (the spa's 2FA rule applies once they enter the dashboard). Shows what was sent and the status.
 */
export default async function ApplicationPage() {
  const { user } = await requireUser()
  const state = await applicantState(user.id)
  const app = state.application
  if (!app) redirect(state.isAdmin || state.listedAdmin ? await adminUrl() : appPath('/signup'))
  const { t, fmt } = await getI18n()
  const plan = app.planId
    ? await platformDb().query.plans.findFirst({ where: eq(plans.id, app.planId) })
    : null
  const day = (d: string) => fmt.date(`${d}T12:00:00Z`)
  const status = {
    pending: t('auth.application.statusPending'),
    approved: t('auth.application.statusApproved'),
    rejected: t('auth.application.statusRejected'),
  }[app.status]
  const rows: [string, string][] = [
    [t('auth.yourName'), app.applicantName],
    [t('auth.email'), app.email],
    [t('auth.signup.phone'), app.phone],
    [t('auth.signup.spaName'), app.spaName],
    // The address as chosen on the form (canonical domain: it is the spa's shared address).
    [
      t('auth.signup.address'),
      canonicalUrls()
        .site(app.slug)
        .replace(/^https?:\/\//, ''),
    ],
    [t('auth.signup.emirate'), t.maybe(`auth.emirate.${app.emirate}`) ?? app.emirate],
    [t('auth.signup.street'), app.streetAddress],
    [t('auth.signup.plan'), plan?.name ?? t('auth.application.noPlan')],
    [t('auth.signup.start'), day(app.preferredStart)],
    ...(app.notes ? ([[t('auth.signup.notes'), app.notes]] as [string, string][]) : []),
  ]
  const logo =
    app.logoBytes && app.logoContentType
      ? `data:${app.logoContentType};base64,${app.logoBytes.toString('base64')}`
      : null
  const title =
    app.status === 'approved'
      ? t('auth.application.approvedTitle')
      : app.status === 'rejected'
        ? t('auth.application.rejectedTitle')
        : t('auth.application.title')
  const subtitle =
    app.status === 'approved'
      ? t('auth.application.approvedBody')
      : app.status === 'rejected'
        ? t('auth.application.rejectedBody')
        : t('auth.application.subtitle', { email: app.email })

  return (
    <AuthLayout title={title} subtitle={subtitle}>
      <div className="space-y-6" data-testid="application-status" data-status={app.status}>
        <div className="flex items-center justify-between gap-3 rounded-lg border bg-subtle/60 px-4 py-3 text-sm">
          <span className="text-muted">{t('auth.application.status')}</span>
          <span className="font-semibold" role="status">
            {status}
          </span>
        </div>
        {app.status === 'pending' && <p className="text-sm text-muted">{t('auth.application.locked')}</p>}
        {app.status === 'rejected' && app.shareReason && app.rejectionReason && (
          <p className="rounded-lg border border-warning bg-warning-soft p-4 text-sm">
            {t('auth.application.reason', { reason: app.rejectionReason })}
          </p>
        )}
        <section>
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">
              {t('auth.application.details')}
            </h2>
            <span className="text-[13px] text-muted">
              {t('auth.application.submitted', { date: fmt.date(app.createdAt) })}
            </span>
          </div>
          <dl className="divide-y rounded-lg border text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3 px-4 py-2.5">
                <dt className="text-muted">{k}</dt>
                <dd className="break-words font-medium">{v}</dd>
              </div>
            ))}
            {logo && (
              <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-center gap-3 px-4 py-2.5">
                <dt className="text-muted">{t('auth.application.logo')}</dt>
                <dd>
                  {/* biome-ignore lint/performance/noImgElement: small inline data URL */}
                  <img src={logo} alt="" className="size-12 rounded-md border object-contain" />
                </dd>
              </div>
            )}
          </dl>
        </section>
        <div className="flex flex-wrap items-center gap-3">
          {app.status === 'approved' && state.hasSpa && (
            <Button asChild>
              <Link href={appPath(`/${app.slug}`)}>{t('auth.application.openDashboard')}</Link>
            </Button>
          )}
          {state.hasSpa && app.status !== 'approved' && (
            <Button variant="secondary" asChild>
              <Link href={appPath()}>{t('auth.application.backToSpas')}</Link>
            </Button>
          )}
          <SignOutButton label={t('auth.application.signOut')} />
        </div>
      </div>
    </AuthLayout>
  )
}
