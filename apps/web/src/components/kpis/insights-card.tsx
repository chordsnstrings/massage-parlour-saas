import { aiConfigured, latestInsights } from '@spa/ai'
import { withTenant } from '@spa/db'
import { RefreshCw, Sparkles } from 'lucide-react'
import { Card } from '@/components/crm'
import { ActionForm, SubmitButton } from '@/components/ui/form'
import { Stagger, StaggerItem } from '@/components/ui/motion'
import { getI18n } from '@/i18n/server'
import { cn } from '@/lib/utils'
import { can, type MemberContext } from '@/server/access'
import { hasFeature } from '@/server/entitlements'
import { refreshInsightsAction } from './insights-actions'

const TONE = { positive: 'bg-success', negative: 'bg-danger', neutral: 'bg-border' } as const

/**
 * Dashboard home: the AI weekly digest (3–5 insights + 2 actions), refreshed Mondays 08:00 or on demand.
 * The digest text itself is AI output stored in English (not translated here).
 */
export async function InsightsCard({ ctx }: { ctx: MemberContext }) {
  if (!can(ctx, 'reports.view')) return null
  // AI insights are part of Premium (PLAN §18.8): no card on a plan without `ai`.
  if (!(await hasFeature(ctx.tenant.id, 'ai'))) return null
  const { t, fmt } = await getI18n()
  const configured = aiConfigured()
  const run = configured ? await withTenant(ctx.tenant.id, (tx) => latestInsights(tx)) : null
  const refresh = configured ? (
    <ActionForm action={refreshInsightsAction.bind(null, ctx.tenant.slug)}>
      <SubmitButton variant="ghost" size="sm">
        <RefreshCw /> {t('overview.insights.refresh')}
      </SubmitButton>
    </ActionForm>
  ) : null

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Sparkles className="size-4 text-accent" strokeWidth={1.75} /> {t('overview.insights.title')}
        </span>
      }
      sub={
        run?.input
          ? t('overview.insights.range', {
              from: fmt.dateShort(run.input.thisWeek.from),
              to: fmt.date(run.input.thisWeek.to),
              updated: fmt.date(run.createdAt),
            })
          : t('overview.insights.intro')
      }
      actions={refresh}
    >
      {!configured ? (
        <p className="crm-muted max-w-2xl text-sm">{t('overview.insights.off')}</p>
      ) : !run ? (
        <p className="crm-muted max-w-2xl text-sm">{t('overview.insights.first')}</p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-12 lg:gap-7">
          <Stagger className="space-y-3.5 lg:col-span-7">
            {run.output.insights.map((i) => (
              <StaggerItem key={i.title} className="flex gap-3">
                <span className={cn('mt-2 size-1.5 shrink-0 rounded-full', TONE[i.tone])} aria-hidden />
                <div className="min-w-0 space-y-0.5">
                  <p className="text-sm font-medium">{i.title}</p>
                  <p className="crm-muted text-sm">{i.detail}</p>
                </div>
              </StaggerItem>
            ))}
          </Stagger>
          <div className="rounded-xl bg-subtle/60 p-4 lg:col-span-5">
            <p className="crm-muted text-xs font-medium uppercase tracking-[0.06em]">
              {t('overview.insights.tryThisWeek')}
            </p>
            <ol className="mt-3 space-y-3.5">
              {run.output.actions.map((a, n) => (
                <li key={a.title} className="flex gap-3">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold text-accent-fg">
                    {n + 1}
                  </span>
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-sm font-medium">{a.title}</p>
                    <p className="crm-muted text-sm">{a.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </Card>
  )
}
