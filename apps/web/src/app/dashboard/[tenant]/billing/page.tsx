import {
  plans,
  platformDb,
  platformInvoices,
  platformPayments,
  platformSettings,
  subscriptions,
  withTenant,
} from '@spa/db'
import { desc, eq } from 'drizzle-orm'
import { MessageCircle, ReceiptText } from 'lucide-react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Badge, statusTone } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { DataTable } from '@/components/ui/table'
import { formatAed, formatDate } from '@/lib/utils'
import { can, requireMember } from '@/server/access'

export const metadata: Metadata = { title: 'Subscription' }

export default async function BillingPage({ params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'billing.view')) notFound()
  const { sub, invoices, payments } = await withTenant(ctx.tenant.id, async (tx) => ({
    sub: (await tx.select().from(subscriptions).limit(1))[0],
    invoices: await tx.select().from(platformInvoices).orderBy(desc(platformInvoices.issueDate)),
    payments: await tx.select().from(platformPayments).orderBy(desc(platformPayments.receivedAt)),
  }))
  const [plan, company] = await Promise.all([
    sub ? platformDb().query.plans.findFirst({ where: eq(plans.id, sub.planId) }) : undefined,
    platformDb().query.platformSettings.findFirst({ where: eq(platformSettings.id, 1) }),
  ])
  const bank = [
    ['Bank', company?.bankName],
    ['Account name', company?.bankAccountName],
    ['IBAN', company?.iban],
    ['SWIFT', company?.swift],
  ].filter(([, v]) => v)

  return (
    <>
      <PageHeader
        title="Subscription"
        description="Your plan, invoices and payments. Pay by bank transfer or cash."
      />
      <PageBody>
        <div className="grid gap-6 lg:grid-cols-12">
          <Card className="lg:col-span-7">
            <CardHeader
              title={plan?.name ?? 'Plan'}
              action={sub && <Badge tone={statusTone(sub.status)}>{sub.status}</Badge>}
            />
            <CardBody className="grid gap-6 sm:grid-cols-3">
              <div>
                <p className="text-xs uppercase tracking-[0.06em] text-muted">Price</p>
                <p className="tabular mt-1 text-xl font-semibold tracking-tight">
                  {sub ? formatAed(sub.priceAed) : '—'}
                </p>
                <p className="text-xs text-muted">per {sub?.billingInterval ?? 'year'}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.06em] text-muted">Current period</p>
                <p className="mt-1 text-sm">
                  {sub ? `${formatDate(sub.currentPeriodStart)} – ${formatDate(sub.currentPeriodEnd)}` : '—'}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.06em] text-muted">
                  {sub?.status === 'trialing' ? 'Trial ends' : 'Next payment due'}
                </p>
                <p className="mt-1 text-sm">{sub ? formatDate(sub.currentPeriodEnd) : '—'}</p>
              </div>
            </CardBody>
          </Card>
          <Card className="lg:col-span-5">
            <CardHeader title="How to pay" description="Bank transfer or cash to your account manager." />
            <CardBody className="space-y-4">
              {bank.length > 0 ? (
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                  {bank.map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-muted">{k}</dt>
                      <dd className="break-all font-medium">{v}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-sm text-muted">Bank details will appear here.</p>
              )}
              {company?.whatsapp && (
                <Button variant="secondary" size="sm" asChild>
                  <a
                    href={`https://wa.me/${company.whatsapp.replace(/\D/g, '')}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <MessageCircle /> Message us on WhatsApp
                  </a>
                </Button>
              )}
            </CardBody>
          </Card>
        </div>
        <Card>
          <CardHeader title="Invoices" />
          <div className="mt-4 border-t">
            <DataTable
              rows={invoices}
              rowKey={(r) => r.id}
              empty={<EmptyState icon={<ReceiptText className="size-5" />} title="No invoices yet" />}
              columns={[
                {
                  key: 'number',
                  header: 'Number',
                  primary: true,
                  cell: (r) => <span className="font-medium">{r.number}</span>,
                },
                { key: 'desc', header: 'Description', cell: (r) => r.description, hideOnMobile: true },
                { key: 'issued', header: 'Issued', cell: (r) => formatDate(r.issueDate) },
                { key: 'due', header: 'Due', cell: (r) => formatDate(r.dueDate) },
                {
                  key: 'total',
                  header: 'Total',
                  className: 'text-end',
                  cell: (r) => <span className="tabular">{formatAed(r.totalAed)}</span>,
                },
                {
                  key: 'status',
                  header: 'Status',
                  className: 'text-end',
                  cell: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge>,
                },
              ]}
            />
          </div>
        </Card>
        {payments.length > 0 && (
          <Card>
            <CardHeader title="Payments received" />
            <div className="mt-4 border-t">
              <DataTable
                rows={payments}
                rowKey={(r) => r.id}
                columns={[
                  { key: 'date', header: 'Date', primary: true, cell: (r) => formatDate(r.receivedAt) },
                  { key: 'method', header: 'Method', cell: (r) => r.method.replace('_', ' ') },
                  { key: 'ref', header: 'Reference', cell: (r) => r.reference ?? '—' },
                  {
                    key: 'amount',
                    header: 'Amount',
                    className: 'text-end',
                    cell: (r) => <span className="tabular">{formatAed(r.amountAed)}</span>,
                  },
                ]}
              />
            </div>
          </Card>
        )}
      </PageBody>
    </>
  )
}
