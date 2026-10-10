// "Available on Premium" (PLAN §18.8): shown instead of a page whose plan feature the spa doesn't have (Standard),
// and the route segments' gate. Server components; text from the `plan` catalogue (EN + TH).
import { FEATURES, type Feature } from '@spa/core'
import { Sparkles } from 'lucide-react'
import { Card, Eyebrow } from '@/components/crm'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page'
import { getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { can, type MemberContext, requireMember } from '@/server/access'
import { hasFeature } from '@/server/entitlements'
import { canonicalUrls } from '@/server/origin'

export async function PlanUpsell({ ctx, feature }: { ctx: MemberContext; feature: Feature }) {
  const t = await getT()
  const name = t(`plan.feature.${feature}.name`)
  const others = FEATURES.filter((f) => f !== feature)
  return (
    <>
      <PageHeader title={name} />
      <Card data-testid="plan-upsell" className="max-w-2xl">
        <div className="flex items-start gap-3">
          <Sparkles aria-hidden strokeWidth={1.8} className="mt-1 size-5 shrink-0 text-[var(--crm-accent)]" />
          <div className="min-w-0 space-y-3">
            <Eyebrow>{t('plan.upsell.eyebrow')}</Eyebrow>
            <h2 className="text-lg font-semibold">{t('plan.upsell.title', { feature: name })}</h2>
            <p>{t(`plan.feature.${feature}.text`)}</p>
            <p className="crm-muted text-sm">{t('plan.upsell.body', { feature: name })}</p>
            <ul className="crm-muted list-disc ps-5 text-sm">
              {others.map((f) => (
                <li key={f}>{t(`plan.feature.${f}.name`)}</li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button size="sm" asChild>
                <a href={`${canonicalUrls().marketing()}/pricing`} target="_blank" rel="noreferrer">
                  {t('plan.upsell.compare')}
                </a>
              </Button>
              {can(ctx, 'billing.view') && (
                <Button size="sm" variant="secondary" asChild>
                  <a href={appPath(`/${ctx.tenant.slug}/billing`)}>{t('plan.upsell.billing')}</a>
                </Button>
              )}
            </div>
            {!can(ctx, 'billing.view') && <p className="crm-muted text-xs">{t('plan.upsell.contact')}</p>}
          </div>
        </div>
      </Card>
    </>
  )
}

/** Route-segment gate (`layout.tsx` of a gated section): the upsell instead of the pages when the plan lacks it. */
export async function FeatureGate({
  params,
  feature,
  children,
}: {
  params: Promise<{ tenant: string }>
  feature: Feature
  children: React.ReactNode
}) {
  const ctx = await requireMember((await params).tenant)
  if (await hasFeature(ctx.tenant.id, feature)) return children
  return <PlanUpsell ctx={ctx} feature={feature} />
}
