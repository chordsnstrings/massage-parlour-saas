import { FEATURE_LABELS, monthlyAed, PLAN_CODES, planFeatures, planTier } from '@spa/core'
import { plans, platformDb } from '@spa/db'
import { isBuiltInPlan, NO_PLAN_USE, type PlanUse, planUsage } from '@spa/services'
import { asc } from 'drizzle-orm'
import { Plus, Trash2 } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { FormSheet } from '@/components/ui/form-sheet'
import { Checkbox, Input, Select, Textarea } from '@/components/ui/input'
import { Stagger, StaggerItem } from '@/components/ui/motion'
import { PageBody, PageHeader } from '@/components/ui/page'
import { adminPath } from '@/lib/paths'
import { formatAed, formatDate } from '@/lib/utils'
import { removePlanAction, restorePlanAction, savePlanAction } from '../actions'

export const metadata: Metadata = { title: 'Plans & prices' }

type Plan = typeof plans.$inferSelect

const fixedCode = (plan?: Plan) => Boolean(plan && isBuiltInPlan(plan))

function PlanFields({ plan }: { plan?: Plan }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {plan && <input type="hidden" name="id" value={plan.id} />}
      <Field label="Name" name="name">
        <Input id="name" name="name" defaultValue={plan?.name} required />
      </Field>
      <Field
        label="Code"
        name="code"
        hint={
          fixedCode(plan) ? 'Used by the app (pricing page, sign-up links): fixed.' : 'Internal identifier.'
        }
      >
        <Input id="code" name="code" defaultValue={plan?.code} required readOnly={fixedCode(plan)} />
      </Field>
      <Field
        label="Price per 12 months (AED)"
        name="priceAed"
        hint="Monthly plans: 12 × the monthly fee (AED 3,000/month = 36,000). Excl. VAT."
      >
        <Input id="priceAed" name="priceAed" inputMode="decimal" defaultValue={plan?.priceAed ?? '36000'} />
      </Field>
      <Field label="Default payment plan" name="billingInterval">
        <Select id="billingInterval" name="billingInterval" defaultValue={plan?.billingInterval ?? 'month'}>
          <option value="year">One-time annual</option>
          <option value="month">12 monthly invoices</option>
        </Select>
      </Field>
      <Field label="Setup fee (AED)" name="setupFeeAed">
        <Input
          id="setupFeeAed"
          name="setupFeeAed"
          inputMode="decimal"
          defaultValue={plan?.setupFeeAed ?? '0'}
        />
      </Field>
      <Field label="Trial days" name="trialDays">
        <Input id="trialDays" name="trialDays" type="number" min={0} defaultValue={plan?.trialDays ?? 14} />
      </Field>
      <Field label="Description" name="description" className="sm:col-span-2">
        <Textarea id="description" name="description" defaultValue={plan?.description ?? ''} />
      </Field>
      <Field
        label="Features"
        name="tier"
        hint="Premium: AI & Instagram automation, marketing tools, more branches. Standard: core only, one branch."
      >
        <Select id="tier" name="tier" defaultValue={plan ? planTier(plan.limits) : 'premium'}>
          <option value="premium">Premium features</option>
          <option value="standard">Standard features</option>
        </Select>
      </Field>
      <Field label="Sort order" name="sort">
        <Input id="sort" name="sort" type="number" min={0} defaultValue={plan?.sort ?? 0} />
      </Field>
      <label className="flex items-center gap-2.5 self-end pb-2.5 text-sm">
        <Checkbox name="active" defaultChecked={plan?.active ?? true} /> Available for new spas
      </label>
    </div>
  )
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * R19: what Delete will do — delete an unused plan; archive one that spas or applications point at, and always a
 * built-in plan (`isBuiltInPlan`: the deploy seed would add a deleted one back).
 */
function deleteCopy(p: Plan, use: PlanUse) {
  if (!use.spas && !use.applications && !isBuiltInPlan(p))
    return { description: "This can't be undone.", submit: 'Delete plan' }
  const restore = 'You can restore it from Archived plans.'
  const hidden = 'It will be removed from this page, the pricing page and new sign-ups.'
  const pending = use.pendingApplications
  const past = use.applications - pending
  const apps = [
    pending && count(pending, 'pending application', 'pending applications'),
    past && count(past, 'past application', 'past applications'),
  ]
    .filter(Boolean)
    .join(' and ')
  const accept = pending
    ? ` You choose another plan when you accept the pending ${pending === 1 ? 'application' : 'applications'}.`
    : ''
  return {
    description: use.spas
      ? `${count(use.spas, 'spa is', 'spas are')} on ${p.name}${apps ? ` and ${apps} chose it` : ''}. ${hidden} Those spas keep their plan and price until you change their subscription. ${restore}`
      : apps
        ? `${apps} chose ${p.name}, so it is archived, not deleted. ${hidden}${accept} ${restore}`
        : `${p.name} is a built-in plan, so it is archived, not deleted. ${hidden} ${restore}`,
    submit: 'Archive plan',
  }
}

function PlanPrice({ p }: { p: Plan }) {
  return (
    <>
      <p className="tabular mt-4 text-3xl font-semibold tracking-tight">
        {formatAed(p.billingInterval === 'month' ? monthlyAed(p.priceAed) : p.priceAed)}
      </p>
      <p className="text-sm text-muted">
        {p.billingInterval === 'month'
          ? `per month · ${formatAed(p.priceAed)} per 12 months`
          : 'per year · one annual invoice'}{' '}
        · excl. VAT
      </p>
    </>
  )
}

export default async function PlansPage({ searchParams }: { searchParams: Promise<{ archived?: string }> }) {
  const showArchived = (await searchParams).archived === '1'
  const db = platformDb()
  const [all, usage] = await Promise.all([
    db.select().from(plans).orderBy(asc(plans.sort), asc(plans.createdAt)),
    planUsage(db),
  ])
  const usageOf = (p: Plan) => usage.get(p.id) ?? NO_PLAN_USE
  const rows = all.filter((p) => !p.archivedAt)
  const archived = all.filter((p) => p.archivedAt)
  const page = adminPath('/plans')
  return (
    <>
      <PageHeader
        title="Plans & prices"
        description="Prices apply to new spas. Existing spas keep their agreed price until you change their subscription."
        actions={
          <FormSheet
            title="New plan"
            action={savePlanAction}
            className="md:max-w-xl"
            trigger={
              <Button>
                <Plus /> New plan
              </Button>
            }
          >
            <PlanFields />
          </FormSheet>
        }
      />
      <PageBody>
        <Stagger className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((p) => (
            <StaggerItem key={p.id}>
              <Card
                aria-label={p.name}
                className="flex h-full flex-col p-6 transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-soft"
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-semibold tracking-tight">{p.name}</h3>
                  <Badge tone={p.active ? 'success' : 'neutral'}>
                    {p.code === PLAN_CODES.legacyYearly ? 'Legacy' : p.active ? 'Active' : 'Hidden'}
                  </Badge>
                </div>
                <PlanPrice p={p} />
                <p className="mt-2 text-xs text-muted">
                  {planFeatures(p.limits).length
                    ? planFeatures(p.limits)
                        .map((f) => FEATURE_LABELS[f])
                        .join(' · ')
                    : 'Core only · one branch'}
                </p>
                <p className="mt-4 flex-1 text-sm text-muted">{p.description}</p>
                <dl className="mt-5 grid grid-cols-2 gap-2 border-t pt-4 text-sm">
                  <dt className="text-muted">Setup fee</dt>
                  <dd className="tabular text-end">{formatAed(p.setupFeeAed)}</dd>
                  <dt className="text-muted">Trial</dt>
                  <dd className="text-end">{p.trialDays} days</dd>
                  <dt className="text-muted">Spas on it</dt>
                  <dd className="tabular text-end">{usageOf(p).spas}</dd>
                </dl>
                <div className="mt-5 flex flex-wrap items-center gap-2">
                  <FormSheet
                    title={`Edit ${p.name}`}
                    action={savePlanAction}
                    className="md:max-w-xl"
                    trigger={
                      <Button variant="secondary" size="sm">
                        Edit
                      </Button>
                    }
                  >
                    <PlanFields plan={p} />
                  </FormSheet>
                  <FormSheet
                    title={`Delete ${p.name}?`}
                    description={deleteCopy(p, usageOf(p)).description}
                    action={removePlanAction}
                    submitLabel={deleteCopy(p, usageOf(p)).submit}
                    submitVariant="danger"
                    trigger={
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-danger hover:bg-danger-soft hover:text-danger"
                      >
                        <Trash2 /> Delete
                      </Button>
                    }
                  >
                    <input type="hidden" name="id" value={p.id} />
                  </FormSheet>
                </div>
              </Card>
            </StaggerItem>
          ))}
        </Stagger>
        {archived.length > 0 && (
          <section aria-label="Archived plans" className="mt-8 space-y-4">
            <Button variant="ghost" size="sm" asChild>
              <Link href={showArchived ? page : `${page}?archived=1`} scroll={false}>
                {showArchived ? 'Hide archived plans' : `Archived plans (${archived.length})`}
              </Link>
            </Button>
            {showArchived && (
              <Stagger className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {archived.map((p) => (
                  <StaggerItem key={p.id}>
                    <Card aria-label={p.name} className="flex h-full flex-col bg-subtle/40 p-6">
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="font-semibold tracking-tight">{p.name}</h3>
                        <Badge tone="neutral">Archived</Badge>
                      </div>
                      <PlanPrice p={p} />
                      <p className="mt-4 flex-1 text-sm text-muted">
                        Archived {formatDate(p.archivedAt!)}
                        {usageOf(p).spas
                          ? ` · ${count(usageOf(p).spas, 'spa keeps', 'spas keep')} it until you change their subscription`
                          : ''}
                        .
                      </p>
                      <ActionForm action={restorePlanAction} className="mt-5">
                        <input type="hidden" name="id" value={p.id} />
                        <SubmitButton variant="secondary" size="sm">
                          Restore
                        </SubmitButton>
                      </ActionForm>
                    </Card>
                  </StaggerItem>
                ))}
              </Stagger>
            )}
          </section>
        )}
      </PageBody>
    </>
  )
}
