import { aiAgentSettings, aiUsage, brandProfiles, withTenant } from '@spa/db'
import { and, eq, gte, sql } from 'drizzle-orm'
import { ArrowRight, Image as ImageIcon, MessageCircle, Search, Sparkles, Star, Timer } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, Grid, ListRow, Meter, Pill } from '@/components/crm'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { FormSheet } from '@/components/ui/form-sheet'
import { Checkbox, Input, Select, Textarea } from '@/components/ui/input'
import { PageBody, PageHeader } from '@/components/ui/page'
import { getI18n, getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { can, requireMember } from '@/server/access'
import { saveAgentAction, saveBrandAction } from './actions'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('ai.studio') }
}

const AGENTS = [
  { key: 'dm_agent', icon: MessageCircle },
  { key: 'content_agent', icon: ImageIcon },
  { key: 'review_agent', icon: Star },
  { key: 'seo_agent', icon: Search },
  { key: 'slot_filler', icon: Timer },
] as const

const dubaiMonthStart = () => {
  const d = new Date(Date.now() + 4 * 3600_000)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - 4 * 3600_000)
}

export default async function AiStudio({ params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'ai.approve') && !can(ctx, 'ai.manage')) notFound()
  const slug = ctx.tenant.slug
  const { settings, spent, brand } = await withTenant(ctx.tenant.id, async (tx) => ({
    settings: await tx.select().from(aiAgentSettings),
    spent: Number(
      (
        await tx
          .select({ v: sql<string>`coalesce(sum(${aiUsage.costUsd}), 0)` })
          .from(aiUsage)
          .where(and(eq(aiUsage.tenantId, ctx.tenant.id), gte(aiUsage.createdAt, dubaiMonthStart())))
      )[0]?.v ?? 0,
    ),
    brand: (await tx.select().from(brandProfiles))[0],
  }))
  const budget = Number(ctx.tenant.aiBudgetUsd)
  const manage = can(ctx, 'ai.manage')
  const { t, fmt } = await getI18n()
  const usd = (v: number) => fmt.number(Math.round(v * 100) / 100)
  return (
    <>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <Sparkles className="size-3.5" /> {t('ai.studio')}
          </span>
        }
        title={t('ai.title')}
        description={t('ai.description')}
        actions={
          <Button asChild>
            <Link href={appPath(`/${slug}/ai/try`)}>
              {t('ai.tryCta')} <ArrowRight className="rtl:rotate-180" />
            </Link>
          </Button>
        }
      />
      <PageBody>
        <Grid cols="col-2">
          <Card title={t('ai.shortcuts')}>
            {[
              { href: `/${slug}/ai/try`, label: t('ai.shortcutChat'), icon: MessageCircle },
              { href: `/${slug}/ai/content`, label: t('ai.shortcutPosts'), icon: ImageIcon },
              { href: `/${slug}/ai/reviews`, label: t('ai.shortcutReviews'), icon: Star },
            ].map((l) => (
              <ListRow
                key={l.href}
                href={appPath(l.href)}
                icon={<l.icon className="size-4" strokeWidth={1.75} />}
                title={l.label}
                end={<ArrowRight className="size-4 rtl:rotate-180" />}
              />
            ))}
          </Card>
          <Card title={t('ai.month')} sub={t('ai.monthSub')}>
            <div className="mb-3 flex items-baseline justify-between">
              <span className="crm-num text-2xl font-semibold">{t('ai.usd', { v: usd(spent) })}</span>
              <span className="crm-muted text-sm">{t('ai.ofBudget', { v: fmt.number(Math.round(budget)) })}</span>
            </div>
            <Meter
              label={t('ai.usage')}
              value={spent}
              max={Math.max(budget, 0.01)}
              tone={spent >= budget ? 'bad' : spent >= budget * 0.8 ? 'warn' : undefined}
            />
          </Card>
        </Grid>
        <Grid cols="g3">
          {AGENTS.map((a) => {
            const s = settings.find((x) => x.agentKey === a.key)
            const name = t(`ai.agent.${a.key}.name`)
            const text = t(`ai.agent.${a.key}.text`)
            return (
              <Card key={a.key} as="article" className="flex h-full flex-col">
                <div className="flex items-start justify-between gap-3">
                  <span className="crm-ricon" aria-hidden>
                    <a.icon className="size-[18px]" strokeWidth={1.5} />
                  </span>
                  <Pill tone={s?.enabled ? 'ok' : 'neutral'} dot>
                    {s?.enabled
                      ? s.mode === 'autopilot'
                        ? t('ai.statusAutopilot')
                        : t('ai.statusApproval')
                      : t('ai.statusOff')}
                  </Pill>
                </div>
                <h3 className="mt-3 font-semibold">{name}</h3>
                <p className="crm-muted mt-1 flex-1 text-sm">{text}</p>
                {manage && (
                  <div className="mt-4">
                    <FormSheet
                      title={name}
                      description={text}
                      action={saveAgentAction.bind(null, slug)}
                      trigger={
                        <Button variant="secondary" size="sm">
                          {t('ai.configure')}
                        </Button>
                      }
                    >
                      <input type="hidden" name="agentKey" value={a.key} />
                      <label className="flex items-center gap-2.5 text-sm">
                        <Checkbox name="enabled" defaultChecked={s?.enabled ?? false} /> {t('ai.switchedOn')}
                      </label>
                      <Field label={t('ai.mode')} name="mode">
                        <Select id="mode" name="mode" defaultValue={s?.mode ?? 'approve'}>
                          <option value="approve">{t('ai.modeApprove')}</option>
                          <option value="autopilot">{t('ai.modeAutopilot')}</option>
                        </Select>
                      </Field>
                      <Field label={t('ai.tone')} name="tone">
                        <Input id="tone" name="tone" defaultValue={s?.tone ?? 'warm, calm and professional'} />
                      </Field>
                      <Field label={t('ai.rules')} name="rules" hint={t('ai.rulesHint')}>
                        <Textarea id="rules" name="rules" defaultValue={s?.rules ?? ''} />
                      </Field>
                    </FormSheet>
                  </div>
                )}
              </Card>
            )
          })}
        </Grid>
        {manage && (
          <Card title={t('ai.brand')} sub={t('ai.brandSub')}>
            <ActionForm action={saveBrandAction.bind(null, slug)} className="grid gap-5 md:grid-cols-3">
              <Field label={t('ai.voice')} name="voice" className="md:col-span-3">
                <Textarea
                  id="voice"
                  name="voice"
                  defaultValue={brand?.voice ?? 'Warm, calm and welcoming. Short sentences. No medical claims.'}
                />
              </Field>
              <Field label={t('ai.always')} name="dos" hint={t('ai.onePerLine')}>
                <Textarea
                  id="dos"
                  name="dos"
                  defaultValue={brand?.dos.join('\n') ?? ''}
                  placeholder={t('ai.alwaysPh')}
                />
              </Field>
              <Field label={t('ai.never')} name="donts" hint={t('ai.onePerLine')}>
                <Textarea
                  id="donts"
                  name="donts"
                  defaultValue={brand?.donts.join('\n') ?? ''}
                  placeholder={t('ai.neverPh')}
                />
              </Field>
              <div className="flex items-end justify-end">
                <SubmitButton>{t('ai.saveVoice')}</SubmitButton>
              </div>
            </ActionForm>
          </Card>
        )}
      </PageBody>
    </>
  )
}
