import { aiModelConfig, platformDb, tenants } from '@spa/db'
import { aiBudgetLevel, aiDailyCost, aiMonth, aiTenantTotals, aiUsageBreakdown } from '@spa/services'
import { eq } from 'drizzle-orm'
import { Sparkles } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Stagger, StaggerItem } from '@/components/ui/motion'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { StatCard } from '@/components/ui/stat-card'
import { adminPath } from '@/lib/paths'
import { formatDate } from '@/lib/utils'
import { requirePlatformAdmin } from '@/server/access'
import { BarChart } from '../../../performance/kit'
import {
  BudgetForm,
  KillSwitch,
  LevelBadge,
  PeriodPicker,
  periodOf,
  SliceTable,
  tokens,
  UsedBar,
  usd,
} from '../kit'

export const metadata: Metadata = { title: 'AI usage' }

export default async function SpaAiUsagePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ period?: string }>
}) {
  await requirePlatformAdmin()
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const db = platformDb()
  const [spa] = await db
    .select({
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      budget: tenants.aiBudgetUsd,
      aiEnabled: tenants.aiEnabled,
    })
    .from(tenants)
    .where(eq(tenants.id, id))
  if (!spa) notFound()
  const period = periodOf((await searchParams).period)
  const [totals, current, breakdown, daily, labels] = await Promise.all([
    aiTenantTotals(db, period, spa.id),
    aiTenantTotals(db, aiMonth(0), spa.id),
    aiUsageBreakdown(db, period, spa.id),
    aiDailyCost(db, period, spa.id),
    db.select({ key: aiModelConfig.agentKey, label: aiModelConfig.label }).from(aiModelConfig),
  ])
  const budget = Number(spa.budget)
  const ratio = budget > 0 ? current.costUsd / budget : current.costUsd > 0 ? 1 : 0
  const names = new Map(labels.map((l) => [l.key, l.label]))
  const none = <EmptyState icon={<Sparkles className="size-5" />} title="No AI calls in this period" />

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={adminPath('/ai/usage')} className="hover:text-fg">
            ← AI usage
          </Link>
        }
        title={spa.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {spa.slug} <LevelBadge level={aiBudgetLevel(current.costUsd, budget)} enabled={spa.aiEnabled} />
            <Link href={adminPath(`/performance/${spa.id}`)} className="text-accent hover:underline">
              Performance →
            </Link>
          </span>
        }
        actions={
          <PeriodPicker
            current={period.key}
            href={(key) => `${adminPath(`/ai/usage/${spa.id}`)}?period=${key}`}
          />
        }
      />
      <PageBody>
        <Stagger className="grid grid-cols-2 gap-[var(--ui-grid-gap,1rem)] lg:grid-cols-4">
          <StaggerItem>
            <StatCard label="Cost" value={totals.costUsd} format="usd" hint={period.month} />
          </StaggerItem>
          <StaggerItem>
            <StatCard
              label="Calls"
              value={totals.calls}
              format="int"
              hint={totals.errors ? `${totals.errors} failed` : undefined}
            />
          </StaggerItem>
          <StaggerItem>
            <StatCard
              label="Tokens"
              value={totals.tokensIn + totals.tokensOut}
              format="int"
              hint={`${tokens(totals.tokensIn)} in · ${tokens(totals.tokensOut)} out · ${tokens(totals.tokensCached)} cached${totals.images ? ` · ${totals.images} images` : ''}`}
            />
          </StaggerItem>
          <StaggerItem>
            <StatCard
              label="Budget used (this month)"
              value={Math.round(ratio * 100)}
              format="pct"
              hint={`${usd(current.costUsd)} of ${usd(budget)}`}
            />
          </StaggerItem>
        </Stagger>
        <Card data-testid="ai-spa-controls">
          <CardHeader
            title="Budget and switch"
            description="Monthly budget in USD (Asia/Dubai months). 0 = no AI. Changes are audited."
            action={
              <span className="flex items-center gap-3">
                <UsedBar ratio={ratio} />
                <BudgetForm tenantId={spa.id} budget={budget} />
                <KillSwitch tenantId={spa.id} enabled={spa.aiEnabled} />
              </span>
            }
          />
        </Card>
        <Card>
          <CardHeader title="Daily cost" description={`USD per day, ${period.month}`} />
          <CardBody>
            <BarChart
              label="Daily AI cost"
              format={usd}
              points={daily.map((d) => ({
                label: formatDate(`${d.date}T12:00:00Z`),
                value: d.costUsd,
              }))}
            />
          </CardBody>
        </Card>
        <div className="grid gap-[var(--ui-grid-gap,1rem)] lg:grid-cols-2">
          <Card>
            <CardHeader title="By feature (agent)" />
            <SliceTable rows={breakdown.byAgent} label="Agent" names={names} empty={none} />
          </Card>
          <Card>
            <CardHeader title="By model" />
            <SliceTable rows={breakdown.byModel} label="Model" empty={none} />
          </Card>
        </div>
      </PageBody>
    </>
  )
}
