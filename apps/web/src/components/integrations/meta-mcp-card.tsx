import {
  AGENT_META_TOOLS,
  aiConfigured,
  externalMetaMcpConfig,
  groupOn,
  META_TOOL_GROUPS,
  META_TOOLS,
} from '@spa/ai'
import { tenants, withTenant } from '@spa/db'
import { metaAvailability } from '@spa/services'
import { eq } from 'drizzle-orm'
import { Sparkles } from 'lucide-react'
import { askMetaAiAction, saveMetaMcpAction } from '@/app/api/integrations/meta/mcp-actions'
import { Card, Pill, Toggle } from '@/components/crm'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { Textarea } from '@/components/ui/input'
import { getT } from '@/i18n/server'
import { can, type MemberContext } from '@/server/access'
import { aiFixturesOn } from '@/server/ai-fixture'

type ToolState = 'on' | 'off' | 'needsConnection' | 'autopilotOnly'
const TONE = { on: 'ok', off: 'neutral', needsConnection: 'warn', autopilotOnly: 'neutral' } as const

/** Settings → Integrations: "AI tools via Meta MCP" — connected Meta accounts, tool groups on/off, ask the AI (R7). */
export async function MetaMcpCard({ ctx }: { ctx: MemberContext }) {
  const t = await getT()
  const slug = ctx.tenant.slug
  const { settings, availability } = await withTenant(ctx.tenant.id, async (tx) => {
    const [row] = await tx
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenant.id))
    return { settings: row?.settings.metaMcp ?? {}, availability: await metaAvailability(tx) }
  })
  const external = await externalMetaMcpConfig()
  const canManage = can(ctx, 'ai.manage')
  const canAsk = can(ctx, 'ai.approve') && (aiConfigured() || aiFixturesOn())
  const autopilot = Boolean(settings.autopilot)
  const connected = Boolean(availability.instagram || availability.facebookPage)
  const all = new Set<string>(AGENT_META_TOOLS.meta_agent)
  const stateOf = (name: keyof typeof META_TOOLS): ToolState => {
    const spec = META_TOOLS[name] as { group: string; needs?: string; autopilotOnly?: boolean }
    if (!groupOn(settings.groups, spec.group as never)) return 'off'
    if (spec.needs === 'instagram' && !(availability.configured && availability.instagram))
      return 'needsConnection'
    if (spec.needs === 'facebook' && !availability.facebookPage) return 'needsConnection'
    if (spec.autopilotOnly && !autopilot) return 'autopilotOnly'
    return 'on'
  }
  const ig = availability.instagram
  const page = availability.facebookPage

  return (
    <Card
      className="flex flex-col"
      data-testid="meta-mcp-card"
      title={
        <span className="inline-flex items-center gap-2">
          <Sparkles className="size-4" strokeWidth={1.5} /> {t('settings.integrations.mcp.title')}
        </span>
      }
      sub={t('settings.integrations.mcp.sub')}
      actions={
        <Pill tone={connected ? 'ok' : 'neutral'}>
          {connected
            ? t('settings.integrations.mcp.badge.connected')
            : t('settings.integrations.mcp.badge.draftsOnly')}
        </Pill>
      }
    >
      <div className="space-y-5 text-sm">
        <dl className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <dt className="text-muted">{t('settings.integrations.mcp.account')}</dt>
            <dd data-testid="mcp-account">
              {ig
                ? ig.username
                  ? t('settings.integrations.mcp.instagram', { name: ig.username })
                  : t('settings.integrations.mcp.instagramNoName')
                : t('settings.integrations.mcp.noAccount')}
            </dd>
            <dd className="text-muted">
              {page
                ? page.name
                  ? t('settings.integrations.mcp.page', { name: page.name })
                  : t('settings.integrations.mcp.pageNoName')
                : t('settings.integrations.mcp.noPage')}
            </dd>
          </div>
          <div className="space-y-1">
            <dt className="text-muted">{t('settings.integrations.mcp.external')}</dt>
            <dd>
              {external
                ? t('settings.integrations.mcp.externalOn', { host: hostOf(external.url) })
                : t('settings.integrations.mcp.externalOff')}
            </dd>
          </div>
        </dl>

        <ActionForm action={saveMetaMcpAction.bind(null, slug)} className="space-y-4">
          <ul className="divide-y rounded-lg border">
            {META_TOOL_GROUPS.filter((g) => g !== 'external' || external).map((g) => {
              const tools = (Object.keys(META_TOOLS) as (keyof typeof META_TOOLS)[]).filter(
                (n) => META_TOOLS[n].group === g && all.has(n),
              )
              const title = t(`settings.integrations.mcp.groups.${g}.title`)
              return (
                <li key={g} className="space-y-2 px-4 py-3" data-testid={`mcp-group-${g}`}>
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0 space-y-0.5">
                      <span className="block font-medium">{title}</span>
                      <span className="block text-muted">
                        {t(`settings.integrations.mcp.groups.${g}.text`)}
                      </span>
                    </span>
                    <Toggle
                      label={title}
                      name={`group_${g}`}
                      defaultChecked={groupOn(settings.groups, g)}
                      disabled={!canManage}
                    />
                  </div>
                  {tools.length > 0 && (
                    <ul className="flex flex-wrap gap-1.5">
                      {tools.map((n) => {
                        const s = stateOf(n)
                        return (
                          <li key={n} className="inline-flex items-center gap-1.5" data-testid="mcp-tool">
                            <code className="rounded-md bg-subtle px-1.5 py-0.5 text-xs">{n}</code>
                            <Pill tone={TONE[s]}>{t(`settings.integrations.mcp.tool.${s}`)}</Pill>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
          <div className="flex items-start justify-between gap-3">
            <span className="min-w-0 space-y-0.5">
              <span className="block font-medium">{t('settings.integrations.mcp.autopilotTitle')}</span>
              <span className="block text-muted">{t('settings.integrations.mcp.autopilotText')}</span>
            </span>
            <Toggle
              label={t('settings.integrations.mcp.autopilotTitle')}
              name="autopilot"
              defaultChecked={autopilot}
              disabled={!canManage}
            />
          </div>
          {canManage && (
            <SubmitButton variant="secondary" className="min-h-11">
              {t('settings.integrations.mcp.save')}
            </SubmitButton>
          )}
        </ActionForm>

        <div className="space-y-3 border-t pt-4">
          <p className="font-medium">{t('settings.integrations.mcp.askTitle')}</p>
          {canAsk ? (
            <ActionForm action={askMetaAiAction.bind(null, slug)} className="space-y-3" resetOnSuccess>
              <Field label={t('settings.integrations.mcp.askLabel')} name="instruction">
                <Textarea
                  id="instruction"
                  name="instruction"
                  rows={2}
                  maxLength={1000}
                  placeholder={t('settings.integrations.mcp.askPlaceholder')}
                />
              </Field>
              <SubmitButton className="min-h-11">{t('settings.integrations.mcp.askSubmit')}</SubmitButton>
            </ActionForm>
          ) : (
            <p className="text-muted">{t('settings.integrations.mcp.notConfigured')}</p>
          )}
        </div>
      </div>
    </Card>
  )
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
