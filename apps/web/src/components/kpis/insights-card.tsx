import { aiConfigured, latestInsights } from '@spa/ai'
import { withTenant } from '@spa/db'
import { RefreshCw, Sparkles } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { ActionForm, SubmitButton } from '@/components/ui/form'
import { Stagger, StaggerItem } from '@/components/ui/motion'
import { cn, formatDate } from '@/lib/utils'
import { can, type MemberContext } from '@/server/access'
import { refreshInsightsAction } from './insights-actions'

const TONE = { positive: 'bg-success', negative: 'bg-danger', neutral: 'bg-border' } as const

const rangeLabel = (r: { from: string; to: string }) =>
  `${formatDate(r.from).replace(/ \d{4}$/, '')} – ${formatDate(r.to)}`

/** Dashboard home: the AI weekly digest (3–5 insights + 2 actions), refreshed Mondays 08:00 or on demand. */
export async function InsightsCard({ ctx }: { ctx: MemberContext }) {
  if (!can(ctx, 'reports.view')) return null
  const configured = aiConfigured()
  const run = configured ? await withTenant(ctx.tenant.id, (tx) => latestInsights(tx)) : null
  const refresh = configured ? (
    <ActionForm action={refreshInsightsAction.bind(null, ctx.tenant.slug)}>
      <SubmitButton variant="ghost" size="sm" className="min-h-11 sm:min-h-8">
        <RefreshCw /> Refresh
      </SubmitButton>
    </ActionForm>
  ) : null

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Sparkles className="size-4 text-accent" strokeWidth={1.75} /> Weekly insights
          </span>
        }
        description={
          run?.input
            ? `${rangeLabel(run.input.thisWeek)} vs the week before · updated ${formatDate(run.createdAt)}`
            : 'What changed last week, and two things to try this week.'
        }
        action={refresh}
      />
      <CardBody>
        {!configured ? (
          <p className="max-w-2xl text-sm text-muted">
            AI insights aren’t switched on yet. Once the AI service is connected, a short digest of your week
            — revenue, bookings, utilisation, no-shows and clients — appears here every Monday morning.
          </p>
        ) : !run ? (
          <p className="max-w-2xl text-sm text-muted">
            Your first digest arrives Monday at 08:00. Tap Refresh to create one now from the last 7 days.
          </p>
        ) : (
          <div className="grid gap-6 lg:grid-cols-12 lg:gap-8">
            <Stagger className="space-y-4 lg:col-span-7">
              {run.output.insights.map((i) => (
                <StaggerItem key={i.title} className="flex gap-3">
                  <span className={cn('mt-2 size-1.5 shrink-0 rounded-full', TONE[i.tone])} aria-hidden />
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-sm font-medium">{i.title}</p>
                    <p className="text-sm text-muted">{i.detail}</p>
                  </div>
                </StaggerItem>
              ))}
            </Stagger>
            <div className="rounded-xl bg-subtle/60 p-5 lg:col-span-5">
              <p className="text-xs font-medium uppercase tracking-[0.06em] text-muted">Try this week</p>
              <ol className="mt-3 space-y-4">
                {run.output.actions.map((a, n) => (
                  <li key={a.title} className="flex gap-3">
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold text-accent-fg">
                      {n + 1}
                    </span>
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-sm font-medium">{a.title}</p>
                      <p className="text-sm text-muted">{a.detail}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  )
}
