import { enumLabel } from '@spa/core/i18n'
import {
  branches,
  products,
  serviceConsumables,
  services,
  serviceVariants,
  stockLevels,
  stockMovements,
  withTenant,
} from '@spa/db'
import { and, asc, desc, eq } from 'drizzle-orm'
import { ArrowDownLeft, ArrowUpRight, Boxes, PackagePlus, Pencil, Plus, X } from 'lucide-react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Card, Grid, ListRow, Pill, Stack, Stat } from '@/components/crm'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/form'
import { FormSheet } from '@/components/ui/form-sheet'
import { Checkbox, Input, Label, Select } from '@/components/ui/input'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { getI18n, getT } from '@/i18n/server'
import { todayDubai } from '@/lib/utils'
import { can, requireMember } from '@/server/access'
import {
  adjustStockAction,
  receiveStockAction,
  removeUsageAction,
  saveProductAction,
  saveUsageAction,
} from './actions'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('inventory.title') }
}

export default async function InventoryPage({ params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await requireMember((await params).tenant)
  // Restock + counts: `inventory.adjust` (manager, accountant, receptionist); products and usage: `inventory.manage`.
  const manage = can(ctx, 'inventory.manage')
  if (!manage && !can(ctx, 'inventory.adjust')) notFound()
  const { t, fmt } = await getI18n()
  const slug = ctx.tenant.slug
  const data = await withTenant(ctx.tenant.id, async (tx) => {
    const [branch] = await tx.select().from(branches).where(eq(branches.isDefault, true)).limit(1)
    return {
      products: await tx
        .select({ p: products, qty: stockLevels.qty, lowAt: stockLevels.lowStockAt })
        .from(products)
        .leftJoin(
          stockLevels,
          and(eq(stockLevels.productId, products.id), eq(stockLevels.branchId, branch?.id ?? products.id)),
        )
        .where(eq(products.active, true))
        .orderBy(asc(products.kind), asc(products.createdAt)),
      variants: await tx
        .select({ id: serviceVariants.id, durationMin: serviceVariants.durationMin, name: services.name })
        .from(serviceVariants)
        .innerJoin(services, eq(services.id, serviceVariants.serviceId))
        .orderBy(asc(services.sort), asc(serviceVariants.durationMin)),
      usage: await tx.select().from(serviceConsumables),
      moves: await tx
        .select({ m: stockMovements, name: products.name, unit: products.unit })
        .from(stockMovements)
        .innerJoin(products, eq(products.id, stockMovements.productId))
        .orderBy(desc(stockMovements.createdAt))
        .limit(15),
    }
  })
  // A branch's own low-stock level (warehouse screen sets these per location) wins over the product's.
  const rows = data.products.map((r) => ({
    ...r.p,
    lowStockAt: r.lowAt ?? r.p.lowStockAt,
    qty: Number(r.qty ?? 0),
  }))
  const low = rows.filter((r) => r.lowStockAt != null && r.qty <= Number(r.lowStockAt))
  const stockValue = rows.reduce((s, r) => s + Math.max(0, r.qty) * Number(r.costAed), 0)
  const variantName = new Map(
    data.variants.map((v) => [v.id, t('inventory.usage.variant', { name: v.name.en, min: v.durationMin })]),
  )
  const productById = new Map(rows.map((r) => [r.id, r]))
  const qty = (n: number, unit?: string | null) =>
    t('inventory.qty', { qty: fmt.number(n), unit: unit ?? '' }).trim()
  type Row = (typeof rows)[number]

  const productForm = (p?: Row) => (
    <>
      <Field label={t('inventory.form.type')} name="kind">
        <Select id="kind" name="kind" defaultValue={p?.kind ?? 'consumable'}>
          <option value="consumable">{t('inventory.form.consumable')}</option>
          <option value="retail">{t('inventory.form.retail')}</option>
        </Select>
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t('inventory.form.name')} name="nameEn">
          <Input
            id="nameEn"
            name="nameEn"
            defaultValue={p?.name.en}
            placeholder={t('inventory.form.namePlaceholder')}
          />
        </Field>
        <Field label={t('inventory.form.nameAr')} name="nameAr">
          <Input id="nameAr" name="nameAr" dir="rtl" defaultValue={p?.name.ar} />
        </Field>
        <Field label={t('inventory.form.unit')} name="unit" hint={t('inventory.form.unitHint')}>
          <Input id="unit" name="unit" defaultValue={p?.unit ?? 'ml'} />
        </Field>
        <Field label={t('inventory.form.sku')} name="sku">
          <Input id="sku" name="sku" defaultValue={p?.sku ?? ''} />
        </Field>
        <Field label={t('inventory.form.cost')} name="costAed">
          <Input id="costAed" name="costAed" inputMode="decimal" defaultValue={p ? Number(p.costAed) : ''} />
        </Field>
        <Field label={t('inventory.form.price')} name="priceAed">
          <Input
            id="priceAed"
            name="priceAed"
            inputMode="decimal"
            defaultValue={p?.priceAed ? Number(p.priceAed) : ''}
          />
        </Field>
      </div>
      <Field label={t('inventory.form.lowAt')} name="lowStockAt">
        <Input id="lowStockAt" name="lowStockAt" inputMode="decimal" defaultValue={p?.lowStockAt ?? ''} />
      </Field>
    </>
  )

  const rowActions = (r: Row) => (
    <div className="flex justify-end gap-1">
      <FormSheet
        title={t('inventory.receive.title', { name: r.name.en })}
        description={t('inventory.receive.body')}
        action={receiveStockAction.bind(null, slug, r.id)}
        submitLabel={t('inventory.receive.submit')}
        trigger={
          <Button variant="secondary" size="sm">
            <PackagePlus /> {t('inventory.receive.button')}
          </Button>
        }
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={t('inventory.receive.qty', { unit: r.unit })} name="qty">
            <Input id="qty" name="qty" inputMode="decimal" />
          </Field>
          <Field label={t('inventory.receive.total')} name="totalAed">
            <Input id="totalAed" name="totalAed" inputMode="decimal" />
          </Field>
          <Field label={t('inventory.receive.date')} name="date">
            <Input id="date" name="date" type="date" defaultValue={todayDubai()} />
          </Field>
          <Field label={t('inventory.receive.paidFrom')} name="paidVia">
            <Select id="paidVia" name="paidVia" defaultValue="cash">
              <option value="cash">{t('inventory.receive.cash')}</option>
              <option value="bank">{t('inventory.receive.bank')}</option>
            </Select>
          </Field>
        </div>
        <Label className="flex items-center gap-2.5 text-sm font-normal">
          <Checkbox name="hasVat" defaultChecked /> {t('inventory.receive.vat')}
        </Label>
      </FormSheet>
      <FormSheet
        title={t('inventory.count.title', { name: r.name.en })}
        description={t('inventory.count.body')}
        action={adjustStockAction.bind(null, slug, r.id)}
        submitLabel={t('inventory.count.submit')}
        trigger={
          <Button variant="ghost" size="sm">
            {t('inventory.count.button')}
          </Button>
        }
      >
        <input type="hidden" name="current" value={r.qty} />
        <Field
          label={t('inventory.count.counted', { unit: r.unit })}
          name="counted"
          hint={t('inventory.count.systemSays', { qty: fmt.number(r.qty), unit: r.unit })}
        >
          <Input id="counted" name="counted" inputMode="decimal" defaultValue={r.qty} />
        </Field>
        <Field label={t('inventory.count.reason')} name="note">
          <Input id="note" name="note" placeholder={t('inventory.count.reasonPlaceholder')} />
        </Field>
      </FormSheet>
      {manage && (
        <FormSheet
          title={t('inventory.editProduct')}
          action={saveProductAction.bind(null, slug, r.id)}
          trigger={
            <Button variant="ghost" size="sm" aria-label={t('inventory.editAria', { name: r.name.en })}>
              <Pencil />
            </Button>
          }
        >
          {productForm(r)}
        </FormSheet>
      )}
    </div>
  )

  return (
    <>
      <PageHeader
        title={t('inventory.title')}
        description={t('inventory.description')}
        actions={
          manage && (
            <FormSheet
              title={t('inventory.addProduct')}
              action={saveProductAction.bind(null, slug, null)}
              submitLabel={t('inventory.addProduct')}
              trigger={
                <Button>
                  <Plus /> {t('inventory.addProduct')}
                </Button>
              }
            >
              {productForm()}
            </FormSheet>
          )
        }
      />
      <PageBody>
        <Stack>
          <Grid cols="g3">
            <Stat label={t('inventory.stat.products')} value={fmt.number(rows.length)} />
            <Stat
              label={t('inventory.stat.low')}
              value={fmt.number(low.length)}
              change={{
                text:
                  low
                    .map((l) => l.name.en)
                    .slice(0, 2)
                    .join(', ') || t('inventory.stat.allGood'),
                dir: low.length ? 'down' : 'up',
              }}
            />
            <Stat
              label={t('inventory.stat.value')}
              value={fmt.aed(Math.round(stockValue))}
              change={{ text: t('inventory.stat.atCost'), dir: 'flat' }}
            />
          </Grid>

          <Card flush>
            {rows.length === 0 ? (
              <EmptyState
                icon={<Boxes className="size-5" strokeWidth={1.5} />}
                title={t('inventory.empty.title')}
                description={t('inventory.empty.body')}
              />
            ) : (
              <div className="crm-tbl-wrap p-[var(--crm-pad-card)] pb-2">
                <table className="crm-tbl" data-stack="true">
                  <thead>
                    <tr>
                      <th>{t('inventory.col.product')}</th>
                      <th>{t('inventory.col.stock')}</th>
                      <th className="crm-num-c">{t('inventory.col.cost')}</th>
                      <th className="crm-num-c">{t('inventory.col.price')}</th>
                      <th>
                        <span className="sr-only">{t('common.edit')}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const isLow = r.lowStockAt != null && r.qty <= Number(r.lowStockAt)
                      return (
                        <tr key={r.id}>
                          <td data-label={t('inventory.col.product')}>
                            <span className="flex flex-col">
                              <span className="font-semibold">{r.name.en}</span>
                              <span className="crm-muted text-xs">
                                {[enumLabel(t, 'productKind', r.kind), r.sku].filter(Boolean).join(' · ')}
                              </span>
                            </span>
                          </td>
                          <td data-label={t('inventory.col.stock')} className="crm-num">
                            <span className="inline-flex items-center gap-2">
                              {qty(r.qty, r.unit)}
                              {isLow && (
                                <Pill tone="bad" dot>
                                  {t('inventory.low')}
                                </Pill>
                              )}
                            </span>
                          </td>
                          <td data-label={t('inventory.col.cost')} className="crm-num-c">
                            {fmt.aed(r.costAed)}
                          </td>
                          <td data-label={t('inventory.col.price')} className="crm-num-c">
                            {r.priceAed ? fmt.aed(r.priceAed) : '—'}
                          </td>
                          <td className="text-end">{rowActions(r)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Grid cols="col-2">
            <Card
              title={t('inventory.usage.title')}
              sub={t('inventory.usage.sub')}
              actions={
                manage && (
                  <FormSheet
                    title={t('inventory.usage.add')}
                    action={saveUsageAction.bind(null, slug)}
                    trigger={
                      <Button variant="secondary" size="sm" disabled={!data.variants.length || !rows.length}>
                        <Plus /> {t('inventory.usage.addShort')}
                      </Button>
                    }
                  >
                    <Field label={t('inventory.usage.treatment')} name="serviceVariantId">
                      <Select id="serviceVariantId" name="serviceVariantId" defaultValue="">
                        <option value="" disabled>
                          {t('inventory.usage.choose')}
                        </option>
                        {data.variants.map((v) => (
                          <option key={v.id} value={v.id}>
                            {variantName.get(v.id)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label={t('inventory.usage.product')} name="productId">
                      <Select id="productId" name="productId" defaultValue="">
                        <option value="" disabled>
                          {t('inventory.usage.choose')}
                        </option>
                        {rows
                          .filter((r) => r.kind === 'consumable')
                          .map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name.en} ({r.unit})
                            </option>
                          ))}
                      </Select>
                    </Field>
                    <Field label={t('inventory.usage.amount')} name="qty">
                      <Input id="qty" name="qty" inputMode="decimal" placeholder="30" />
                    </Field>
                  </FormSheet>
                )
              }
            >
              {data.usage.length === 0 ? (
                <p className="crm-muted text-sm">{t('inventory.usage.example')}</p>
              ) : (
                data.usage.map((u) => {
                  const p = productById.get(u.productId)
                  return (
                    <ListRow
                      key={`${u.serviceVariantId}-${u.productId}`}
                      title={variantName.get(u.serviceVariantId) ?? t('inventory.usage.fallback')}
                      body={t('inventory.usage.line', {
                        qty: fmt.number(Number(u.qty)),
                        unit: p?.unit ?? '',
                        name: p?.name.en ?? '',
                      })}
                      end={
                        manage && (
                          <form action={removeUsageAction.bind(null, slug, u.serviceVariantId, u.productId)}>
                            <Button
                              variant="ghost"
                              size="sm"
                              type="submit"
                              aria-label={t('inventory.usage.remove')}
                            >
                              <X />
                            </Button>
                          </form>
                        )
                      }
                    />
                  )
                })
              )}
            </Card>
            <Card title={t('inventory.moves.title')}>
              {data.moves.length === 0 ? (
                <p className="crm-muted text-sm">{t('inventory.moves.empty')}</p>
              ) : (
                data.moves.map(({ m, name, unit }) => {
                  const n = Number(m.qty)
                  return (
                    <ListRow
                      key={m.id}
                      icon={n < 0 ? <ArrowUpRight /> : <ArrowDownLeft />}
                      title={name.en}
                      body={enumLabel(t, 'stockMovementKind', m.kind)}
                      time={fmt.dateTime(m.createdAt)}
                      end={
                        <span className={n < 0 ? 'crm-muted crm-num' : 'crm-num text-success'}>
                          {n > 0 ? '+' : ''}
                          {qty(n, unit)}
                        </span>
                      }
                    />
                  )
                })
              )}
            </Card>
          </Grid>
        </Stack>
      </PageBody>
    </>
  )
}
