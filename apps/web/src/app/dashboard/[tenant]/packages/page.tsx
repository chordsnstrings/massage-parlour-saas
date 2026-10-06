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
import { Gift, Package, Pencil, Plus, Repeat, TicketPercent } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field } from '@/components/ui/form'
import { FormSheet } from '@/components/ui/form-sheet'
import { Checkbox, Input, Label, Select, Textarea } from '@/components/ui/input'
import { Stagger, StaggerItem } from '@/components/ui/motion'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { type Column, DataTable } from '@/components/ui/table'
import { appPath } from '@/lib/paths'
import { cn, formatAed, formatDate } from '@/lib/utils'
import { can, requireMember } from '@/server/access'
import { saveMembershipAction, savePackageAction, savePromoAction, toggleActiveAction } from './actions'

export const metadata: Metadata = { title: 'Packages & gifts' }

const TABS = [
  { key: 'packages', label: 'Packages', icon: Package },
  { key: 'memberships', label: 'Memberships', icon: Repeat },
  { key: 'gift-cards', label: 'Gift cards', icon: Gift },
  { key: 'promos', label: 'Promo codes', icon: TicketPercent },
] as const
type Tab = (typeof TABS)[number]['key']
type Item = { serviceId: string; quantity: number }
type ServiceOpt = { id: string; name: string }

function ItemRows({
  options,
  items,
  optional,
}: {
  options: ServiceOpt[]
  items?: Item[]
  optional?: boolean
}) {
  return (
    <fieldset className="space-y-2.5">
      <legend className="mb-2 text-sm font-medium">
        {optional ? 'Included sessions each month (optional)' : 'Treatments included'}
      </legend>
      {[1, 2, 3, 4].map((n) => {
        const item = items?.[n - 1]
        return (
          <div key={n} className="grid grid-cols-[1fr_5.5rem] gap-2">
            <Select
              name={`item${n}Service`}
              defaultValue={item?.serviceId ?? ''}
              aria-label={`Treatment ${n}`}
            >
              <option value="">{n === 1 && !optional ? 'Choose a treatment…' : '—'}</option>
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
              aria-label={`Sessions of treatment ${n}`}
              placeholder="×"
            />
          </div>
        )
      })}
    </fieldset>
  )
}

function ActiveToggle({
  slug,
  kind,
  id,
  active,
  disabled,
}: {
  slug: string
  kind: 'package' | 'membership' | 'promo'
  id: string
  active: boolean
  disabled?: boolean
}) {
  return (
    <form action={toggleActiveAction.bind(null, slug, kind, id, !active)}>
      <Button variant="ghost" size="sm" type="submit" disabled={disabled}>
        {active ? 'Pause' : 'Activate'}
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
  const tabParam = (await searchParams).tab
  const tab: Tab = TABS.some((t) => t.key === tabParam) ? (tabParam as Tab) : 'packages'
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
    items.map((i) => `${i.quantity}× ${serviceName.get(i.serviceId) ?? 'Treatment'}`).join(' · ')

  const packageForm = (p?: (typeof data.packages)[number]) => (
    <>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Name" name="nameEn">
          <Input id="nameEn" name="nameEn" defaultValue={p?.name.en} placeholder="5 × Deep tissue" />
        </Field>
        <Field label="Name (Arabic)" name="nameAr">
          <Input id="nameAr" name="nameAr" dir="rtl" defaultValue={p?.name.ar} />
        </Field>
      </div>
      <ItemRows options={data.services} items={p?.items} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Package price (AED, incl. VAT)" name="priceAed">
          <Input
            id="priceAed"
            name="priceAed"
            inputMode="decimal"
            defaultValue={p ? Number(p.priceAed) : ''}
          />
        </Field>
        <Field label="Valid for (days)" name="validityDays">
          <Input id="validityDays" name="validityDays" type="number" defaultValue={p?.validityDays ?? 180} />
        </Field>
      </div>
      <Field label="Description" name="descriptionEn">
        <Textarea id="descriptionEn" name="descriptionEn" defaultValue={p?.description?.en} rows={2} />
      </Field>
      <Label className="flex items-center gap-2.5 text-sm font-normal">
        <Checkbox name="active" defaultChecked={p?.active ?? true} /> Available for sale
      </Label>
    </>
  )

  const planForm = (p?: (typeof data.plans)[number]) => (
    <>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Name" name="nameEn">
          <Input id="nameEn" name="nameEn" defaultValue={p?.name.en} placeholder="Monthly wellness" />
        </Field>
        <Field label="Name (Arabic)" name="nameAr">
          <Input id="nameAr" name="nameAr" dir="rtl" defaultValue={p?.name.ar} />
        </Field>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Monthly fee (AED, incl. VAT)" name="monthlyAed">
          <Input
            id="monthlyAed"
            name="monthlyAed"
            inputMode="decimal"
            defaultValue={p ? Number(p.monthlyAed) : ''}
          />
        </Field>
        <Field label="Member discount on extras (%)" name="discountPct">
          <Input
            id="discountPct"
            name="discountPct"
            type="number"
            defaultValue={p?.benefits.discountPct ?? 10}
          />
        </Field>
      </div>
      <ItemRows options={data.services} items={p?.benefits.includedSessions} optional />
      <Label className="flex items-center gap-2.5 text-sm font-normal">
        <Checkbox name="active" defaultChecked={p?.active ?? true} /> Open for new members
      </Label>
    </>
  )

  const cardCols: Column<(typeof data.cards)[number]>[] = [
    {
      key: 'code',
      header: 'Code',
      primary: true,
      cell: (c) => <span className="font-mono font-medium">{c.code}</span>,
    },
    { key: 'to', header: 'For', cell: (c) => c.recipientName || '—' },
    { key: 'issued', header: 'Issued', cell: (c) => formatDate(c.createdAt) },
    {
      key: 'expires',
      header: 'Expires',
      hideOnMobile: true,
      cell: (c) => (c.expiresAt ? formatDate(c.expiresAt) : '—'),
    },
    {
      key: 'value',
      header: 'Value',
      className: 'text-right tabular-nums',
      cell: (c) => formatAed(c.initialAed),
    },
    {
      key: 'balance',
      header: 'Balance',
      className: 'text-right tabular-nums font-medium',
      cell: (c) => formatAed(c.balanceAed),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (c) => <Badge tone={c.status === 'active' ? 'success' : 'neutral'}>{c.status}</Badge>,
    },
  ]
  const promoCols: Column<(typeof data.promos)[number]>[] = [
    {
      key: 'code',
      header: 'Code',
      primary: true,
      cell: (p) => <span className="font-mono font-medium">{p.code}</span>,
    },
    {
      key: 'off',
      header: 'Discount',
      cell: (p) => (p.kind === 'percent' ? `${Number(p.value)}%` : formatAed(p.value)),
    },
    {
      key: 'valid',
      header: 'Valid',
      cell: (p) =>
        p.validFrom || p.validTo
          ? `${p.validFrom ? formatDate(p.validFrom) : '…'} – ${p.validTo ? formatDate(p.validTo) : '…'}`
          : 'Always',
    },
    {
      key: 'uses',
      header: 'Used',
      className: 'tabular-nums',
      cell: (p) => `${p.uses}${p.maxUses ? ` / ${p.maxUses}` : ''}`,
    },
    {
      key: 'status',
      header: '',
      className: 'text-right',
      cell: (p) => (
        <div className="flex items-center justify-end gap-2">
          <Badge tone={p.active ? 'success' : 'neutral'}>{p.active ? 'Active' : 'Paused'}</Badge>
          {promos && <ActiveToggle slug={slug} kind="promo" id={p.id} active={p.active} />}
        </div>
      ),
    },
  ]

  const action =
    tab === 'packages' && manage ? (
      <FormSheet
        title="New package"
        description="Clients prepay for several sessions; each visit draws one down."
        action={savePackageAction.bind(null, slug, null)}
        submitLabel="Create package"
        trigger={
          <Button>
            <Plus /> New package
          </Button>
        }
      >
        {packageForm()}
      </FormSheet>
    ) : tab === 'memberships' && manage ? (
      <FormSheet
        title="New membership plan"
        action={saveMembershipAction.bind(null, slug, null)}
        submitLabel="Create plan"
        trigger={
          <Button>
            <Plus /> New plan
          </Button>
        }
      >
        {planForm()}
      </FormSheet>
    ) : tab === 'promos' && promos ? (
      <FormSheet
        title="New promo code"
        action={savePromoAction.bind(null, slug)}
        submitLabel="Create code"
        trigger={
          <Button>
            <Plus /> New code
          </Button>
        }
      >
        <Field label="Code" name="code" hint="Clients enter this at checkout or when booking.">
          <Input id="code" name="code" placeholder="RAMADAN20" className="font-mono uppercase" />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Type" name="kind">
            <Select id="kind" name="kind" defaultValue="percent">
              <option value="percent">Percent off</option>
              <option value="amount">AED off</option>
            </Select>
          </Field>
          <Field label="Value" name="value">
            <Input id="value" name="value" inputMode="decimal" placeholder="20" />
          </Field>
          <Field label="Starts" name="validFrom">
            <Input id="validFrom" name="validFrom" type="date" />
          </Field>
          <Field label="Ends" name="validTo">
            <Input id="validTo" name="validTo" type="date" />
          </Field>
        </div>
        <Field label="Maximum uses" name="maxUses" hint="Leave empty for unlimited.">
          <Input id="maxUses" name="maxUses" type="number" />
        </Field>
      </FormSheet>
    ) : null

  return (
    <>
      <PageHeader
        title="Packages & gifts"
        description="Prepaid packages, monthly memberships, gift cards and promo codes. Sell them from Sales — the money is held as a liability until it's used."
        actions={action}
      />
      <nav
        className="-mt-4 mb-8 flex gap-6 overflow-x-auto border-b text-sm sm:-mt-6"
        aria-label="Packages & gifts"
      >
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`${base}?tab=${t.key}`}
            aria-current={tab === t.key ? 'page' : undefined}
            className={cn(
              '-mb-px flex shrink-0 items-center gap-2 border-b-2 pb-3 transition-colors',
              tab === t.key ? 'border-fg font-medium text-fg' : 'border-transparent text-muted hover:text-fg',
            )}
          >
            <t.icon className="size-4" strokeWidth={1.5} /> {t.label}
          </Link>
        ))}
      </nav>
      <PageBody>
        {tab === 'packages' &&
          (data.packages.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Package className="size-5" strokeWidth={1.5} />}
                title="No packages yet"
                description={
                  data.services.length === 0
                    ? 'Add your treatments under Services & rooms first, then bundle them here.'
                    : 'Bundle sessions at a better price — e.g. 5 × 60 min deep tissue for AED 1,250.'
                }
              />
            </Card>
          ) : (
            <Stagger className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {data.packages.map((p) => (
                <StaggerItem key={p.id}>
                  <Card className={cn('flex h-full flex-col p-6', !p.active && 'opacity-60')}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <h2 className="text-[15px] font-semibold tracking-tight">{p.name.en}</h2>
                        <p className="text-[13px] text-muted">{itemsText(p.items)}</p>
                      </div>
                      {!p.active && <Badge>Paused</Badge>}
                    </div>
                    <p className="mt-5 text-2xl font-semibold tracking-tight tabular-nums">
                      {formatAed(p.priceAed)}
                    </p>
                    <p className="mt-1 text-[13px] text-muted">
                      Valid {p.validityDays} days · {soldBy.get(p.id) ?? 0} sold
                    </p>
                    {manage && (
                      <div className="mt-auto flex items-center justify-end gap-1 pt-5">
                        <ActiveToggle slug={slug} kind="package" id={p.id} active={p.active} />
                        <FormSheet
                          title="Edit package"
                          description="Changes apply to new sales; packages already sold keep their terms."
                          action={savePackageAction.bind(null, slug, p.id)}
                          trigger={
                            <Button variant="secondary" size="sm">
                              <Pencil /> Edit
                            </Button>
                          }
                        >
                          {packageForm(p)}
                        </FormSheet>
                      </div>
                    )}
                  </Card>
                </StaggerItem>
              ))}
            </Stagger>
          ))}

        {tab === 'memberships' &&
          (data.plans.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Repeat className="size-5" strokeWidth={1.5} />}
                title="No membership plans yet"
                description="Monthly plans with included sessions and a member discount keep regulars coming back."
              />
            </Card>
          ) : (
            <Stagger className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {data.plans.map((p) => (
                <StaggerItem key={p.id}>
                  <Card className={cn('flex h-full flex-col p-6', !p.active && 'opacity-60')}>
                    <h2 className="text-[15px] font-semibold tracking-tight">{p.name.en}</h2>
                    <p className="mt-1 text-[13px] text-muted">
                      {[
                        p.benefits.includedSessions?.length ? itemsText(p.benefits.includedSessions) : null,
                        p.benefits.discountPct ? `${p.benefits.discountPct}% off extras` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ') || 'No benefits set'}
                    </p>
                    <p className="mt-5 text-2xl font-semibold tracking-tight tabular-nums">
                      {formatAed(p.monthlyAed)}
                      <span className="text-sm font-normal text-muted"> / month</span>
                    </p>
                    <p className="mt-1 text-[13px] text-muted">{membersBy.get(p.id) ?? 0} active members</p>
                    {manage && (
                      <div className="mt-auto flex items-center justify-end gap-1 pt-5">
                        <ActiveToggle slug={slug} kind="membership" id={p.id} active={p.active} />
                        <FormSheet
                          title="Edit plan"
                          action={saveMembershipAction.bind(null, slug, p.id)}
                          trigger={
                            <Button variant="secondary" size="sm">
                              <Pencil /> Edit
                            </Button>
                          }
                        >
                          {planForm(p)}
                        </FormSheet>
                      </div>
                    )}
                  </Card>
                </StaggerItem>
              ))}
            </Stagger>
          ))}

        {tab === 'gift-cards' && (
          <Card className="py-2">
            <DataTable
              columns={cardCols}
              rows={data.cards}
              rowKey={(c) => c.id}
              empty={
                <EmptyState
                  icon={<Gift className="size-5" strokeWidth={1.5} />}
                  title="No gift cards sold yet"
                  description="Sell a gift card from Sales; it gets a code the recipient can redeem at checkout."
                />
              }
            />
          </Card>
        )}

        {tab === 'promos' && (
          <Card className="py-2">
            <DataTable
              columns={promoCols}
              rows={data.promos}
              rowKey={(p) => p.id}
              empty={
                <EmptyState
                  icon={<TicketPercent className="size-5" strokeWidth={1.5} />}
                  title="No promo codes yet"
                  description="Create codes for Instagram offers, Ramadan or corporate partners."
                />
              }
            />
          </Card>
        )}
      </PageBody>
    </>
  )
}
