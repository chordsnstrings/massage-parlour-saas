import { enumLabel, type Translator } from '@spa/core/i18n'
import {
  clientMemberships,
  clientPackages,
  giftCards,
  membershipPlans,
  packageDefinitions,
  promoCodes,
  services,
  withTenant,
} from '@spa/db'
import { asc, count, desc, eq } from 'drizzle-orm'
import { Gift, Package, Pencil, Plus, Repeat, ShoppingBag, TicketPercent, Users } from 'lucide-react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Card, Grid, Pill, SectionTabs, Stack, Stat, statusTone } from '@/components/crm'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/form'
import { FormSheet } from '@/components/ui/form-sheet'
import { Checkbox, Input, Label, Select, Textarea } from '@/components/ui/input'
import { EmptyState, PageHeader } from '@/components/ui/page'
import { getI18n, getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { cn } from '@/lib/utils'
import { can, requireMember } from '@/server/access'
import { saveMembershipAction, savePackageAction, savePromoAction, toggleActiveAction } from './actions'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('packages.title') }
}

const TABS = [
  { key: 'packages', label: 'packages.tabs.packages', icon: Package },
  { key: 'memberships', label: 'packages.tabs.memberships', icon: Repeat },
  { key: 'gift-cards', label: 'packages.tabs.giftCards', icon: Gift },
  { key: 'promos', label: 'packages.tabs.promos', icon: TicketPercent },
] as const
type Tab = (typeof TABS)[number]['key']
type Item = { serviceId: string; quantity: number }
type ServiceOpt = { id: string; name: string }

function ItemRows({
  t,
  options,
  items,
  optional,
}: {
  t: Translator
  options: ServiceOpt[]
  items?: Item[]
  optional?: boolean
}) {
  return (
    <fieldset className="space-y-2.5">
      <legend className="mb-2 text-sm font-medium">
        {optional ? t('packages.items.monthly') : t('packages.items.included')}
      </legend>
      {[1, 2, 3, 4].map((n) => {
        const item = items?.[n - 1]
        return (
          <div key={n} className="grid grid-cols-[1fr_5.5rem] gap-2">
            <Select
              name={`item${n}Service`}
              defaultValue={item?.serviceId ?? ''}
              aria-label={t('packages.items.treatmentN', { n })}
            >
              <option value="">{n === 1 && !optional ? t('packages.items.choose') : '—'}</option>
              {options.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
            <Input
              name={`item${n}Qty`}
              type="number"
              min={1}
              max={100}
              defaultValue={item?.quantity ?? (n === 1 ? 5 : '')}
              aria-label={t('packages.items.sessionsN', { n })}
              placeholder="×"
            />
          </div>
        )
      })}
    </fieldset>
  )
}

function ActiveToggle({
  t,
  slug,
  kind,
  id,
  active,
  disabled,
}: {
  t: Translator
  slug: string
  kind: 'package' | 'membership' | 'promo'
  id: string
  active: boolean
  disabled?: boolean
}) {
  return (
    <form action={toggleActiveAction.bind(null, slug, kind, id, !active)}>
      <Button variant="ghost" size="sm" type="submit" disabled={disabled}>
        {active ? t('packages.pause') : t('packages.activate')}
      </Button>
    </form>
  )
}

export default async function PackagesPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'services.manage') && !can(ctx, 'pos.use')) notFound()
  const { t, fmt } = await getI18n()
  const tabParam = (await searchParams).tab
  const tab: Tab = TABS.some((x) => x.key === tabParam) ? (tabParam as Tab) : 'packages'
  const slug = ctx.tenant.slug
  const manage = can(ctx, 'services.manage')
  const promos = can(ctx, 'marketing.campaigns')
  const base = appPath(`/${slug}/packages`)

  const data = await withTenant(ctx.tenant.id, async (tx) => ({
    services: (
      await tx
        .select({ id: services.id, name: services.name })
        .from(services)
        .where(eq(services.active, true))
        .orderBy(asc(services.sort))
    ).map((s) => ({ id: s.id, name: s.name.en })),
    packages: await tx
      .select()
      .from(packageDefinitions)
      .orderBy(desc(packageDefinitions.active), asc(packageDefinitions.createdAt)),
    sold: await tx
      .select({ id: clientPackages.definitionId, n: count() })
      .from(clientPackages)
      .groupBy(clientPackages.definitionId),
    plans: await tx
      .select()
      .from(membershipPlans)
      .orderBy(desc(membershipPlans.active), asc(membershipPlans.createdAt)),
    members: await tx
      .select({ id: clientMemberships.planId, n: count() })
      .from(clientMemberships)
      .where(eq(clientMemberships.status, 'active'))
      .groupBy(clientMemberships.planId),
    cards:
      tab === 'gift-cards'
        ? await tx.select().from(giftCards).orderBy(desc(giftCards.createdAt)).limit(200)
        : [],
    promos: tab === 'promos' ? await tx.select().from(promoCodes).orderBy(desc(promoCodes.createdAt)) : [],
  }))
  const serviceName = new Map(data.services.map((s) => [s.id, s.name]))
  const soldBy = new Map(data.sold.map((r) => [r.id, r.n]))
  const membersBy = new Map(data.members.map((r) => [r.id, r.n]))
  const itemsText = (items: Item[]) =>
    items.map((i) => `${i.quantity}× ${serviceName.get(i.serviceId) ?? t('packages.treatment')}`).join(' · ')

  const totalSold = data.sold.reduce((sum, r) => sum + r.n, 0)
  const totalMembers = data.members.reduce((sum, r) => sum + r.n, 0)

  const packageForm = (p?: (typeof data.packages)[number]) => (
    <>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t('packages.form.name')} name="nameEn">
          <Input
            id="nameEn"
            name="nameEn"
            defaultValue={p?.name.en}
            placeholder={t('packages.form.namePlaceholder')}
          />
        </Field>
        <Field label={t('packages.form.nameAr')} name="nameAr">
          <Input id="nameAr" name="nameAr" dir="rtl" defaultValue={p?.name.ar} />
        </Field>
      </div>
      <ItemRows t={t} options={data.services} items={p?.items} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t('packages.form.price')} name="priceAed">
          <Input
            id="priceAed"
            name="priceAed"
            inputMode="decimal"
            defaultValue={p ? Number(p.priceAed) : ''}
          />
        </Field>
        <Field label={t('packages.form.validity')} name="validityDays">
          <Input id="validityDays" name="validityDays" type="number" defaultValue={p?.validityDays ?? 180} />
        </Field>
      </div>
      <Field label={t('packages.form.description')} name="descriptionEn">
        <Textarea id="descriptionEn" name="descriptionEn" defaultValue={p?.description?.en} rows={2} />
      </Field>
      <Label className="flex items-center gap-2.5 text-sm font-normal">
        <Checkbox name="active" defaultChecked={p?.active ?? true} /> {t('packages.form.available')}
      </Label>
    </>
  )

  const planForm = (p?: (typeof data.plans)[number]) => (
    <>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t('packages.form.name')} name="nameEn">
          <Input
            id="nameEn"
            name="nameEn"
            defaultValue={p?.name.en}
            placeholder={t('packages.form.planPlaceholder')}
          />
        </Field>
        <Field label={t('packages.form.nameAr')} name="nameAr">
          <Input id="nameAr" name="nameAr" dir="rtl" defaultValue={p?.name.ar} />
        </Field>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t('packages.form.monthly')} name="monthlyAed">
          <Input
            id="monthlyAed"
            name="monthlyAed"
            inputMode="decimal"
            defaultValue={p ? Number(p.monthlyAed) : ''}
          />
        </Field>
        <Field label={t('packages.form.discount')} name="discountPct">
          <Input
            id="discountPct"
            name="discountPct"
            type="number"
            defaultValue={p?.benefits.discountPct ?? 10}
          />
        </Field>
      </div>
      <ItemRows t={t} options={data.services} items={p?.benefits.includedSessions} optional />
      <Label className="flex items-center gap-2.5 text-sm font-normal">
        <Checkbox name="active" defaultChecked={p?.active ?? true} /> {t('packages.form.open')}
      </Label>
    </>
  )

  const action =
    tab === 'packages' && manage ? (
      <FormSheet
        title={t('packages.pkg.new')}
        description={t('packages.pkg.newDescription')}
        action={savePackageAction.bind(null, slug, null)}
        submitLabel={t('packages.pkg.create')}
        trigger={
          <Button>
            <Plus /> {t('packages.pkg.new')}
          </Button>
        }
      >
        {packageForm()}
      </FormSheet>
    ) : tab === 'memberships' && manage ? (
      <FormSheet
        title={t('packages.plan.newTitle')}
        action={saveMembershipAction.bind(null, slug, null)}
        submitLabel={t('packages.plan.create')}
        trigger={
          <Button>
            <Plus /> {t('packages.plan.new')}
          </Button>
        }
      >
        {planForm()}
      </FormSheet>
    ) : tab === 'promos' && promos ? (
      <FormSheet
        title={t('packages.promo.newTitle')}
        action={savePromoAction.bind(null, slug)}
        submitLabel={t('packages.promo.create')}
        trigger={
          <Button>
            <Plus /> {t('packages.promo.new')}
          </Button>
        }
      >
        <Field label={t('packages.promo.code')} name="code" hint={t('packages.promo.codeHint')}>
          <Input id="code" name="code" placeholder="RAMADAN20" className="font-mono uppercase" />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={t('packages.promo.type')} name="kind">
            <Select id="kind" name="kind" defaultValue="percent">
              <option value="percent">{t('packages.promo.percentOff')}</option>
              <option value="amount">{t('packages.promo.amountOff')}</option>
            </Select>
          </Field>
          <Field label={t('packages.promo.value')} name="value">
            <Input id="value" name="value" inputMode="decimal" placeholder="20" />
          </Field>
          <Field label={t('packages.promo.starts')} name="validFrom">
            <Input id="validFrom" name="validFrom" type="date" />
          </Field>
          <Field label={t('packages.promo.ends')} name="validTo">
            <Input id="validTo" name="validTo" type="date" />
          </Field>
        </div>
        <Field label={t('packages.promo.maxUses')} name="maxUses" hint={t('packages.promo.maxUsesHint')}>
          <Input id="maxUses" name="maxUses" type="number" />
        </Field>
      </FormSheet>
    ) : null

  const editRow = (toggle: React.ReactNode, sheet: React.ReactNode) => (
    <div className="mt-auto flex items-center justify-end gap-1 pt-4">
      {toggle}
      {sheet}
    </div>
  )
  const editTrigger = (
    <Button variant="secondary" size="sm">
      <Pencil /> {t('packages.edit')}
    </Button>
  )

  return (
    <>
      <PageHeader title={t('packages.title')} description={t('packages.description')} actions={action} />
      <SectionTabs
        label={t('packages.tabs.label')}
        value={tab}
        items={TABS.map((x) => ({
          value: x.key,
          href: `${base}?tab=${x.key}`,
          label: (
            <>
              <x.icon className="size-4" strokeWidth={1.6} aria-hidden /> {t(x.label)}
            </>
          ),
        }))}
      />
      <Stack>
        {(tab === 'packages' || tab === 'memberships') && (
          <Grid cols="g4">
            <Stat
              icon={<Package />}
              label={t('packages.stat.onSale')}
              value={fmt.number(data.packages.filter((p) => p.active).length)}
            />
            <Stat icon={<ShoppingBag />} label={t('packages.stat.sold')} value={fmt.number(totalSold)} />
            <Stat
              icon={<Repeat />}
              label={t('packages.stat.plans')}
              value={fmt.number(data.plans.filter((p) => p.active).length)}
            />
            <Stat icon={<Users />} label={t('packages.stat.members')} value={fmt.number(totalMembers)} />
          </Grid>
        )}

        {tab === 'packages' &&
          (data.packages.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Package className="size-5" strokeWidth={1.5} />}
                title={t('packages.pkg.emptyTitle')}
                description={
                  data.services.length === 0 ? t('packages.pkg.emptyNoServices') : t('packages.pkg.emptyBody')
                }
              />
            </Card>
          ) : (
            <Grid cols="g3">
              {data.packages.map((p) => (
                <Card
                  key={p.id}
                  as="article"
                  className={cn('flex h-full flex-col', !p.active && 'opacity-60')}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <h2 className="text-[length:var(--crm-fs-card-title)] font-semibold">{p.name.en}</h2>
                      <p className="crm-muted text-[length:var(--crm-fs-sub)]">{itemsText(p.items)}</p>
                    </div>
                    {!p.active && <Pill>{t('packages.paused')}</Pill>}
                  </div>
                  <p className="crm-num mt-4 text-2xl font-semibold tracking-tight">{fmt.aed(p.priceAed)}</p>
                  <p className="crm-muted mt-1 text-[length:var(--crm-fs-sub)]">
                    {t('packages.pkg.validSold', {
                      days: p.validityDays,
                      count: fmt.number(soldBy.get(p.id) ?? 0),
                    })}
                  </p>
                  {manage &&
                    editRow(
                      <ActiveToggle t={t} slug={slug} kind="package" id={p.id} active={p.active} />,
                      <FormSheet
                        title={t('packages.pkg.edit')}
                        description={t('packages.pkg.editDescription')}
                        action={savePackageAction.bind(null, slug, p.id)}
                        trigger={editTrigger}
                      >
                        {packageForm(p)}
                      </FormSheet>,
                    )}
                </Card>
              ))}
            </Grid>
          ))}

        {tab === 'memberships' &&
          (data.plans.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Repeat className="size-5" strokeWidth={1.5} />}
                title={t('packages.plan.emptyTitle')}
                description={t('packages.plan.emptyBody')}
              />
            </Card>
          ) : (
            <Grid cols="g3">
              {data.plans.map((p) => (
                <Card
                  key={p.id}
                  as="article"
                  className={cn('flex h-full flex-col', !p.active && 'opacity-60')}
                >
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="min-w-0 text-[length:var(--crm-fs-card-title)] font-semibold">
                      {p.name.en}
                    </h2>
                    {!p.active && <Pill>{t('packages.paused')}</Pill>}
                  </div>
                  <p className="crm-muted mt-1 text-[length:var(--crm-fs-sub)]">
                    {[
                      p.benefits.includedSessions?.length ? itemsText(p.benefits.includedSessions) : null,
                      p.benefits.discountPct
                        ? t('packages.plan.offExtras', { pct: p.benefits.discountPct })
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || t('packages.plan.noBenefits')}
                  </p>
                  <p className="crm-num mt-4 text-2xl font-semibold tracking-tight">
                    {fmt.aed(p.monthlyAed)}
                    <span className="crm-muted text-sm font-normal"> {t('packages.plan.perMonth')}</span>
                  </p>
                  <p className="crm-muted mt-1 text-[length:var(--crm-fs-sub)]">
                    {t('packages.plan.members', { count: membersBy.get(p.id) ?? 0 })}
                  </p>
                  {manage &&
                    editRow(
                      <ActiveToggle t={t} slug={slug} kind="membership" id={p.id} active={p.active} />,
                      <FormSheet
                        title={t('packages.plan.edit')}
                        action={saveMembershipAction.bind(null, slug, p.id)}
                        trigger={editTrigger}
                      >
                        {planForm(p)}
                      </FormSheet>,
                    )}
                </Card>
              ))}
            </Grid>
          ))}

        {tab === 'gift-cards' && (
          <Card title={t('packages.card.list')} sub={t('packages.card.listSub')}>
            {data.cards.length === 0 ? (
              <EmptyState
                icon={<Gift className="size-5" strokeWidth={1.5} />}
                title={t('packages.card.emptyTitle')}
                description={t('packages.card.emptyBody')}
              />
            ) : (
              <div className="crm-tbl-wrap">
                <table className="crm-tbl" data-stack="true">
                  <thead>
                    <tr>
                      <th>{t('packages.card.code')}</th>
                      <th>{t('packages.card.for')}</th>
                      <th>{t('packages.card.issued')}</th>
                      <th>{t('packages.card.expires')}</th>
                      <th className="crm-num-c">{t('packages.card.value')}</th>
                      <th className="crm-num-c">{t('packages.card.balance')}</th>
                      <th>{t('packages.card.status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.cards.map((c) => (
                      <tr key={c.id}>
                        <td data-label={t('packages.card.code')} className="font-mono font-semibold">
                          {c.code}
                        </td>
                        <td data-label={t('packages.card.for')}>{c.recipientName || '—'}</td>
                        <td data-label={t('packages.card.issued')}>{fmt.date(c.createdAt)}</td>
                        <td data-label={t('packages.card.expires')} className="crm-muted">
                          {c.expiresAt ? fmt.date(c.expiresAt) : '—'}
                        </td>
                        <td data-label={t('packages.card.value')} className="crm-num-c">
                          {fmt.aed(c.initialAed)}
                        </td>
                        <td data-label={t('packages.card.balance')} className="crm-num-c font-semibold">
                          {fmt.aed(c.balanceAed)}
                        </td>
                        <td data-label={t('packages.card.status')}>
                          <Pill tone={statusTone(c.status)} dot>
                            {enumLabel(t, 'giftCardStatus', c.status)}
                          </Pill>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}

        {tab === 'promos' && (
          <Card title={t('packages.promo.list')}>
            {data.promos.length === 0 ? (
              <EmptyState
                icon={<TicketPercent className="size-5" strokeWidth={1.5} />}
                title={t('packages.promo.emptyTitle')}
                description={t('packages.promo.emptyBody')}
              />
            ) : (
              <div className="crm-tbl-wrap">
                <table className="crm-tbl" data-stack="true">
                  <thead>
                    <tr>
                      <th>{t('packages.promo.code')}</th>
                      <th>{t('packages.promo.discount')}</th>
                      <th>{t('packages.promo.valid')}</th>
                      <th className="crm-num-c">{t('packages.promo.used')}</th>
                      <th className="crm-num-c">{t('packages.promo.status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.promos.map((p) => (
                      <tr key={p.id}>
                        <td data-label={t('packages.promo.code')} className="font-mono font-semibold">
                          {p.code}
                        </td>
                        <td data-label={t('packages.promo.discount')}>
                          {p.kind === 'percent' ? `${fmt.number(Number(p.value))}%` : fmt.aed(p.value)}
                        </td>
                        <td data-label={t('packages.promo.valid')} className="crm-muted">
                          {p.validFrom || p.validTo
                            ? `${p.validFrom ? fmt.date(p.validFrom) : '…'} – ${p.validTo ? fmt.date(p.validTo) : '…'}`
                            : t('packages.promo.always')}
                        </td>
                        <td data-label={t('packages.promo.used')} className="crm-num-c">
                          {p.maxUses
                            ? `${fmt.number(p.uses)} / ${fmt.number(p.maxUses)}`
                            : fmt.number(p.uses)}
                        </td>
                        <td data-label={t('packages.promo.status')} className="crm-num-c">
                          <div className="flex items-center justify-end gap-2">
                            <Pill tone={p.active ? 'ok' : 'neutral'} dot>
                              {p.active ? t('packages.active') : t('packages.paused')}
                            </Pill>
                            {promos && (
                              <ActiveToggle t={t} slug={slug} kind="promo" id={p.id} active={p.active} />
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}
      </Stack>
    </>
  )
}
