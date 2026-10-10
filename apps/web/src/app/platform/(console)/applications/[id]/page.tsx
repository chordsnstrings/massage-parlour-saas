import { planPriceLine } from '@spa/core'
import { plans, platformDb, platformSettings, spaApplications, user } from '@spa/db'
import { isLegacyPlan, slugStatus } from '@spa/services'
import { asc, eq } from 'drizzle-orm'
import { ArrowLeft } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Badge, statusTone } from '@/components/ui/badge'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { PageBody, PageHeader } from '@/components/ui/page'
import { adminPath } from '@/lib/paths'
import { formatAed, formatDate, formatDateTime, todayDubai } from '@/lib/utils'
import { requirePlatformAdmin } from '@/server/access'
import { emirateName } from '@/server/applications'
import { canonicalUrls } from '@/server/origin'
import { acceptApplicationAction, rejectApplicationAction } from '../actions'
import { AcceptSheet, type PlanChoice, RejectSheet } from './review'

export const metadata: Metadata = { title: 'Application' }

const SLUG_TEXT = {
  free: { tone: 'success', text: 'Available' },
  tenant: { tone: 'danger', text: 'Taken by an existing spa' },
  previous: { tone: 'danger', text: 'A renamed spa’s previous address (reserved for 12 months)' },
  application: { tone: 'danger', text: 'Held by another pending application' },
  invalid: { tone: 'danger', text: 'Not a valid address' },
} as const

const METHOD = { cash: 'Cash', bank_transfer: 'Bank transfer', card: 'Credit card' } as const

export default async function ApplicationDetail({ params }: { params: Promise<{ id: string }> }) {
  await requirePlatformAdmin()
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound()
  const db = platformDb()
  const app = await db.query.spaApplications.findFirst({ where: eq(spaApplications.id, id) })
  if (!app) notFound()
  const [planRows, settings, reviewer] = await Promise.all([
    db.select().from(plans).orderBy(asc(plans.sort), asc(plans.createdAt)),
    db.query.platformSettings.findFirst({ where: eq(platformSettings.id, 1) }),
    app.reviewedBy ? db.query.user.findFirst({ where: eq(user.id, app.reviewedBy) }) : undefined,
  ])
  const plan = planRows.find((p) => p.id === app.planId)
  // Live check, on every view: the address may have been taken since the application was sent.
  const slug = SLUG_TEXT[await slugStatus(db, app.slug, { exceptApplicationId: app.id })]
  const today = todayDubai()
  // PLAN §18.8: new spas start on an offered plan (Premium / Standard); the legacy yearly plan is never offered.
  const choices: PlanChoice[] = planRows
    .filter((p) => p.active && !isLegacyPlan(p))
    .map((p) => ({
      id: p.id,
      label: `${p.name} · ${planPriceLine(p)} (excl. VAT)`,
      feeAed: p.setupFeeAed,
      monthlyAed: p.billingInterval === 'month' ? (Number(p.priceAed) / 12).toFixed(2) : null,
    }))
  // The applicant's plan is gone from the offer (archived, R19; inactive; or the legacy plan): say so, and make the
  // super-admin pick one on accept instead of quietly defaulting to the first offered plan.
  const offered = Boolean(plan && choices.some((c) => c.id === plan.id))
  const logo =
    app.logoBytes && app.logoContentType
      ? `data:${app.logoContentType};base64,${app.logoBytes.toString('base64')}`
      : null
  const rows: [string, React.ReactNode][] = [
    ['Applicant', app.applicantName],
    [
      'Email',
      <a key="e" href={`mailto:${app.email}`} className="hover:text-accent">
        {app.email}
      </a>,
    ],
    ['Mobile', app.phone],
    ['Spa name', app.spaName],
    [
      'Web address',
      <span key="s" className="inline-flex flex-wrap items-center gap-2">
        <span>{canonicalUrls().site(app.slug)}</span>
        {app.status === 'pending' && (
          <Badge tone={slug.tone} data-testid="slug-check">
            {slug.text}
          </Badge>
        )}
      </span>,
    ],
    ['Emirate', emirateName(app.emirate)],
    ['Street address', app.streetAddress],
    ['Plan', plan ? `${plan.name} · ${planPriceLine(plan)}${offered ? '' : ' (no longer offered)'}` : '—'],
    ['Preferred start', formatDate(app.preferredStart)],
    ['Notes', app.notes ?? '—'],
    ['Sent', formatDateTime(app.createdAt)],
  ]
  const pay = app.setupPayment
  return (
    <>
      <PageHeader
        title={app.spaName}
        description={`Application from ${app.applicantName}`}
        actions={
          <Badge tone={statusTone(app.status)}>{app.status === 'approved' ? 'accepted' : app.status}</Badge>
        }
      />
      <PageBody>
        <Link
          href={adminPath('/applications')}
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg"
        >
          <ArrowLeft className="size-4" /> All applications
        </Link>
        <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Card>
            <CardHeader title="What they sent" />
            <CardBody>
              <dl className="divide-y border-y text-sm">
                {rows.map(([k, v]) => (
                  <div key={k} className="grid gap-1 py-2.5 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-4">
                    <dt className="text-muted">{k}</dt>
                    <dd className="break-words font-medium">{v}</dd>
                  </div>
                ))}
                <div className="grid gap-1 py-2.5 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-4">
                  <dt className="text-muted">Logo</dt>
                  <dd>
                    {logo ? (
                      // biome-ignore lint/performance/noImgElement: small inline data URL
                      <img
                        src={logo}
                        alt={`${app.spaName} logo`}
                        className="size-20 rounded-lg border object-contain"
                      />
                    ) : (
                      <span className="text-muted">None</span>
                    )}
                  </dd>
                </div>
              </dl>
            </CardBody>
          </Card>
          <Card>
            {app.status === 'pending' ? (
              <>
                <CardHeader
                  title="Review"
                  description="Accept creates the spa (owner login = this applicant, active subscription from the start date, setup invoice + payment, the plan's invoices from the start date). Reject closes the applicant's login."
                />
                <CardBody className="flex flex-wrap gap-3">
                  <AcceptSheet
                    action={acceptApplicationAction.bind(null, app.id)}
                    plans={choices}
                    planId={plan ? (offered ? plan.id : '') : (choices[0]?.id ?? '')}
                    unofferedPlan={plan && !offered ? plan.name : undefined}
                    startDate={app.preferredStart}
                    today={today}
                    vatRate={Number(settings?.vatRate ?? 5)}
                    pricesIncludeVat={Boolean(settings?.pricesIncludeVat)}
                  />
                  <RejectSheet action={rejectApplicationAction.bind(null, app.id)} />
                </CardBody>
              </>
            ) : (
              <>
                <CardHeader
                  title={app.status === 'approved' ? 'Accepted' : 'Rejected'}
                  description={`${reviewer ? `By ${reviewer.email}` : 'Reviewed'}${
                    app.reviewedAt ? ` · ${formatDateTime(app.reviewedAt)}` : ''
                  }`}
                />
                <CardBody className="space-y-3 text-sm">
                  {app.status === 'approved' && app.createdTenantId && (
                    <p>
                      <Link
                        href={adminPath(`/tenants/${app.createdTenantId}`)}
                        className="font-medium text-accent hover:underline"
                      >
                        Open the spa
                      </Link>
                    </p>
                  )}
                  {pay && pay.kind !== 'none' && (
                    <p data-testid="setup-payment">
                      Setup fee {pay.kind === 'full' ? 'paid in full' : 'deposit'}:{' '}
                      {formatAed(pay.amountAed ?? '0')} on {formatDate(pay.paidOn ?? '')} by{' '}
                      {pay.method ? METHOD[pay.method] : '—'}
                      {pay.reference ? ` (ref ${pay.reference})` : ''} · invoice {pay.invoiceNumber}
                      {pay.vat === false ? ' (no VAT)' : ''}
                      {pay.discountAed
                        ? ` · discount ${pay.discountLabel} (−${formatAed(pay.discountAed)})`
                        : ''}
                      {Number(pay.balanceAed ?? 0) > 0
                        ? ` · balance due ${formatAed(pay.balanceAed!)}${pay.dueDate ? ` by ${formatDate(pay.dueDate)}` : ''}`
                        : ''}
                    </p>
                  )}
                  {pay?.kind === 'none' && (
                    <p>
                      {pay.discountAed
                        ? `Setup fee waived (discount ${pay.discountLabel}).`
                        : 'No setup fee on this plan.'}
                    </p>
                  )}
                  {app.status === 'rejected' && (
                    <p>
                      {app.rejectionReason
                        ? `Reason: ${app.rejectionReason} (${app.shareReason ? 'shown to the applicant' : 'not shown to the applicant'})`
                        : 'No reason given.'}
                    </p>
                  )}
                </CardBody>
              </>
            )}
          </Card>
        </div>
      </PageBody>
    </>
  )
}
