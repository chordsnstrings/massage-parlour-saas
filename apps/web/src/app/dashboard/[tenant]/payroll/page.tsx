import { enumLabel } from '@spa/core/i18n'
import { payrollLines, payrollRuns, salaryAdvances, staff, tenants, withTenant } from '@spa/db'
import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import { Banknote, Download, Landmark, Plus, Wallet } from 'lucide-react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Card, Grid, ListRow, Note, Pill, Stack, Stat } from '@/components/crm'
import { Button } from '@/components/ui/button'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { FormSheet } from '@/components/ui/form-sheet'
import { Input, Select } from '@/components/ui/input'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { type Column, DataTable } from '@/components/ui/table'
import { getI18n, getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { todayDubai } from '@/lib/utils'
import { can, requireMember } from '@/server/access'
import { MonthNav, monthLabel, monthRange } from '../accounts/month'
import {
  finaliseRunAction,
  prepareRunAction,
  recordAdvanceAction,
  saveEmployerAction,
  saveStaffPayAction,
} from './actions'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('payroll.title') }
}

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
  const { t, fmt } = await getI18n()
  const range = monthRange((await searchParams).month)
  const day = (d: string | Date) => fmt.date(typeof d === 'string' && d.length === 10 ? `${d}T12:00:00Z` : d)
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
      title={t('payroll.pay.title', { name: p.displayName })}
      description={t('payroll.pay.description')}
      action={saveStaffPayAction.bind(null, slug, p.id)}
      trigger={
        <Button variant="ghost" size="sm">
          {p.payroll.iban ? t('payroll.pay.details') : t('payroll.pay.addIban')}
        </Button>
      }
    >
      <Field label={t('payroll.pay.personId')} name="personId" hint={t('payroll.pay.personIdHint')}>
        <Input id="personId" name="personId" inputMode="numeric" defaultValue={p.payroll.personId} />
      </Field>
      <Field label={t('payroll.pay.labourCard')} name="labourCardNo">
        <Input id="labourCardNo" name="labourCardNo" defaultValue={p.payroll.labourCardNo} />
      </Field>
      <Field label={t('payroll.pay.iban')} name="iban">
        <Input
          id="iban"
          name="iban"
          placeholder="AE07 0331 2345 6789 0123 456"
          defaultValue={p.payroll.iban}
        />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t('payroll.pay.routing')} name="routingCode">
          <Input
            id="routingCode"
            name="routingCode"
            inputMode="numeric"
            defaultValue={p.payroll.routingCode}
          />
        </Field>
        <Field label={t('payroll.pay.bank')} name="bank">
          <Input id="bank" name="bank" defaultValue={p.payroll.bank} />
        </Field>
      </div>
    </FormSheet>
  )

  const columns: Column<Line>[] = [
    {
      key: 'who',
      header: t('payroll.col.member'),
      primary: true,
      cell: (l) => (
        <span className="flex flex-col">
          <span className="font-medium">{l.person?.displayName ?? t('payroll.col.formerStaff')}</span>
          {!l.person?.payroll.iban && (
            <span className="crm-muted text-xs">{t('payroll.col.cashNoIban')}</span>
          )}
        </span>
      ),
    },
    {
      key: 'base',
      header: t('payroll.col.salary'),
      className: 'text-end tabular-nums',
      cell: (l) => fmt.aed(l.baseAed),
    },
    {
      key: 'comm',
      header: t('payroll.col.commission'),
      className: 'text-end tabular-nums',
      cell: (l) => fmt.aed(l.commissionAed),
    },
    {
      key: 'tips',
      header: t('payroll.col.tips'),
      className: 'text-end tabular-nums',
      cell: (l) => fmt.aed(l.tipsAed),
    },
    {
      key: 'adv',
      header: t('payroll.col.advances'),
      className: 'text-end tabular-nums',
      cell: (l) => (Number(l.advancesAed) ? `− ${fmt.aed(l.advancesAed)}` : '—'),
    },
    {
      key: 'net',
      header: t('payroll.col.net'),
      className: 'text-end tabular-nums font-semibold',
      cell: (l) => fmt.aed(l.netAed),
    },
    {
      key: 'pay',
      header: '',
      className: 'text-end',
      cell: (l) => (l.person ? payDetails(l.person) : null),
    },
  ]

  return (
    <>
      <PageHeader
        title={t('payroll.title')}
        description={t('payroll.description')}
        actions={
          <>
            <MonthNav base={base} range={range} />
            <FormSheet
              title={t('payroll.advance.title')}
              description={t('payroll.advance.description')}
              action={recordAdvanceAction.bind(null, slug)}
              submitLabel={t('payroll.advance.submit')}
              trigger={
                <Button variant="secondary">
                  <Banknote /> {t('payroll.advance.trigger')}
                </Button>
              }
            >
              <Field label={t('payroll.advance.member')} name="staffId">
                <Select id="staffId" name="staffId" defaultValue="">
                  <option value="" disabled>
                    {t('payroll.advance.choose')}
                  </option>
                  {data.people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label={t('payroll.advance.amount')} name="amountAed">
                  <Input id="amountAed" name="amountAed" inputMode="decimal" />
                </Field>
                <Field label={t('payroll.advance.date')} name="date">
                  <Input id="date" name="date" type="date" defaultValue={todayDubai()} />
                </Field>
              </div>
              <Field label={t('payroll.advance.paidFrom')} name="paidVia">
                <Select id="paidVia" name="paidVia" defaultValue="cash">
                  <option value="cash">{t('payroll.advance.cashDrawer')}</option>
                  <option value="bank">{t('payroll.advance.bank')}</option>
                </Select>
              </Field>
              <Field label={t('payroll.advance.note')} name="note">
                <Input id="note" name="note" />
              </Field>
            </FormSheet>
          </>
        }
      />
      <PageBody>
        <Stack>
          {data.run && (
            <Grid cols="g4">
              <Stat label={t('payroll.stat.salaries')} value={fmt.aed(total('baseAed'))} />
              <Stat label={t('payroll.stat.commission')} value={fmt.aed(total('commissionAed'))} />
              <Stat label={t('payroll.stat.tips')} value={fmt.aed(total('tipsAed'))} />
              <Stat
                label={t('payroll.stat.net')}
                value={fmt.aed(total('netAed'))}
                change={{ text: t('payroll.stat.people', { count: lines.length }) }}
              />
            </Grid>
          )}

          <Card
            flush={Boolean(data.run)}
            title={t('payroll.run.title', { month: monthLabel(fmt, range.month) })}
            sub={
              data.run
                ? finalised
                  ? t('payroll.run.finalisedOn', {
                      date: data.run.finalisedAt ? day(data.run.finalisedAt) : '',
                    })
                  : t('payroll.run.draft')
                : t('payroll.run.none')
            }
            actions={
              <>
                {data.run && (
                  <Pill tone={finalised ? 'ok' : 'warn'}>
                    {enumLabel(t, 'payrollStatus', data.run.status)}
                  </Pill>
                )}
                {data.run && wpsReady.length > 0 && (
                  <Button variant="secondary" size="sm" asChild>
                    <a href={`${base}/${data.run.id}/sif`} download>
                      <Download /> {t('payroll.run.wpsFile')}
                    </a>
                  </Button>
                )}
                {!finalised && (
                  <ActionForm action={prepareRunAction.bind(null, slug, range.from, range.to)}>
                    <SubmitButton variant={data.run ? 'secondary' : 'primary'} size="sm">
                      <Wallet /> {data.run ? t('payroll.run.reprepare') : t('payroll.run.prepare')}
                    </SubmitButton>
                  </ActionForm>
                )}
              </>
            }
          >
            {data.run ? (
              <DataTable
                columns={columns}
                rows={lines}
                rowKey={(l) => l.id}
                empty={<p className="crm-muted px-6 pb-6 text-sm">{t('payroll.run.nobody')}</p>}
              />
            ) : (
              <EmptyState
                icon={<Wallet className="size-5" strokeWidth={1.5} />}
                title={t('payroll.run.notPrepared')}
                description={
                  data.people.length === 0 ? t('payroll.run.addTeamFirst') : t('payroll.run.nothingPosted')
                }
              />
            )}
            {data.run && !finalised && lines.length > 0 && (
              <div className="border-t px-[var(--crm-pad-card)] py-4">
                <ActionForm
                  action={finaliseRunAction.bind(null, slug, data.run.id)}
                  className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"
                >
                  <p className="crm-muted max-w-md text-sm">
                    {t('payroll.run.finaliseNote', { amount: fmt.aed(total('netAed')) })}
                  </p>
                  <div className="flex items-end gap-3">
                    <Field label={t('payroll.run.paidOn')} name="paidOn">
                      <Input id="paidOn" name="paidOn" type="date" defaultValue={todayDubai()} />
                    </Field>
                    <SubmitButton>{t('payroll.run.finalise')}</SubmitButton>
                  </div>
                </ActionForm>
              </div>
            )}
          </Card>

          <Grid cols="col-2">
            <Card title={t('payroll.advances.title')} sub={t('payroll.advances.sub')}>
              {data.advances.length === 0 ? (
                <p className="crm-muted text-sm">{t('payroll.advances.none')}</p>
              ) : (
                <div>
                  {data.advances.map((a) => (
                    <ListRow
                      key={a.id}
                      title={byId.get(a.staffId)?.displayName ?? '—'}
                      body={[day(a.advanceDate), a.note].filter(Boolean).join(' · ')}
                      end={<span className="crm-num font-semibold">{fmt.aed(a.amountAed)}</span>}
                    />
                  ))}
                </div>
              )}
            </Card>
            <Card title={t('payroll.wps.title')} sub={t('payroll.wps.sub')}>
              <div className="flex items-center gap-3 text-sm">
                <Landmark className="crm-muted size-4 shrink-0" strokeWidth={1.5} />
                {wps?.employerId ? (
                  <span className="font-mono text-[13px]">
                    {t('payroll.wps.establishment', { id: wps.employerId, routing: wps.routingCode ?? '' })}
                  </span>
                ) : (
                  <span className="crm-muted">{t('payroll.wps.notSet')}</span>
                )}
              </div>
              <div className="mt-4">
                <FormSheet
                  title={t('payroll.wps.title')}
                  action={saveEmployerAction.bind(null, slug)}
                  trigger={
                    <Button variant="secondary" size="sm">
                      {wps?.employerId ? (
                        t('common.edit')
                      ) : (
                        <>
                          <Plus /> {t('payroll.wps.setUp')}
                        </>
                      )}
                    </Button>
                  }
                >
                  <Field label={t('payroll.wps.employerId')} name="employerId">
                    <Input
                      id="employerId"
                      name="employerId"
                      inputMode="numeric"
                      defaultValue={wps?.employerId}
                    />
                  </Field>
                  <Field
                    label={t('payroll.wps.routing')}
                    name="routingCode"
                    hint={t('payroll.wps.routingHint')}
                  >
                    <Input
                      id="routingCode"
                      name="routingCode"
                      inputMode="numeric"
                      defaultValue={wps?.routingCode}
                    />
                  </Field>
                  <Field label={t('payroll.wps.bank')} name="bank">
                    <Input id="bank" name="bank" defaultValue={wps?.bank} />
                  </Field>
                </FormSheet>
              </div>
            </Card>
          </Grid>
          <Note tone="acc">{t('payroll.note')}</Note>
        </Stack>
      </PageBody>
    </>
  )
}
