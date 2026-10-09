import { planPriceLine, toUaeE164 } from '@spa/core'
import {
  auditLog,
  branches,
  members,
  plans,
  platformDb,
  platformInvoices,
  platformPayments,
  roles,
  subscriptions,
  tenants,
  user,
} from '@spa/db'
import { billingAlert, offeredPlans, tenantEntitlements } from '@spa/services'
import { and, asc, desc, eq } from 'drizzle-orm'
import { ArrowLeft, ArrowUpRight, Download } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Badge, statusTone } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { Input, Select, Textarea } from '@/components/ui/input'
import { PageBody, PageHeader } from '@/components/ui/page'
import { DataTable } from '@/components/ui/table'
import { adminPath } from '@/lib/paths'
import { formatAed, formatDate, formatDateTime, todayDubai } from '@/lib/utils'
import { appUrl } from '@/server/origin'
import { publicSiteUrl } from '@/server/sites'
import {
  createInvoiceAction,
  deleteTenantAction,
  generateScheduleAction,
  pauseTenantAction,
  paymentReminderAction,
  purgeTenantAction,
  recordPaymentAction,
  setInvoicePaidAction,
  setTenantStatusAction,
  updateSubscriptionAction,
} from '../../actions'
import { PlanCard } from './plan-card'
import { PaymentReminder } from './reminder'

const UUID = /^[0-9a-f-]{36}$/i

export default async function TenantDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) notFound()
  const db = platformDb()
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, id) })
  if (!tenant) notFound()
  const today = todayDubai()
  const [sub, planRows, invoices, payments, team, events, branch, alert, ent, offered] = await Promise.all([
    db.query.subscriptions.findFirst({ where: eq(subscriptions.tenantId, id) }),
    db.select().from(plans).orderBy(asc(plans.sort)),
    db
      .select()
      .from(platformInvoices)
      .where(eq(platformInvoices.tenantId, id))
      .orderBy(desc(platformInvoices.issueDate)),
    db
      .select()
      .from(platformPayments)
      .where(eq(platformPayments.tenantId, id))
      .orderBy(desc(platformPayments.receivedAt)),
    db
      .select({
        id: members.id,
        name: user.name,
        email: user.email,
        role: roles.name,
        status: members.status,
      })
      .from(members)
      .innerJoin(user, eq(user.id, members.userId))
      .innerJoin(roles, eq(roles.id, members.roleId))
      .where(eq(members.tenantId, id)),
    db.select().from(auditLog).where(eq(auditLog.tenantId, id)).orderBy(desc(auditLog.createdAt)).limit(15),
    db.query.branches.findFirst({ where: and(eq(branches.tenantId, id), eq(branches.isDefault, true)) }),
    billingAlert(db, id, today),
    tenantEntitlements(db, id),
    offeredPlans(db),
  ])
  const currentPlan = planRows.find((p) => p.id === (sub?.planId ?? tenant.planId))
  const ownerPhone =
    (branch?.whatsappE164 && toUaeE164(branch.whatsappE164)) ||
    (branch?.phone && toUaeE164(branch.phone)) ||
    null
  const paused = tenant.status === 'read_only'
  const deleted = Boolean(tenant.deletedAt)
  const site = await publicSiteUrl(tenant)
  const exportUrl = await appUrl(`/${tenant.slug}/settings/data/export?type=full`)
  const openInvoices = invoices.filter((i) => i.status === 'issued')
  // Partly paid invoices (e.g. a setup-fee deposit, PLAN §18.3) stay issued with a balance due.
  const paidOn = new Map<string, number>()
  for (const p of payments)
    if (p.invoiceId) paidOn.set(p.invoiceId, (paidOn.get(p.invoiceId) ?? 0) + Number(p.amountAed))
  const balanceOf = (i: { id: string; totalAed: string }) =>
    Math.max(0, Number(i.totalAed) - (paidOn.get(i.id) ?? 0))
  // Net received (a "Mark unpaid" reversal brings it back to 0, so that invoice is plain unpaid again).
  const partPaid = (i: { id: string }) => (paidOn.get(i.id) ?? 0) > 0.005
  // Due now = open balances whose due date has come; outstanding also counts later installments.
  const dueNow = openInvoices.filter((i) => i.dueDate <= today).reduce((s, i) => s + balanceOf(i), 0)
  const outstanding = openInvoices.reduce((s, i) => s + balanceOf(i), 0)

  return (
    <>
      <Link
        href={adminPath('/tenants')}
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-fg"
      >
        <ArrowLeft className="size-4" strokeWidth={1.5} /> Spas
      </Link>
      <PageHeader
        eyebrow={
          <Badge tone={deleted ? 'danger' : statusTone(tenant.status)}>
            {deleted ? 'deleted' : paused ? 'paused' : tenant.status}
          </Badge>
        }
        title={tenant.name}
        description={`${tenant.slug} · joined ${formatDate(tenant.createdAt)}`}
        actions={
          <>
            <Button variant="secondary" asChild>
              <a href={site} target="_blank" rel="noreferrer">
                Website <ArrowUpRight />
              </a>
            </Button>
            <Button variant="secondary" asChild>
              <a href={await appUrl(`/${tenant.slug}`)} target="_blank" rel="noreferrer">
                Open dashboard <ArrowUpRight />
              </a>
            </Button>
          </>
        }
      />
      <PageBody>
        <PlanCard tenantId={id} sub={sub} current={currentPlan} offered={offered} ent={ent} today={today} />
        <div className="grid gap-6 xl:grid-cols-12">
          <Card className="xl:col-span-7">
            <CardHeader
              title="Subscription"
              description="Price, period and status. Changes apply immediately."
            />
            <CardBody>
              <ActionForm
                action={updateSubscriptionAction.bind(null, id)}
                className="grid gap-5 sm:grid-cols-2"
              >
                {sub && currentPlan ? (
                  // PLAN §18.8: the plan changes with "Switch plan" (Plan & features), not here.
                  <Field label="Plan" name="planId" hint="Change it with Switch plan above.">
                    <input type="hidden" name="planId" value={sub.planId} />
                    <p className="pt-2 text-sm font-medium">
                      {currentPlan.name} · {planPriceLine(currentPlan)}
                    </p>
                  </Field>
                ) : (
                  <Field label="Plan" name="planId">
                    <Select id="planId" name="planId" defaultValue={tenant.planId ?? offered[0]?.id}>
                      {offered.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} — {planPriceLine(p)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                <Field label="Status" name="status">
                  <Select id="status" name="status" defaultValue={sub?.status ?? 'trialing'}>
                    {['trialing', 'active', 'past_due', 'cancelled'].map((s) => (
                      <option key={s} value={s}>
                        {s.replace('_', ' ')}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label="Price per 12 months (AED)"
                  name="priceAed"
                  hint="Agreed price for the period (monthly plans: 12 × the monthly fee, e.g. 3,000 → 36,000)."
                >
                  <Input
                    id="priceAed"
                    name="priceAed"
                    inputMode="decimal"
                    defaultValue={sub?.priceAed ?? planRows[0]?.priceAed}
                  />
                </Field>
                <Field label="Setup fee (AED)" name="setupFeeAed" hint="One-off, billed as its own invoice.">
                  <Input
                    id="setupFeeAed"
                    name="setupFeeAed"
                    inputMode="decimal"
                    defaultValue={sub?.setupFeeAed ?? '0'}
                  />
                </Field>
                <Field label="Payment plan" name="billingInterval">
                  <Select
                    id="billingInterval"
                    name="billingInterval"
                    defaultValue={sub?.billingInterval ?? 'year'}
                  >
                    <option value="year">One-time annual</option>
                    <option value="month">12 monthly invoices</option>
                  </Select>
                </Field>
                <Field label="Grace days" name="graceDays">
                  <Input
                    id="graceDays"
                    name="graceDays"
                    type="number"
                    min={0}
                    defaultValue={sub?.graceDays ?? 14}
                  />
                </Field>
                <Field label="Period start" name="currentPeriodStart">
                  <Input
                    id="currentPeriodStart"
                    name="currentPeriodStart"
                    type="date"
                    defaultValue={sub?.currentPeriodStart ?? today}
                  />
                </Field>
                <Field label="Period end" name="currentPeriodEnd">
                  <Input
                    id="currentPeriodEnd"
                    name="currentPeriodEnd"
                    type="date"
                    defaultValue={sub?.currentPeriodEnd ?? today}
                  />
                </Field>
                <Field label="Notes" name="notes" className="sm:col-span-2">
                  <Textarea id="notes" name="notes" defaultValue={sub?.notes ?? ''} />
                </Field>
                <div className="flex justify-end sm:col-span-2">
                  <SubmitButton>Save subscription</SubmitButton>
                </div>
              </ActionForm>
            </CardBody>
          </Card>
          <div className="space-y-6 xl:col-span-5">
            <Card>
              <CardHeader
                title="Account"
                description={
                  alert.overdue.length
                    ? `${alert.overdue.length} overdue invoice${alert.overdue.length === 1 ? '' : 's'} · ${formatAed(alert.overdueAed)}`
                    : 'No overdue invoices.'
                }
              />
              <CardBody className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {paused || deleted || tenant.status === 'suspended' ? (
                    <ActionForm action={pauseTenantAction.bind(null, id, false)}>
                      <SubmitButton>{deleted ? 'Restore spa' : 'Resume spa'}</SubmitButton>
                    </ActionForm>
                  ) : (
                    <ActionForm action={pauseTenantAction.bind(null, id, true)}>
                      <SubmitButton variant="secondary">Pause spa</SubmitButton>
                    </ActionForm>
                  )}
                </div>
                <p className="text-xs text-muted">
                  Paused: the dashboard is read-only with a notice; the website and online booking keep
                  working.
                </p>
                <PaymentReminder action={paymentReminderAction.bind(null, id)} phone={ownerPhone} />
                {alert.reminder && (
                  <p className="text-xs text-muted">
                    Open reminder since {formatDateTime(alert.reminder.createdAt)} ·{' '}
                    {formatAed(alert.reminder.amountAed)}
                  </p>
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Access" description="Read-only keeps the website live but blocks changes." />
              <CardBody>
                <ActionForm action={setTenantStatusAction.bind(null, id)} className="flex gap-3">
                  <Select name="status" defaultValue={tenant.status} aria-label="Status">
                    {['trial', 'active', 'past_due', 'read_only', 'suspended', 'cancelled'].map((s) => (
                      <option key={s} value={s}>
                        {s.replace('_', ' ')}
                      </option>
                    ))}
                  </Select>
                  <SubmitButton variant="secondary">Update</SubmitButton>
                </ActionForm>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Record a payment" description="Cash or bank transfer received." />
              <CardBody>
                <ActionForm
                  action={recordPaymentAction.bind(null, id)}
                  className="grid gap-4 sm:grid-cols-2"
                  resetOnSuccess
                >
                  <Field label="Amount (AED)" name="amountAed">
                    <Input id="amountAed" name="amountAed" inputMode="decimal" required />
                  </Field>
                  <Field label="Method" name="method">
                    <Select id="method" name="method" defaultValue="bank_transfer">
                      <option value="bank_transfer">Bank transfer</option>
                      <option value="cash">Cash</option>
                      <option value="card">Credit card</option>
                      <option value="other">Other</option>
                    </Select>
                  </Field>
                  <Field label="Received on" name="receivedAt">
                    <Input id="receivedAt" name="receivedAt" type="date" defaultValue={today} />
                  </Field>
                  <Field label="Reference" name="reference">
                    <Input id="reference" name="reference" placeholder="Transfer ref / receipt no." />
                  </Field>
                  <Field label="Against invoice" name="invoiceId" className="sm:col-span-2">
                    <Select id="invoiceId" name="invoiceId" defaultValue="">
                      <option value="">— None —</option>
                      {openInvoices.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.number} · {formatAed(i.totalAed)}
                          {partPaid(i) ? ` · balance ${formatAed(balanceOf(i))}` : ''}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <div className="flex justify-end sm:col-span-2">
                    <SubmitButton>Record payment</SubmitButton>
                  </div>
                </ActionForm>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="New invoice" description="VAT is added from your company settings." />
              <CardBody>
                <ActionForm
                  action={createInvoiceAction.bind(null, id)}
                  className="grid gap-4 sm:grid-cols-2"
                  resetOnSuccess
                >
                  <Field label="Description" name="description" className="sm:col-span-2">
                    <Input
                      id="description"
                      name="description"
                      defaultValue={`Annual subscription ${today.slice(0, 4)}`}
                    />
                  </Field>
                  <Field label="Amount (AED)" name="amountAed">
                    <Input
                      id="invAmount"
                      name="amountAed"
                      inputMode="decimal"
                      defaultValue={sub?.priceAed ?? ''}
                    />
                  </Field>
                  <Field label="Issue date" name="issueDate">
                    <Input id="issueDate" name="issueDate" type="date" defaultValue={today} />
                  </Field>
                  <Field label="Due date" name="dueDate">
                    <Input id="dueDate" name="dueDate" type="date" defaultValue={today} />
                  </Field>
                  <div className="flex items-end justify-end">
                    <SubmitButton variant="secondary">Create invoice</SubmitButton>
                  </div>
                </ActionForm>
              </CardBody>
            </Card>
          </div>
        </div>
        <Card>
          <CardHeader
            title="Invoices"
            description={`Payment plan + setup fee invoices for the current period. Only you set Paid / Must pay.${
              dueNow > 0 ? ` Due now: ${formatAed(dueNow)}.` : ''
            }${outstanding > dueNow + 0.005 ? ` Outstanding: ${formatAed(outstanding)}.` : ''}`}
            action={
              <ActionForm action={generateScheduleAction.bind(null, id)}>
                <SubmitButton variant="secondary">Generate payment schedule</SubmitButton>
              </ActionForm>
            }
          />
          <div className="mt-4 border-t">
            <DataTable
              rows={invoices}
              rowKey={(r) => r.id}
              empty={<p className="px-6 py-8 text-sm text-muted">No invoices yet.</p>}
              columns={[
                {
                  key: 'n',
                  header: 'Number',
                  primary: true,
                  cell: (r) => <span className="font-medium">{r.number}</span>,
                },
                { key: 'd', header: 'Description', cell: (r) => r.description, hideOnMobile: true },
                { key: 'due', header: 'Due', cell: (r) => formatDate(r.dueDate) },
                {
                  key: 't',
                  header: 'Total',
                  className: 'text-end',
                  cell: (r) => (
                    <span className="tabular">
                      {formatAed(r.totalAed)}
                      {/* A setup invoice accepted without VAT (PLAN §18.3). */}
                      {Number(r.vatAed) === 0 && Number(r.totalAed) > 0 && (
                        <span className="text-muted"> · no VAT</span>
                      )}
                      {/* A per-spa discount (PLAN §18.8): list amount and what came off. */}
                      {r.discountAed && Number(r.discountAed) > 0 && (
                        <span className="block text-xs text-muted" data-testid="invoice-discount">
                          list {formatAed(r.listAed ?? 0)} · discount {r.discountLabel} −
                          {formatAed(r.discountAed)}
                        </span>
                      )}
                    </span>
                  ),
                },
                {
                  key: 'p',
                  header: 'Paid',
                  className: 'text-end',
                  hideOnMobile: true,
                  cell: (r) => <span className="tabular">{formatAed(paidOn.get(r.id) ?? 0)}</span>,
                },
                {
                  key: 'b',
                  header: 'Balance',
                  className: 'text-end',
                  cell: (r) =>
                    r.status === 'issued' ? (
                      <span className="tabular font-medium">{formatAed(balanceOf(r))}</span>
                    ) : (
                      <span className="text-muted">—</span>
                    ),
                },
                {
                  key: 's',
                  header: 'Status',
                  className: 'text-end',
                  cell: (r) => (
                    <Badge
                      tone={r.status === 'issued' && r.dueDate < today ? 'danger' : statusTone(r.status)}
                    >
                      {r.status === 'issued' && r.dueDate < today
                        ? 'overdue'
                        : r.status === 'issued' && partPaid(r)
                          ? 'part paid'
                          : r.status}
                    </Badge>
                  ),
                },
                {
                  key: 'x',
                  header: <span className="sr-only">Mark</span>,
                  className: 'text-end',
                  cell: (r) =>
                    r.status === 'void' ? null : (
                      <ActionForm action={setInvoicePaidAction.bind(null, id, r.id, r.status !== 'paid')}>
                        <SubmitButton size="sm" variant={r.status === 'paid' ? 'ghost' : 'secondary'}>
                          {r.status === 'paid' ? 'Mark unpaid' : 'Mark paid'}
                        </SubmitButton>
                      </ActionForm>
                    ),
                },
              ]}
            />
          </div>
        </Card>
        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader title="Payments" />
            <div className="mt-4 border-t">
              <DataTable
                rows={payments}
                rowKey={(r) => r.id}
                empty={<p className="px-6 py-8 text-sm text-muted">No payments recorded.</p>}
                columns={[
                  { key: 'd', header: 'Date', primary: true, cell: (r) => formatDate(r.receivedAt) },
                  { key: 'm', header: 'Method', cell: (r) => r.method.replace('_', ' ') },
                  { key: 'r', header: 'Reference', cell: (r) => r.reference ?? '—' },
                  {
                    key: 'a',
                    header: 'Amount',
                    className: 'text-end',
                    cell: (r) => <span className="tabular">{formatAed(r.amountAed)}</span>,
                  },
                ]}
              />
            </div>
          </Card>
          <Card>
            <CardHeader title="Team" />
            <div className="mt-4 border-t">
              <DataTable
                rows={team}
                rowKey={(r) => r.id}
                columns={[
                  {
                    key: 'n',
                    header: 'Name',
                    primary: true,
                    cell: (r) => (
                      <span>
                        <span className="block font-medium">{r.name}</span>
                        <span className="text-xs text-muted">{r.email}</span>
                      </span>
                    ),
                  },
                  { key: 'r', header: 'Role', cell: (r) => r.role },
                  {
                    key: 's',
                    header: 'Status',
                    className: 'text-end',
                    cell: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge>,
                  },
                ]}
              />
            </div>
          </Card>
        </div>
        <Card>
          <CardHeader title="Recent activity" />
          <CardBody>
            <ul className="space-y-3 text-sm">
              {events.length === 0 && <li className="text-muted">Nothing yet.</li>}
              {events.map((e) => (
                <li key={e.id} className="flex flex-wrap justify-between gap-2">
                  <span className="font-medium">{e.action}</span>
                  <span className="text-muted">{formatDateTime(e.createdAt)}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
        {deleted && (
          <Card>
            <CardHeader
              title="Permanently delete"
              description="Removes every record of this spa for good: clients, bookings, sales and the ledger, files, website, custom domains, integrations and the audit log. Cannot be undone. Download the export first; a purge record (who, when, row counts) is kept."
            />
            <CardBody className="space-y-4">
              <Button variant="secondary" asChild>
                <a href={exportUrl} target="_blank" rel="noreferrer">
                  <Download /> Download full export
                </a>
              </Button>
              <ActionForm
                action={purgeTenantAction.bind(null, id)}
                className="flex flex-wrap items-end gap-3"
              >
                <Field label={`Type ${tenant.slug} to permanently delete`} name="confirm">
                  <Input id="confirm" name="confirm" autoComplete="off" required />
                </Field>
                <SubmitButton variant="danger">Permanently delete</SubmitButton>
              </ActionForm>
            </CardBody>
          </Card>
        )}
        {!deleted && (
          <Card>
            <CardHeader
              title="Delete spa"
              description="Closes the dashboard, website and booking. Every record is kept; Restore brings it back. Permanent deletion is offered once the spa is deleted."
            />
            <CardBody className="space-y-4">
              <Button variant="secondary" asChild>
                <a href={exportUrl} target="_blank" rel="noreferrer">
                  <Download /> Download full export
                </a>
              </Button>
              <ActionForm
                action={deleteTenantAction.bind(null, id)}
                className="flex flex-wrap items-end gap-3"
              >
                <Field label={`Type ${tenant.slug} to confirm`} name="confirm">
                  <Input id="confirm" name="confirm" autoComplete="off" required />
                </Field>
                <SubmitButton variant="danger">Delete spa</SubmitButton>
              </ActionForm>
            </CardBody>
          </Card>
        )}
      </PageBody>
    </>
  )
}
