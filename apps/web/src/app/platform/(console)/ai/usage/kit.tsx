import { type AiBudgetLevel, type AiUsageSlice, aiPeriod } from '@spa/services'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { ActionForm, SubmitButton } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { DataTable } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { setAiBudgetAction, setTenantAiEnabledAction } from './actions'

export const usd = (v: number) => `$${v.toFixed(2)}`
export const tokens = (v: number) =>
  v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}k` : String(v)

export const PERIODS = [
  { key: 'month', label: 'This month' },
  { key: 'last-month', label: 'Last month' },
] as const

export function PeriodPicker({ current, href }: { current: string; href: (key: string) => string }) {
  return (
    <nav aria-label="Period" className="flex gap-1 rounded-full border bg-surface p-1">
      {PERIODS.map((p) => (
        <Link
          key={p.key}
          href={href(p.key)}
          aria-current={p.key === current ? 'page' : undefined}
          className={cn(
            'rounded-full px-3 py-1.5 text-[13px] transition-colors',
            p.key === current ? 'bg-accent text-accent-fg' : 'text-muted hover:bg-subtle hover:text-fg',
          )}
        >
          {p.label}
        </Link>
      ))}
    </nav>
  )
}

export const periodOf = (key: string | undefined) => aiPeriod(key)

const LEVEL = {
  ok: { tone: 'success', label: 'ok' },
  warn: { tone: 'warning', label: '≥ 80 %' },
  over: { tone: 'danger', label: 'paused' },
} as const

export function LevelBadge({ level, enabled }: { level: AiBudgetLevel; enabled: boolean }) {
  if (!enabled) return <Badge tone="neutral">AI off</Badge>
  return <Badge tone={LEVEL[level].tone}>{LEVEL[level].label}</Badge>
}

/** Share of the budget used, as a thin bar + percent. */
export function UsedBar({ ratio }: { ratio: number }) {
  const pct = Math.round(ratio * 100)
  return (
    <span className="inline-flex min-w-24 flex-col items-end gap-1" data-testid="ai-used">
      <span
        className={cn('tabular-nums', pct >= 100 ? 'text-danger' : pct >= 80 ? 'text-warning' : undefined)}
      >
        {pct}%
      </span>
      <span className="h-1 w-full overflow-hidden rounded-full bg-subtle">
        <span
          className={cn(
            'block h-full rounded-full',
            pct >= 100 ? 'bg-danger' : pct >= 80 ? 'bg-warning' : 'bg-accent/70',
          )}
          style={{ width: `${Math.min(100, Math.max(pct > 0 ? 2 : 0, pct))}%` }}
        />
      </span>
    </span>
  )
}

/** Inline monthly budget editor (USD). */
export function BudgetForm({ tenantId, budget }: { tenantId: string; budget: number }) {
  return (
    <ActionForm
      action={setAiBudgetAction.bind(null, tenantId)}
      className="flex items-center justify-end gap-1.5"
    >
      <label className="sr-only" htmlFor={`budget-${tenantId}`}>
        Monthly AI budget (USD)
      </label>
      <Input
        id={`budget-${tenantId}`}
        name="budget"
        type="number"
        min={0}
        max={10000}
        step="0.01"
        defaultValue={budget.toFixed(2)}
        className="h-8 w-24 text-right tabular-nums"
        data-testid="ai-budget-input"
      />
      <SubmitButton size="sm" variant="secondary" data-testid="ai-budget-save">
        Save
      </SubmitButton>
    </ActionForm>
  )
}

export function KillSwitch({ tenantId, enabled }: { tenantId: string; enabled: boolean }) {
  return (
    <ActionForm action={setTenantAiEnabledAction.bind(null, tenantId, !enabled)}>
      <SubmitButton size="sm" variant={enabled ? 'danger' : 'primary'} data-testid="ai-toggle">
        {enabled ? 'Turn AI off' : 'Turn AI on'}
      </SubmitButton>
    </ActionForm>
  )
}

/** By-agent or by-model table. */
export function SliceTable({
  rows,
  label,
  names,
  empty,
}: {
  rows: AiUsageSlice[]
  label: string
  names?: Map<string, string>
  empty: React.ReactNode
}) {
  const total = rows.reduce((a, r) => a + r.costUsd, 0)
  return (
    <DataTable
      rows={rows}
      rowKey={(r) => r.key}
      empty={empty}
      columns={[
        {
          key: 'key',
          header: label,
          primary: true,
          cell: (r) => (
            <span>
              <span className="block font-medium">{names?.get(r.key) ?? r.key}</span>
              {names?.has(r.key) && <span className="text-xs text-muted">{r.key}</span>}
            </span>
          ),
        },
        { key: 'calls', header: 'Calls', className: 'text-right tabular-nums', cell: (r) => r.calls },
        {
          key: 'tokens',
          header: 'Tokens',
          className: 'text-right tabular-nums',
          cell: (r) => (r.images ? `${tokens(r.tokens)} · ${r.images} img` : tokens(r.tokens)),
        },
        {
          key: 'cost',
          header: 'Cost',
          className: 'text-right tabular-nums',
          cell: (r) => (
            <span>
              {usd(r.costUsd)}
              {total > 0 && (
                <span className="ms-1.5 text-xs text-muted">{Math.round((r.costUsd / total) * 100)}%</span>
              )}
            </span>
          ),
        },
      ]}
    />
  )
}
