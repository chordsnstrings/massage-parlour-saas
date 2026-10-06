import { clients, intakeSubmissions, intakeTemplates, withTenant } from '@spa/db'
import { and, eq } from 'drizzle-orm'
import { ArrowLeft } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { SignatureImage } from '@/components/clients/signature-pad'
import { Badge } from '@/components/ui/badge'
import { Card, CardBody } from '@/components/ui/card'
import { PageBody } from '@/components/ui/page'
import { appPath } from '@/lib/paths'
import { formatDateTime } from '@/lib/utils'
import { can, requireMember } from '@/server/access'
import { PrintButton } from './print-button'

export const metadata: Metadata = { title: 'Signed intake' }

const humanize = (key: string) => key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
const ANSWER_AR: Record<string, string> = { yes: 'نعم', no: 'لا' }

/** Print only the document, not the dashboard chrome. */
const PRINT_CSS = `@media print {
  @page { margin: 16mm; }
  body * { visibility: hidden !important; }
  #intake-document, #intake-document * { visibility: visible !important; }
  #intake-document { position: absolute; inset: 0 auto auto 0; width: 100%; border: 0 !important; }
}`

export default async function IntakeSubmissionPage({
  params,
}: {
  params: Promise<{ tenant: string; id: string; submissionId: string }>
}) {
  const { tenant, id, submissionId } = await params
  const ctx = await requireMember(tenant)
  if (!can(ctx, 'clients.view')) notFound()
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(submissionId).success) notFound()
  const row = await withTenant(ctx.tenant.id, async (tx) => {
    const [r] = await tx
      .select({
        submission: intakeSubmissions,
        clientName: clients.name,
        templateName: intakeTemplates.name,
        fields: intakeTemplates.fields,
      })
      .from(intakeSubmissions)
      .innerJoin(clients, eq(clients.id, intakeSubmissions.clientId))
      .leftJoin(intakeTemplates, eq(intakeTemplates.id, intakeSubmissions.templateId))
      .where(and(eq(intakeSubmissions.id, submissionId), eq(intakeSubmissions.clientId, id)))
    return r
  })
  if (!row) notFound()
  const { submission: s, clientName, templateName, fields } = row
  const lang = s.answers._lang === 'ar' ? 'ar' : 'en'
  const answered = (fields ?? []).map((f) => ({
    key: f.key,
    label: (lang === 'ar' && f.label.ar) || f.label.en,
    value: s.answers[f.key],
  }))
  // Answers whose question is no longer on the (versioned) template are still shown.
  const known = new Set(answered.map((a) => a.key))
  for (const [key, value] of Object.entries(s.answers))
    if (!key.startsWith('_') && !known.has(key)) answered.push({ key, label: humanize(key), value })
  const show = (v: string | undefined) => (v ? (lang === 'ar' ? (ANSWER_AR[v] ?? v) : humanize(v)) : '—')

  return (
    <PageBody className="mx-auto max-w-3xl">
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static print stylesheet */}
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href={appPath(`/${ctx.tenant.slug}/clients/${id}`)}
          className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted hover:text-fg"
        >
          <ArrowLeft className="size-4" /> {clientName}
        </Link>
        <PrintButton />
      </div>
      <Card
        id="intake-document"
        dir={lang === 'ar' ? 'rtl' : 'ltr'}
        lang={lang}
        className="print:shadow-none"
      >
        <CardBody className="space-y-8 sm:px-10 sm:py-10">
          <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-6">
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted">{ctx.tenant.name}</p>
              <h1 className="text-2xl font-semibold tracking-tight">{templateName ?? 'Intake form'}</h1>
              <p className="text-[15px]">{clientName}</p>
            </div>
            <Badge tone="accent">v{s.templateVersion}</Badge>
          </header>
          <dl className="divide-y">
            {answered.map((a, i) => (
              <div key={a.key} className="grid gap-1 py-3.5 sm:grid-cols-12 sm:gap-6">
                <dt className="text-sm text-muted sm:col-span-7">
                  <span className="tabular-nums">{i + 1}.</span> {a.label}
                </dt>
                <dd className="whitespace-pre-wrap text-[15px] font-medium sm:col-span-5 sm:text-end">
                  {show(a.value)}
                </dd>
              </div>
            ))}
          </dl>
          <section className="space-y-3 rounded-xl bg-subtle/60 p-5 print:bg-transparent print:p-0">
            <h2 className="text-sm font-semibold">{lang === 'ar' ? 'الإقرار والموافقة' : 'Consent'}</h2>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{s.waiverText}</p>
          </section>
          <section className="grid gap-6 sm:grid-cols-12">
            <div className="sm:col-span-7">
              <p className="mb-2 text-xs font-medium uppercase tracking-[0.06em] text-muted">
                {lang === 'ar' ? 'التوقيع' : 'Signature'}
              </p>
              <div className="rounded-xl border px-3 py-2" data-testid="signature">
                <SignatureImage path={s.signature} />
              </div>
            </div>
            <dl className="space-y-3 text-sm sm:col-span-5 sm:self-end">
              <div>
                <dt className="text-muted">{lang === 'ar' ? 'تاريخ التوقيع' : 'Signed'}</dt>
                <dd className="font-medium tabular-nums">{formatDateTime(s.signedAt)} (Dubai)</dd>
              </div>
              {s.ip && (
                <div>
                  <dt className="text-muted">IP</dt>
                  <dd className="font-mono text-[13px]">{s.ip}</dd>
                </div>
              )}
              <div>
                <dt className="text-muted">Ref</dt>
                <dd className="font-mono text-[13px]">{s.id.slice(0, 8)}</dd>
              </div>
            </dl>
          </section>
        </CardBody>
      </Card>
    </PageBody>
  )
}
