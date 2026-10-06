import {
  auditLog,
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
import { asc, desc, eq } from 'drizzle-orm'
import { ArrowLeft, ArrowUpRight } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Badge, statusTone } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { Input, Select, Textarea } from '@/components/ui/input'
import { PageBody, PageHeader } from '@/components/ui/page'
import { DataTable } from '@/components/ui/table'
import { adminPath, appUrl } from '@/lib/paths'
import { formatAed, formatDate, formatDateTime, todayDubai } from '@/lib/utils'
import { publicSiteUrl } from '@/server/sites'
import {
  createInvoiceAction,
  recordPaymentAction,
  setTenantStatusAction,
  updateSubscriptionAction,
} from '../../actions'

const UUID = /^[0-9a-f-]{36}$/i

export default async function TenantDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) notFound()
  const db = platformDb()
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, id) })
  if (!tenant) notFound()
  const [sub, planRows, invoices, payments, team, events] = await Promise.all([
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
  ])
  const today = todayDubai()
  const site = await publicSiteUrl(tenant)
  const openInvoices = invoices.filter((i) => i.status === 'issued')

  return (
    <>
      <Link
        href={adminPath('/tenants')}
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-fg"
      >
        <ArrowLeft className="size-4" strokeWidth={1.5} /> Spas
      </Link>
      <PageHeader
        eyebrow={<Badge tone={statusTone(tenant.status)}>{tenant.status}</Badge>}
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
              <a href={appUrl(`/${tenant.slug}`)} target="_blank" rel="noreferrer">
                Open dashboard <ArrowUpRight />
              </a>
            </Button>
          </>
        }
      />
      <PageBody>
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
                <Field label="Plan" name="planId">
                  <Select
                    id="planId"
                    name="planId"
                    defaultValue={sub?.planId ?? tenant.planId ?? planRows[0]?.id}
                  >
                    {planRows.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} — {formatAed(p.priceAed)}/{p.billingInterval}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Status" name="status">
                  <Select id="status" name="status" defaultValue={sub?.status ?? 'trialing'}>
                    {['trialing', 'active', 'past_due', 'cancelled'].map((s) => (
                      <option key={s} value={s}>
                        {s.replace('_', ' ')}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Price (AED)" name="priceAed" hint="Agreed price for this spa.">
                  <Input
                    id="priceAed"
                    name="priceAed"
                    inputMode="decimal"
                    defaultValue={sub?.priceAed ?? planRows[0]?.priceAed}
                  />
                </Field>
                <Field label="Setup fee (AED)" name="setupFeeAed">
                  <Input
                    id="setupFeeAed"
                    name="setupFeeAed"
                    inputMode="decimal"
                    defaultValue={sub?.setupFeeAed ?? '0'}
                  />
                </Field>
                <Field label="Billing" name="billingInterval">
                  <Select
                    id="billingInterval"
                    name="billingInterval"
                    defaultValue={sub?.billingInterval ?? 'year'}
                  >
                    <option value="year">Yearly</option>
                    <option value="month">Monthly</option>
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
          <CardHeader title="Invoices" />
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
                  cell: (r) => <span className="tabular">{formatAed(r.totalAed)}</span>,
                },
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
      </PageBody>
    </>
  )
}
