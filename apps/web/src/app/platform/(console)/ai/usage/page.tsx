import { aiModelConfig, platformDb, platformSettings } from '@spa/db'
import { aiUsageBreakdown, aiUsageOverview, type SpaAiUsage } from '@spa/services'
import { Sparkles } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader } from '@/components/ui/card'
import { ActionForm, SubmitButton } from '@/components/ui/form'
import { Stagger, StaggerItem } from '@/components/ui/motion'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { StatCard } from '@/components/ui/stat-card'
import { DataTable } from '@/components/ui/table'
import { adminPath } from '@/lib/paths'
import { requirePlatformAdmin } from '@/server/access'
import { setGlobalAiEnabledAction } from './actions'
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
} from './kit'

export const metadata: Metadata = { title: 'AI usage' }

const SORTS = {
  name: (a: SpaAiUsage, b: SpaAiUsage) => a.name.localeCompare(b.name),
  cost: (a: SpaAiUsage, b: SpaAiUsage) => b.month.costUsd - a.month.costUsd,
  used: (a: SpaAiUsage, b: SpaAiUsage) => b.ratio - a.ratio,
  last: (a: SpaAiUsage, b: SpaAiUsage) => b.lastMonth.costUsd - a.lastMonth.costUsd,
  calls: (a: SpaAiUsage, b: SpaAiUsage) => b.month.calls - a.month.calls,
  budget: (a: SpaAiUsage, b: SpaAiUsage) => b.budgetUsd - a.budgetUsd,
} as const
type SortKey = keyof typeof SORTS
const num = 'text-right tabular-nums'

export default async function AiUsagePage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; period?: string }>
}) {
  await requirePlatformAdmin()
  const sp = await searchParams
  const sort: SortKey = sp.sort && sp.sort in SORTS ? (sp.sort as SortKey) : 'used'
  const period = periodOf(sp.period)
  const db = platformDb()
  const [spas, breakdown, labels, [settings]] = await Promise.all([
    aiUsageOverview(db),
    aiUsageBreakdown(db, period),
    db.select({ key: aiModelConfig.agentKey, label: aiModelConfig.label }).from(aiModelConfig),
    db.select({ aiEnabled: platformSettings.aiEnabled }).from(platformSettings),
  ])
  const rows = spas.sort(SORTS[sort])
  const names = new Map(labels.map((l) => [l.key, l.label]))
  const globalOn = settings?.aiEnabled ?? true
  const href = (q: { sort?: string; period?: string }) =>
    `${adminPath('/ai/usage')}?${new URLSearchParams({ sort: q.sort ?? sort, period: q.period ?? period.key })}`
  const head = (key: SortKey, label: string) => (
    <Link
      href={href({ sort: key })}
      aria-current={sort === key ? 'true' : undefined}
      className={sort === key ? 'text-fg underline underline-offset-4' : 'hover:text-fg'}
    >
      {label}
    </Link>
  )
  const total = rows.reduce(
    (a, r) => ({
      month: a.month + r.month.costUsd,
      last: a.last + r.lastMonth.costUsd,
      calls: a.calls + r.month.calls,
    }),
    { month: 0, last: 0, calls: 0 },
  )
  const flagged = rows.filter((r) => r.budgetUsd > 0 && r.level !== 'ok')

  return (
    <>
      <PageHeader
        title="AI usage"
        description="AI spend per spa against its monthly budget (Asia/Dubai months). At 80 % the spa owner is notified; at 100 % AI pauses for that spa until the 1st."
        actions={
          <Link href={adminPath('/ai')} className="text-sm text-muted hover:text-fg">
            AI models →
          </Link>
        }
      />
      <PageBody>
        <Stagger className="grid grid-cols-2 gap-[var(--ui-grid-gap,1rem)] lg:grid-cols-4">
          <StaggerItem>
            <StatCard label="Spend this month" value={Math.round(total.month * 100) / 100} format="usd" />
          </StaggerItem>
          <StaggerItem>
            <StatCard label="Last month" value={Math.round(total.last * 100) / 100} format="usd" />
          </StaggerItem>
          <StaggerItem>
            <StatCard label="Calls this month" value={total.calls} format="int" />
          </StaggerItem>
          <StaggerItem>
            <StatCard
              label="Spas at ≥ 80 %"
              value={flagged.length}
              format="int"
              hint="Of their monthly budget"
            />
          </StaggerItem>
        </Stagger>
        <Card data-testid="ai-global">
          <CardHeader
            title="Platform AI switch"
            description={
              globalOn
                ? 'AI runs for every spa that is switched on and within budget.'
                : 'AI is off for every spa — no model is called until you turn it back on.'
            }
            action={
              <span className="flex items-center gap-2">
                <Badge tone={globalOn ? 'success' : 'danger'}>{globalOn ? 'on' : 'off'}</Badge>
                <ActionForm action={setGlobalAiEnabledAction.bind(null, !globalOn)}>
                  <SubmitButton size="sm" variant={globalOn ? 'danger' : 'primary'}>
                    {globalOn ? 'Turn AI off for all spas' : 'Turn AI on'}
                  </SubmitButton>
                </ActionForm>
              </span>
            }
          />
        </Card>
        <Card>
          <DataTable
            rows={rows}
            rowKey={(r) => r.id}
            empty={<EmptyState icon={<Sparkles className="size-5" />} title="No spas yet" />}
            columns={[
              {
                key: 'name',
                header: head('name', 'Spa'),
                primary: true,
                cell: (r) => (
                  <Link
                    href={adminPath(`/ai/usage/${r.id}`)}
                    className="group"
                    data-testid={`ai-usage-${r.slug}`}
                  >
                    <span className="block font-medium group-hover:text-accent">{r.name}</span>
                    <span className="flex items-center gap-1.5 text-xs text-muted">
                      {r.slug} <LevelBadge level={r.level} enabled={r.aiEnabled} />
                    </span>
                  </Link>
                ),
              },
              {
                key: 'cost',
                header: head('cost', 'This month'),
                className: num,
                cell: (r) => (
                  <span data-testid="ai-month">
                    <span className="block">{usd(r.month.costUsd)}</span>
                    <span className="block text-xs text-muted">
                      {r.month.calls} calls · {tokens(r.month.tokensIn + r.month.tokensOut)} tok
                    </span>
                  </span>
                ),
              },
              {
                key: 'last',
                header: head('last', 'Last month'),
                className: num,
                hideOnMobile: true,
                cell: (r) => (
                  <span>
                    <span className="block">{usd(r.lastMonth.costUsd)}</span>
                    <span className="block text-xs text-muted">{r.lastMonth.calls} calls</span>
                  </span>
                ),
              },
              {
                key: 'used',
                header: head('used', '% used'),
                className: num,
                cell: (r) => <UsedBar ratio={r.ratio} />,
              },
              {
                key: 'budget',
                header: head('budget', 'Budget / month (USD)'),
                className: 'text-right',
                cell: (r) => <BudgetForm tenantId={r.id} budget={r.budgetUsd} />,
              },
              {
                key: 'switch',
                header: 'AI',
                className: 'text-right',
                cell: (r) => <KillSwitch tenantId={r.id} enabled={r.aiEnabled} />,
              },
            ]}
          />
        </Card>
        <div className="flex justify-end">
          <PeriodPicker current={period.key} href={(key) => href({ period: key })} />
        </div>
        <div className="grid gap-[var(--ui-grid-gap,1rem)] lg:grid-cols-2">
          <Card>
            <CardHeader title="By feature (agent)" description="All spas" />
            <SliceTable
              rows={breakdown.byAgent}
              label="Agent"
              names={names}
              empty={<EmptyState icon={<Sparkles className="size-5" />} title="No AI calls in this period" />}
            />
          </Card>
          <Card>
            <CardHeader title="By model" description="All spas" />
            <SliceTable
              rows={breakdown.byModel}
              label="Model"
              empty={<EmptyState icon={<Sparkles className="size-5" />} title="No AI calls in this period" />}
            />
          </Card>
        </div>
      </PageBody>
    </>
  )
}
