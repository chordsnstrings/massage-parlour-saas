import type { ComponentConfig, Config, PuckContext } from '@puckeditor/core'

export type BlockInsight = { seen: number; seenPct: number; clicks: number }
/** Analytics overlay data passed to the canvas as Puck metadata (null = overlay off). */
export type InsightsMeta = {
  insights?: { sessions: number; days: number; top: string[]; blocks: Record<string, BlockInsight> } | null
}

const nf = new Intl.NumberFormat('en-AE')

function InsightBadge({ stat, sessions }: { stat?: BlockInsight; sessions: number }) {
  const text = !sessions
    ? 'No visits yet'
    : stat
      ? `Seen by ${stat.seenPct}% · ${nf.format(stat.clicks)} ${stat.clicks === 1 ? 'click' : 'clicks'}`
      : 'Not seen yet · 0 clicks'
  return (
    <span
      data-insight-badge=""
      className="pointer-events-none absolute end-3 top-3 z-30 inline-flex items-center gap-1.5 rounded-full bg-[#16241c]/90 px-2.5 py-1 font-sans text-[11px] font-medium tracking-normal text-white shadow-[0_2px_8px_rgb(0_0_0/0.18)] backdrop-blur-sm"
    >
      <span className="size-1.5 rounded-full bg-[#9bb0a4]" />
      {text}
    </span>
  )
}

const cache = new WeakMap<Config, Config>()

/**
 * Editor-only config wrapper for the block-analytics overlay (PLAN §11.6 P2): top-level blocks get a
 * "seen by x% · y clicks" badge from the last 30 days of web_events (data-block-id = Puck id).
 */
export function withInsights(config: Config): Config {
  const hit = cache.get(config)
  if (hit) return hit
  const components = Object.fromEntries(
    Object.entries(config.components).map(([name, c]) => {
      const Inner = c.render as (props: Record<string, unknown>) => React.ReactNode
      const render = (props: Record<string, unknown> & { id: string; puck: PuckContext }) => {
        const insights = (props.puck.metadata as InsightsMeta).insights
        if (!insights?.top.includes(props.id)) return <Inner {...props} />
        return (
          <>
            <InsightBadge stat={insights.blocks[props.id]} sessions={insights.sessions} />
            <Inner {...props} />
          </>
        )
      }
      return [name, { ...c, render } as ComponentConfig]
    }),
  )
  const wrapped = { ...config, components }
  cache.set(config, wrapped)
  return wrapped
}
