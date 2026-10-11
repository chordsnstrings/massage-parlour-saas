// Console spa page → Plan & features (PLAN §18.8): plan switch (Premium / Standard; the legacy yearly plan only at
// its renewal), per-spa discounts on the setup / monthly fee, and the feature-tier override. Each change is audited.
import { addDays, FEATURE_LABELS, FEATURES, planPriceLine } from '@spa/core'
import type { plans, subscriptions } from '@spa/db'
import { type Entitlements, isLegacyPlan, RENEWAL_WINDOW_DAYS, renewalDue } from '@spa/services'
import { DiscountInput } from '@/components/plan/discount-input'
import { Badge } from '@/components/ui/badge'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { Checkbox, Select } from '@/components/ui/input'
import { formatAed, formatDate } from '@/lib/utils'
import { saveDiscountsAction, setFeatureTierAction, switchPlanAction } from '../../actions'

type Plan = typeof plans.$inferSelect
type Sub = typeof subscriptions.$inferSelect

export function PlanCard({
  tenantId,
  sub,
  current,
  offered,
  ent,
  today,
}: {
  tenantId: string
  sub: Sub | undefined
  current: Plan | undefined
  offered: Plan[]
  ent: Entitlements
  today: string
}) {
  const legacy = isLegacyPlan(current)
  const due = sub ? renewalDue(sub, today) : false
  const locked = legacy && !due
  const features = ent.features.length
    ? ent.features.map((f) => FEATURE_LABELS[f]).join(', ')
    : 'Core only (no AI & Instagram automation, no marketing tools, one branch)'
  return (
    <Card data-testid="plan-card">
      <CardHeader
        title="Plan & features"
        description="Plan, per-spa discounts and the feature tier. Every change is audited (from → to)."
      />
      <CardBody className="space-y-6">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{current?.name ?? 'No plan'}</span>
          {current && <span className="text-muted">{planPriceLine(current)} · excl. VAT</span>}
          {legacy && <Badge tone="warning">legacy until renewal</Badge>}
          {ent.override && (
            <Badge tone="accent" data-testid="tier-override">
              {ent.override === 'premium' ? 'Premium features granted' : 'Standard features only'}
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted" data-testid="plan-features">
          Features: {features}
          {ent.features.length === FEATURES.length ? '' : ' · Premium adds the rest.'}
        </p>
        {legacy && sub && (
          <p
            className={due ? 'rounded-lg border border-warning/40 p-3 text-sm' : 'text-sm text-muted'}
            data-testid="legacy-renewal"
          >
            {due
              ? `Renewal on ${formatDate(sub.currentPeriodEnd)}: choose the spa’s new plan. It starts a new 12-month period on that date (no setup fee); nothing is charged or moved automatically — then use “Generate payment schedule”.`
              : `Stays on the legacy yearly plan (${formatAed(sub.priceAed)} per year) until its renewal on ${formatDate(sub.currentPeriodEnd)}. You can choose the new plan from ${formatDate(addDays(sub.currentPeriodEnd, -RENEWAL_WINDOW_DAYS))}.`}
          </p>
        )}

        {sub && (
          <ActionForm
            action={switchPlanAction.bind(null, tenantId)}
            className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end"
          >
            <Field label={legacy ? 'New plan at renewal' : 'Switch plan'} name="planId">
              <Select
                id="planId-switch"
                name="planId"
                disabled={locked}
                defaultValue={offered.find((p) => p.id !== current?.id)?.id}
              >
                {offered.map((p) => (
                  <option key={p.id} value={p.id} disabled={p.id === current?.id}>
                    {p.name} · {planPriceLine(p)}
                  </option>
                ))}
              </Select>
            </Field>
            <SubmitButton variant="secondary" disabled={locked}>
              {legacy ? 'Choose plan for renewal' : 'Switch plan'}
            </SubmitButton>
            {!legacy && (
              <label className="flex items-center gap-2.5 text-sm sm:col-span-2">
                <Checkbox name="reissue" /> Re-issue unpaid invoices that aren’t due yet at the new price
              </label>
            )}
          </ActionForm>
        )}

        {sub && (
          <ActionForm action={saveDiscountsAction.bind(null, tenantId)} className="grid gap-4 sm:grid-cols-2">
            <DiscountInput
              name="setupDiscount"
              label="Setup fee discount"
              hint="AED off or % off the one-time setup fee."
              initial={sub.discounts?.setup}
            />
            <DiscountInput
              name="monthlyDiscount"
              label="Monthly fee discount"
              hint="AED or % off each monthly invoice."
              initial={sub.discounts?.monthly}
            />
            <p className="text-xs text-muted sm:col-span-2">
              Applied when invoices are generated (setup invoice, payment schedule); invoices show the
              discount. Issued invoices keep their amounts unless re-issued.
            </p>
            <label className="flex items-center gap-2.5 text-sm">
              <Checkbox name="reissue" /> Re-issue unpaid invoices that aren’t due yet
            </label>
            <div className="flex justify-end">
              <SubmitButton variant="secondary">Save discounts</SubmitButton>
            </div>
          </ActionForm>
        )}

        <ActionForm
          action={setFeatureTierAction.bind(null, tenantId)}
          className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end"
        >
          <Field
            label="Feature tier"
            name="tier"
            hint="Overrides what the plan includes (billing stays on the plan's price)."
          >
            <Select id="tier" name="tier" defaultValue={ent.override ?? 'plan'}>
              <option value="plan">Follow the plan{ent.plan ? ` (${ent.plan.tier})` : ''}</option>
              <option value="premium">Grant Premium features</option>
              <option value="standard">Standard features only</option>
            </Select>
          </Field>
          <SubmitButton variant="secondary">Save feature tier</SubmitButton>
        </ActionForm>
      </CardBody>
    </Card>
  )
}
