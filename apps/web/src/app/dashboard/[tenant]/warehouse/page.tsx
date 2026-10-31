import { enumLabel } from '@spa/core/i18n'
import { branches, products, stockLevels, stockMovements, withTenant } from '@spa/db'
import { asc, desc, eq, isNull, or } from 'drizzle-orm'
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Warehouse } from 'lucide-react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Card, Grid, ListRow, Pill, Stack, Stat } from '@/components/crm'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/form'
import { FormSheet } from '@/components/ui/form-sheet'
import { Input, Select } from '@/components/ui/input'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { getI18n, getT } from '@/i18n/server'
import { can, requireMember } from '@/server/access'
import { countWarehouseAction, setWarehouseLowAction, transferStockAction } from './actions'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('warehouse.title') }
}

/** Central warehouse stock (R9): stock per location, transfers to/from branches, counts, low-stock per location. */
export default async function WarehousePage({ params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'inventory.manage')) notFound()
  const { t, fmt } = await getI18n()
  const slug = ctx.tenant.slug
  const data = await withTenant(ctx.tenant.id, async (tx) => ({
    products: await tx
      .select()
      .from(products)
      .where(eq(products.active, true))
      .orderBy(asc(products.kind), asc(products.createdAt)),
    levels: await tx.select().from(stockLevels),
    branches: await tx
      .select({ id: branches.id, name: branches.name })
      .from(branches)
      .orderBy(desc(branches.isDefault), asc(branches.name)),
    moves: await tx
      .select({ m: stockMovements, name: products.name, unit: products.unit })
      .from(stockMovements)
      .innerJoin(products, eq(products.id, stockMovements.productId))
      .where(or(isNull(stockMovements.branchId), eq(stockMovements.refType, 'transfer')))
      .orderBy(desc(stockMovements.createdAt))
      .limit(20),
  }))
  const branchName = new Map(data.branches.map((b) => [b.id, b.name]))
  const where = (id: string | null) => (id ? (branchName.get(id) ?? '—') : t('warehouse.location.warehouse'))
  const rows = data.products.map((p) => {
    const mine = data.levels.filter((l) => l.productId === p.id)
    const wh = mine.find((l) => l.branchId === null)
    const lowAt = wh?.lowStockAt ?? p.lowStockAt
    const qty = Number(wh?.qty ?? 0)
    return {
      p,
      qty,
      ownLow: wh?.lowStockAt ?? null,
      lowAt: lowAt == null ? null : Number(lowAt),
      inBranches: mine
        .filter((l) => l.branchId !== null)
        .map((l) => ({ id: l.branchId!, qty: Number(l.qty) })),
    }
  })
  type Row = (typeof rows)[number]
  const isLow = (r: Row) => r.lowAt != null && r.qty <= r.lowAt
  const low = rows.filter(isLow)
  const value = rows.reduce((s, r) => s + Math.max(0, r.qty) * Number(r.p.costAed), 0)
  const qty = (n: number, unit?: string | null) =>
    t('inventory.qty', { qty: fmt.number(n), unit: unit ?? '' }).trim()

  const rowActions = (r: Row) => (
    <div className="flex flex-wrap justify-end gap-1">
      <FormSheet
        title={t('warehouse.transfer.title', { name: r.p.name.en })}
        description={t('warehouse.transfer.body')}
        action={transferStockAction.bind(null, slug, r.p.id)}
        submitLabel={t('warehouse.transfer.submit')}
        trigger={
          <Button variant="secondary" size="sm" disabled={!data.branches.length}>
            <ArrowLeftRight /> {t('warehouse.transfer.button')}
          </Button>
        }
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={t('warehouse.transfer.direction')} name="direction">
            <Select id="direction" name="direction" defaultValue="out">
              <option value="out">{t('warehouse.transfer.out')}</option>
              <option value="in">{t('warehouse.transfer.in')}</option>
            </Select>
          </Field>
          <Field label={t('warehouse.transfer.branch')} name="branchId">
            <Select id="branchId" name="branchId" defaultValue={data.branches[0]?.id}>
              {data.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={t('warehouse.transfer.qty', { unit: r.p.unit })}
            name="qty"
            hint={t('warehouse.transfer.onHand', { qty: qty(r.qty, r.p.unit) })}
          >
            <Input id="qty" name="qty" inputMode="decimal" />
          </Field>
          <Field label={t('warehouse.transfer.note')} name="note">
            <Input id="note" name="note" placeholder={t('common.optional')} />
          </Field>
        </div>
      </FormSheet>
      <FormSheet
        title={t('warehouse.count.title', { name: r.p.name.en })}
        description={t('warehouse.count.body')}
        action={countWarehouseAction.bind(null, slug, r.p.id)}
        submitLabel={t('inventory.count.submit')}
        trigger={
          <Button variant="ghost" size="sm">
            {t('inventory.count.button')}
          </Button>
        }
      >
        <Field
          label={t('inventory.count.counted', { unit: r.p.unit })}
          name="counted"
          hint={t('inventory.count.systemSays', { qty: fmt.number(r.qty), unit: r.p.unit })}
        >
          <Input id="counted" name="counted" inputMode="decimal" defaultValue={r.qty} />
        </Field>
        <Field label={t('inventory.count.reason')} name="note">
          <Input id="note" name="note" placeholder={t('inventory.count.reasonPlaceholder')} />
        </Field>
      </FormSheet>
      <FormSheet
        title={t('warehouse.low.title', { name: r.p.name.en })}
        description={t('warehouse.low.body')}
        action={setWarehouseLowAction.bind(null, slug, r.p.id)}
        trigger={
          <Button variant="ghost" size="sm">
            {t('warehouse.low.button')}
          </Button>
        }
      >
        <Field
          label={t('warehouse.low.label', { unit: r.p.unit })}
          name="lowStockAt"
          hint={
            r.p.lowStockAt != null
              ? t('warehouse.low.productDefault', { qty: qty(Number(r.p.lowStockAt), r.p.unit) })
              : t('warehouse.low.none')
          }
        >
          <Input id="lowStockAt" name="lowStockAt" inputMode="decimal" defaultValue={r.ownLow ?? ''} />
        </Field>
      </FormSheet>
    </div>
  )

  return (
    <>
      <PageHeader title={t('warehouse.title')} description={t('warehouse.description')} />
      <PageBody>
        <Stack>
          <Grid cols="g3">
            <Stat
              label={t('warehouse.stat.stocked')}
              value={fmt.number(rows.filter((r) => r.qty > 0).length)}
            />
            <Stat
              label={t('warehouse.stat.low')}
              value={fmt.number(low.length)}
              change={{
                text:
                  low
                    .map((l) => l.p.name.en)
                    .slice(0, 2)
                    .join(', ') || t('inventory.stat.allGood'),
                dir: low.length ? 'down' : 'up',
              }}
            />
            <Stat
              label={t('warehouse.stat.value')}
              value={fmt.aed(Math.round(value))}
              change={{ text: t('inventory.stat.atCost'), dir: 'flat' }}
            />
          </Grid>
          <Card flush>
            {rows.length === 0 ? (
              <EmptyState
                icon={<Warehouse className="size-5" strokeWidth={1.5} />}
                title={t('warehouse.empty.title')}
                description={t('warehouse.empty.body')}
              />
            ) : (
              <div className="crm-tbl-wrap p-[var(--crm-pad-card)] pb-2">
                <table className="crm-tbl" data-stack="true">
                  <thead>
                    <tr>
                      <th>{t('inventory.col.product')}</th>
                      <th>{t('warehouse.col.warehouse')}</th>
                      <th>{t('warehouse.col.branches')}</th>
                      <th className="crm-num-c">{t('inventory.col.cost')}</th>
                      <th>
                        <span className="sr-only">{t('common.edit')}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.p.id}>
                        <td data-label={t('inventory.col.product')}>
                          <span className="flex flex-col">
                            <span className="font-semibold">{r.p.name.en}</span>
                            <span className="crm-muted text-xs">
                              {[enumLabel(t, 'productKind', r.p.kind), r.p.sku].filter(Boolean).join(' · ')}
                            </span>
                          </span>
                        </td>
                        <td data-label={t('warehouse.col.warehouse')} className="crm-num">
                          <span className="inline-flex items-center gap-2">
                            {qty(r.qty, r.p.unit)}
                            {isLow(r) && (
                              <Pill tone="bad" dot>
                                {t('inventory.low')}
                              </Pill>
                            )}
                          </span>
                        </td>
                        <td data-label={t('warehouse.col.branches')} className="text-sm">
                          {r.inBranches.length === 0 ? (
                            <span className="crm-muted">—</span>
                          ) : (
                            <span className="flex flex-col">
                              {r.inBranches.map((b) => (
                                <span key={b.id}>
                                  {branchName.get(b.id) ?? '—'}:{' '}
                                  <span className="crm-num">{qty(b.qty, r.p.unit)}</span>
                                </span>
                              ))}
                            </span>
                          )}
                        </td>
                        <td data-label={t('inventory.col.cost')} className="crm-num-c">
                          {fmt.aed(r.p.costAed)}
                        </td>
                        <td className="text-end">{rowActions(r)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <Card title={t('warehouse.moves.title')} sub={t('warehouse.moves.sub')}>
            {data.moves.length === 0 ? (
              <p className="crm-muted text-sm">{t('warehouse.moves.empty')}</p>
            ) : (
              data.moves.map(({ m, name, unit }) => {
                const n = Number(m.qty)
                return (
                  <ListRow
                    key={m.id}
                    icon={n < 0 ? <ArrowUpRight /> : <ArrowDownLeft />}
                    title={name.en}
                    body={`${enumLabel(t, 'stockMovementKind', m.kind)} · ${where(m.branchId)}`}
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
        </Stack>
      </PageBody>
    </>
  )
}
