import { payrollLines, payrollRuns, salaryAdvances, staff, tenants, withTenant } from '@spa/db'
import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import { Banknote, Download, Landmark, Plus, Wallet } from 'lucide-react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { FormSheet } from '@/components/ui/form-sheet'
import { Input, Select } from '@/components/ui/input'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { StatCard } from '@/components/ui/stat-card'
import { type Column, DataTable } from '@/components/ui/table'
import { appPath } from '@/lib/paths'
import { formatAed, formatDate, todayDubai } from '@/lib/utils'
import { can, requireMember } from '@/server/access'
import { MonthNav, monthRange } from '../accounts/month'
import {
  finaliseRunAction,
  prepareRunAction,
  recordAdvanceAction,
  saveEmployerAction,
  saveStaffPayAction,
} from './actions'

export const metadata: Metadata = { title: 'Payroll' }

type Person = typeof staff.$inferSelect
type Line = typeof payrollLines.$inferSelect & { person: Person | undefined }

export default async function PayrollPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>
  searchParams: Promise<{ month?: string }>
}) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'staff.manage')) notFound()
  const range = monthRange((await searchParams).month)
  const slug = ctx.tenant.slug
  const data = await withTenant(ctx.tenant.id, async (tx) => {
    const [run] = await tx
      .select()
      .from(payrollRuns)
      .where(and(eq(payrollRuns.periodStart, range.from), eq(payrollRuns.periodEnd, range.to)))
      .orderBy(desc(payrollRuns.createdAt))
      .limit(1)
    return {
      run: run ?? null,
      lines: run ? await tx.select().from(payrollLines).where(eq(payrollLines.runId, run.id)) : [],
      people: await tx
        .select()
        .from(staff)
        .where(eq(staff.active, true))
        .orderBy(asc(staff.sort), asc(staff.createdAt)),
      advances: await tx
        .select()
        .from(salaryAdvances)
        .where(isNull(salaryAdvances.payrollRunId))
        .orderBy(desc(salaryAdvances.advanceDate)),
      settings: (await tx.select({ s: tenants.settings }).from(tenants).limit(1))[0]?.s ?? {},
    }
  })
  const byId = new Map(data.people.map((p) => [p.id, p]))
  const lines: Line[] = data.lines.map((l) => ({ ...l, person: byId.get(l.staffId) }))
  const total = (k: 'baseAed' | 'commissionAed' | 'tipsAed' | 'advancesAed' | 'netAed') =>
    lines.reduce((s, l) => s + Number(l[k]), 0)
  const wps = data.settings.wps
  const wpsReady = lines.filter((l) => l.person?.payroll.iban && l.person.payroll.personId)
  const base = appPath(`/${slug}/payroll`)
  const finalised = data.run?.status === 'finalised'

  const payDetails = (p: Person) => (
    <FormSheet
      title={`Pay details · ${p.displayName}`}
      description="Used for the WPS salary file. Staff without an IBAN are left out (pay them in cash)."
      action={saveStaffPayAction.bind(null, slug, p.id)}
      trigger={
        <Button variant="ghost" size="sm">
          {p.payroll.iban ? 'Pay details' : 'Add IBAN'}
        </Button>
      }
    >
      <Field label="MOHRE person code" name="personId" hint="14 digits, from the labour card or work permit.">
        <Input id="personId" name="personId" inputMode="numeric" defaultValue={p.payroll.personId} />
      </Field>
      <Field label="Labour card number" name="labourCardNo">
        <Input id="labourCardNo" name="labourCardNo" defaultValue={p.payroll.labourCardNo} />
      </Field>
      <Field label="IBAN" name="iban">
        <Input
          id="iban"
          name="iban"
          placeholder="AE07 0331 2345 6789 0123 456"
          defaultValue={p.payroll.iban}
        />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Bank routing code" name="routingCode">
          <Input
            id="routingCode"
            name="routingCode"
            inputMode="numeric"
            defaultValue={p.payroll.routingCode}
          />
        </Field>
        <Field label="Bank / exchange house" name="bank">
          <Input id="bank" name="bank" defaultValue={p.payroll.bank} />
        </Field>
      </div>
    </FormSheet>
  )

  const columns: Column<Line>[] = [
    {
      key: 'who',
      header: 'Team member',
      primary: true,
      cell: (l) => (
        <span className="flex flex-col">
          <span className="font-medium">{l.person?.displayName ?? 'Former staff'}</span>
          {!l.person?.payroll.iban && <span className="text-xs text-muted">Cash — no IBAN</span>}
        </span>
      ),
    },
    {
      key: 'base',
      header: 'Salary',
      className: 'text-right tabular-nums',
      cell: (l) => formatAed(l.baseAed),
    },
    {
      key: 'comm',
      header: 'Commission',
      className: 'text-right tabular-nums',
      cell: (l) => formatAed(l.commissionAed),
    },
    { key: 'tips', header: 'Tips', className: 'text-right tabular-nums', cell: (l) => formatAed(l.tipsAed) },
    {
      key: 'adv',
      header: 'Advances',
      className: 'text-right tabular-nums',
      cell: (l) => (Number(l.advancesAed) ? `− ${formatAed(l.advancesAed)}` : '—'),
    },
    {
      key: 'net',
      header: 'Net pay',
      className: 'text-right tabular-nums font-semibold',
      cell: (l) => formatAed(l.netAed),
    },
    {
      key: 'pay',
      header: '',
      className: 'text-right',
      cell: (l) => (l.person ? payDetails(l.person) : null),
    },
  ]

  return (
    <>
      <PageHeader
        title="Payroll"
        description="Salaries, commissions, tips and advances in one monthly run — with the WPS salary file for your bank."
        actions={
          <>
            <MonthNav base={base} range={range} />
            <FormSheet
              title="Record a salary advance"
              description="Advances are deducted automatically in the next payroll."
              action={recordAdvanceAction.bind(null, slug)}
              submitLabel="Record advance"
              trigger={
                <Button variant="secondary">
                  <Banknote /> Advance
                </Button>
              }
            >
              <Field label="Team member" name="staffId">
                <Select id="staffId" name="staffId" defaultValue="">
                  <option value="" disabled>
                    Choose…
                  </option>
                  {data.people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Amount (AED)" name="amountAed">
                  <Input id="amountAed" name="amountAed" inputMode="decimal" />
                </Field>
                <Field label="Date" name="date">
                  <Input id="date" name="date" type="date" defaultValue={todayDubai()} />
                </Field>
              </div>
              <Field label="Paid from" name="paidVia">
                <Select id="paidVia" name="paidVia" defaultValue="cash">
                  <option value="cash">Cash drawer</option>
                  <option value="bank">Bank</option>
                </Select>
              </Field>
              <Field label="Note" name="note">
                <Input id="note" name="note" />
              </Field>
            </FormSheet>
          </>
        }
      />
      <PageBody>
        {data.run && (
          <div className="grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-4">
            <StatCard label="Salaries" value={total('baseAed')} format="aed" />
            <StatCard label="Commission" value={total('commissionAed')} format="aed" />
            <StatCard label="Tips" value={total('tipsAed')} format="aed" />
            <StatCard
              label="Net to pay"
              value={total('netAed')}
              format="aed"
              hint={lines.length === 1 ? '1 person' : `${lines.length} people`}
            />
          </div>
        )}

        <Card>
          <CardHeader
            title={`Payroll · ${range.label}`}
            description={
              data.run
                ? finalised
                  ? `Finalised ${data.run.finalisedAt ? formatDate(data.run.finalisedAt) : ''} — posted to the accounts.`
                  : 'Draft — re-prepare after new sales, then finalise once paid.'
                : 'Prepare the run to calculate salary, unpaid commission, tips and advances for every active team member.'
            }
            action={
              <div className="flex flex-wrap items-center gap-2">
                {data.run && (
                  <Badge tone={finalised ? 'success' : 'warning'}>{finalised ? 'Finalised' : 'Draft'}</Badge>
                )}
                {data.run && wpsReady.length > 0 && (
                  <Button variant="secondary" size="sm" asChild>
                    <a href={`${base}/${data.run.id}/sif`} download>
                      <Download /> WPS file
                    </a>
                  </Button>
                )}
                {!finalised && (
                  <ActionForm action={prepareRunAction.bind(null, slug, range.from, range.to)}>
                    <SubmitButton variant={data.run ? 'secondary' : 'primary'} size="sm">
                      <Wallet /> {data.run ? 'Re-prepare' : 'Prepare payroll'}
                    </SubmitButton>
                  </ActionForm>
                )}
              </div>
            }
          />
          {data.run ? (
            <div className="pt-4 pb-2">
              <DataTable
                columns={columns}
                rows={lines}
                rowKey={(l) => l.id}
                empty={
                  <p className="px-6 pb-6 text-sm text-muted">
                    Nobody to pay — set salaries or commission rates under Staff.
                  </p>
                }
              />
            </div>
          ) : (
            <EmptyState
              icon={<Wallet className="size-5" strokeWidth={1.5} />}
              title="Not prepared yet"
              description={
                data.people.length === 0
                  ? 'Add your team under Staff first.'
                  : 'Nothing is posted until you finalise.'
              }
            />
          )}
          {data.run && !finalised && lines.length > 0 && (
            <CardBody className="border-t">
              <ActionForm
                action={finaliseRunAction.bind(null, slug, data.run.id)}
                className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"
              >
                <p className="max-w-md text-sm text-muted">
                  Finalising marks commissions and advances as settled and records{' '}
                  {formatAed(total('netAed'))} paid from the bank.
                </p>
                <div className="flex items-end gap-3">
                  <Field label="Paid on" name="paidOn">
                    <Input id="paidOn" name="paidOn" type="date" defaultValue={todayDubai()} />
                  </Field>
                  <SubmitButton>Finalise</SubmitButton>
                </div>
              </ActionForm>
            </CardBody>
          )}
        </Card>

        <div className="grid gap-6 lg:grid-cols-12">
          <Card className="lg:col-span-7">
            <CardHeader title="Open advances" description="Deducted in the next finalised payroll." />
            <CardBody className="pt-3">
              {data.advances.length === 0 ? (
                <p className="text-sm text-muted">No open advances.</p>
              ) : (
                <div className="divide-y">
                  {data.advances.map((a) => (
                    <div key={a.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                      <span className="min-w-0">
                        <span className="font-medium">{byId.get(a.staffId)?.displayName ?? '—'}</span>
                        <span className="text-muted"> · {formatDate(a.advanceDate)}</span>
                        {a.note && <span className="block truncate text-xs text-muted">{a.note}</span>}
                      </span>
                      <span className="tabular-nums">{formatAed(a.amountAed)}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
          <Card className="lg:col-span-5">
            <CardHeader
              title="WPS employer details"
              description="Needed for the salary information file (SIF) your bank or exchange house uploads."
            />
            <CardBody className="space-y-4 pt-3">
              <div className="flex items-center gap-3 text-sm">
                <Landmark className="size-4 text-muted" strokeWidth={1.5} />
                {wps?.employerId ? (
                  <span>
                    Establishment <span className="font-mono">{wps.employerId}</span> · routing{' '}
                    <span className="font-mono">{wps.routingCode}</span>
                  </span>
                ) : (
                  <span className="text-muted">Not set up yet.</span>
                )}
              </div>
              <FormSheet
                title="WPS employer details"
                action={saveEmployerAction.bind(null, slug)}
                trigger={
                  <Button variant="secondary" size="sm">
                    {wps?.employerId ? (
                      'Edit'
                    ) : (
                      <>
                        <Plus /> Set up WPS
                      </>
                    )}
                  </Button>
                }
              >
                <Field label="MOHRE establishment ID" name="employerId">
                  <Input
                    id="employerId"
                    name="employerId"
                    inputMode="numeric"
                    defaultValue={wps?.employerId}
                  />
                </Field>
                <Field
                  label="Employer bank routing code"
                  name="routingCode"
                  hint="9 digits — ask your bank or exchange house."
                >
                  <Input
                    id="routingCode"
                    name="routingCode"
                    inputMode="numeric"
                    defaultValue={wps?.routingCode}
                  />
                </Field>
                <Field label="Bank / exchange house" name="bank">
                  <Input id="bank" name="bank" defaultValue={wps?.bank} />
                </Field>
              </FormSheet>
            </CardBody>
          </Card>
        </div>
      </PageBody>
    </>
  )
}
