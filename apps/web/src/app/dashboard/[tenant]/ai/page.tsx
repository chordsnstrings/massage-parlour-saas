import { aiAgentSettings, aiUsage, brandProfiles, withTenant } from '@spa/db'
import { and, eq, gte, sql } from 'drizzle-orm'
import { ArrowRight, Image as ImageIcon, MessageCircle, Search, Sparkles, Star, Timer } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { FormSheet } from '@/components/ui/form-sheet'
import { Checkbox, Input, Select, Textarea } from '@/components/ui/input'
import { Stagger, StaggerItem } from '@/components/ui/motion'
import { PageBody, PageHeader } from '@/components/ui/page'
import { appPath } from '@/lib/paths'
import { can, requireMember } from '@/server/access'
import { saveAgentAction, saveBrandAction } from './actions'

export const metadata: Metadata = { title: 'AI studio' }

const AGENTS = [
  {
    key: 'dm_agent',
    icon: MessageCircle,
    name: 'Instagram receptionist',
    text: 'Answers DMs about prices, hours and location, and books appointments from chat.',
  },
  {
    key: 'content_agent',
    icon: ImageIcon,
    name: 'Instagram content',
    text: 'Drafts posts in English and Arabic with on-brand images, ready for your approval.',
  },
  {
    key: 'review_agent',
    icon: Star,
    name: 'Google review replies',
    text: 'Drafts warm, personal replies to every review — you approve before they go out.',
  },
  {
    key: 'seo_agent',
    icon: Search,
    name: 'SEO',
    text: 'Writes page titles and descriptions so people nearby find your website.',
  },
  {
    key: 'slot_filler',
    icon: Timer,
    name: 'Slot filler',
    text: 'Spots quiet hours and prepares WhatsApp offers for past clients to fill them.',
  },
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
  const pct = Math.min(100, Math.round((spent / Math.max(budget, 0.01)) * 100))
  const manage = can(ctx, 'ai.manage')
  return (
    <>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <Sparkles className="size-3.5" /> AI studio
          </span>
        }
        title="Your AI team"
        description="Helpers that answer clients, create content and fill quiet hours — always in your voice, and nothing goes out without the rules you set."
        actions={
          <Button asChild>
            <Link href={appPath(`/${slug}/ai/try`)}>
              Try the receptionist <ArrowRight />
            </Link>
          </Button>
        }
      />
      <PageBody>
        <div className="grid gap-6 lg:grid-cols-12">
          <Card className="lg:col-span-8">
            <CardHeader title="Shortcuts" />
            <CardBody className="grid gap-3 sm:grid-cols-3">
              {[
                { href: `/${slug}/ai/try`, label: 'Chat with your receptionist', icon: MessageCircle },
                { href: `/${slug}/ai/content`, label: 'Instagram drafts', icon: ImageIcon },
                { href: `/${slug}/ai/reviews`, label: 'Review replies', icon: Star },
              ].map((l) => (
                <Link
                  key={l.href}
                  href={appPath(l.href)}
                  className="group flex items-center gap-3 rounded-xl border p-4 transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-soft"
                >
                  <span className="grid size-9 place-items-center rounded-lg bg-accent-soft text-accent">
                    <l.icon className="size-4" strokeWidth={1.75} />
                  </span>
                  <span className="text-sm font-medium">{l.label}</span>
                </Link>
              ))}
            </CardBody>
          </Card>
          <Card className="lg:col-span-4">
            <CardHeader title="This month" description="AI usage against your plan's budget." />
            <CardBody className="space-y-3">
              <div className="flex items-baseline justify-between">
                <span className="tabular text-2xl font-semibold tracking-tight">${spent.toFixed(2)}</span>
                <span className="text-sm text-muted">of ${budget.toFixed(0)}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-subtle">
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-700"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </CardBody>
          </Card>
        </div>
        <Stagger className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {AGENTS.map((a) => {
            const s = settings.find((x) => x.agentKey === a.key)
            return (
              <StaggerItem key={a.key}>
                <Card className="flex h-full flex-col p-5 sm:p-6">
                  <div className="flex items-start justify-between gap-3">
                    <span className="grid size-10 place-items-center rounded-xl bg-subtle text-fg">
                      <a.icon className="size-[18px]" strokeWidth={1.5} />
                    </span>
                    <Badge tone={s?.enabled ? 'success' : 'neutral'}>
                      {s?.enabled ? (s.mode === 'autopilot' ? 'Autopilot' : 'Needs approval') : 'Off'}
                    </Badge>
                  </div>
                  <h3 className="mt-4 font-semibold tracking-tight">{a.name}</h3>
                  <p className="mt-1.5 flex-1 text-sm text-muted">{a.text}</p>
                  {manage && (
                    <div className="mt-5">
                      <FormSheet
                        title={a.name}
                        description={a.text}
                        action={saveAgentAction.bind(null, slug)}
                        trigger={
                          <Button variant="secondary" size="sm">
                            Configure
                          </Button>
                        }
                      >
                        <input type="hidden" name="agentKey" value={a.key} />
                        <label className="flex items-center gap-2.5 text-sm">
                          <Checkbox name="enabled" defaultChecked={s?.enabled ?? false} /> Switched on
                        </label>
                        <Field label="Mode" name="mode">
                          <Select id="mode" name="mode" defaultValue={s?.mode ?? 'approve'}>
                            <option value="approve">Draft — a person approves everything</option>
                            <option value="autopilot">Autopilot — send within the rules</option>
                          </Select>
                        </Field>
                        <Field label="Tone" name="tone">
                          <Input
                            id="tone"
                            name="tone"
                            defaultValue={s?.tone ?? 'warm, calm and professional'}
                          />
                        </Field>
                        <Field
                          label="Extra rules"
                          name="rules"
                          hint="e.g. Always mention free parking. Never offer discounts."
                        >
                          <Textarea id="rules" name="rules" defaultValue={s?.rules ?? ''} />
                        </Field>
                      </FormSheet>
                    </div>
                  )}
                </Card>
              </StaggerItem>
            )
          })}
        </Stagger>
        {manage && (
          <Card>
            <CardHeader title="Brand voice" description="How every AI helper should sound." />
            <CardBody>
              <ActionForm action={saveBrandAction.bind(null, slug)} className="grid gap-5 md:grid-cols-3">
                <Field label="Voice" name="voice" className="md:col-span-3">
                  <Textarea
                    id="voice"
                    name="voice"
                    defaultValue={
                      brand?.voice ?? 'Warm, calm and welcoming. Short sentences. No medical claims.'
                    }
                  />
                </Field>
                <Field label="Always" name="dos" hint="One per line.">
                  <Textarea
                    id="dos"
                    name="dos"
                    defaultValue={brand?.dos.join('\n') ?? ''}
                    placeholder="Mention our sea view"
                  />
                </Field>
                <Field label="Never" name="donts" hint="One per line.">
                  <Textarea
                    id="donts"
                    name="donts"
                    defaultValue={brand?.donts.join('\n') ?? ''}
                    placeholder="Use slang"
                  />
                </Field>
                <div className="flex items-end justify-end">
                  <SubmitButton>Save voice</SubmitButton>
                </div>
              </ActionForm>
            </CardBody>
          </Card>
        )}
      </PageBody>
    </>
  )
}
