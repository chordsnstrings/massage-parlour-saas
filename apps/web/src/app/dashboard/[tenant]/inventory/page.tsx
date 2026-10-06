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
import { Boxes, PackagePlus, Pencil, Plus, X } from 'lucide-react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Field } from '@/components/ui/form'
import { FormSheet } from '@/components/ui/form-sheet'
import { Checkbox, Input, Label, Select } from '@/components/ui/input'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { StatCard } from '@/components/ui/stat-card'
import { type Column, DataTable } from '@/components/ui/table'
import { cn, formatAed, formatDateTime, todayDubai } from '@/lib/utils'
import { can, requireMember } from '@/server/access'
import {
  adjustStockAction,
  receiveStockAction,
  removeUsageAction,
  saveProductAction,
  saveUsageAction,
} from './actions'

export const metadata: Metadata = { title: 'Inventory' }

const MOVE_LABEL = {
  purchase: 'Received',
  sale: 'Sold',
  consumption: 'Used in treatment',
  adjustment: 'Count adjustment',
  transfer_in: 'Transfer in',
  transfer_out: 'Transfer out',
} as const
const qtyText = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, ''))

export default async function InventoryPage({ params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'inventory.manage')) notFound()
  const slug = ctx.tenant.slug
  const data = await withTenant(ctx.tenant.id, async (tx) => {
    const [branch] = await tx.select().from(branches).where(eq(branches.isDefault, true)).limit(1)
    return {
      products: await tx
        .select({ p: products, qty: stockLevels.qty })
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
  const rows = data.products.map((r) => ({ ...r.p, qty: Number(r.qty ?? 0) }))
  const low = rows.filter((r) => r.lowStockAt != null && r.qty <= Number(r.lowStockAt))
  const stockValue = rows.reduce((s, r) => s + Math.max(0, r.qty) * Number(r.costAed), 0)
  const variantName = new Map(data.variants.map((v) => [v.id, `${v.name.en} · ${v.durationMin} min`]))
  const productById = new Map(rows.map((r) => [r.id, r]))
  type Row = (typeof rows)[number]

  const productForm = (p?: Row) => (
    <>
      <Field label="Type" name="kind">
        <Select id="kind" name="kind" defaultValue={p?.kind ?? 'consumable'}>
          <option value="consumable">Consumable (oils, towels, linen)</option>
          <option value="retail">Retail (sold to clients)</option>
        </Select>
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Name" name="nameEn">
          <Input id="nameEn" name="nameEn" defaultValue={p?.name.en} placeholder="Sweet almond oil" />
        </Field>
        <Field label="Name (Arabic)" name="nameAr">
          <Input id="nameAr" name="nameAr" dir="rtl" defaultValue={p?.name.ar} />
        </Field>
        <Field label="Unit" name="unit" hint="ml, pcs, bottle…">
          <Input id="unit" name="unit" defaultValue={p?.unit ?? 'ml'} />
        </Field>
        <Field label="SKU / barcode" name="sku">
          <Input id="sku" name="sku" defaultValue={p?.sku ?? ''} />
        </Field>
        <Field label="Cost per unit (AED, excl. VAT)" name="costAed">
          <Input id="costAed" name="costAed" inputMode="decimal" defaultValue={p ? Number(p.costAed) : ''} />
        </Field>
        <Field label="Selling price (AED, retail only)" name="priceAed">
          <Input
            id="priceAed"
            name="priceAed"
            inputMode="decimal"
            defaultValue={p?.priceAed ? Number(p.priceAed) : ''}
          />
        </Field>
      </div>
      <Field label="Warn me when stock falls to" name="lowStockAt">
        <Input id="lowStockAt" name="lowStockAt" inputMode="decimal" defaultValue={p?.lowStockAt ?? ''} />
      </Field>
    </>
  )

  const columns: Column<Row>[] = [
    {
      key: 'name',
      header: 'Product',
      primary: true,
      cell: (r) => (
        <span className="flex flex-col">
          <span className="font-medium">{r.name.en}</span>
          <span className="text-xs text-muted">
            {[r.kind === 'retail' ? 'Retail' : 'Consumable', r.sku].filter(Boolean).join(' · ')}
          </span>
        </span>
      ),
    },
    {
      key: 'stock',
      header: 'In stock',
      className: 'tabular-nums',
      cell: (r) => {
        const isLow = r.lowStockAt != null && r.qty <= Number(r.lowStockAt)
        return (
          <span className={cn('inline-flex items-center gap-2', isLow && 'text-danger')}>
            {qtyText(r.qty)} {r.unit}
            {isLow && <Badge tone="danger">Low</Badge>}
          </span>
        )
      },
    },
    { key: 'cost', header: 'Cost', className: 'text-right tabular-nums', cell: (r) => formatAed(r.costAed) },
    {
      key: 'price',
      header: 'Price',
      className: 'text-right tabular-nums',
      cell: (r) => (r.priceAed ? formatAed(r.priceAed) : '—'),
    },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      cell: (r) => (
        <div className="flex justify-end gap-1">
          <FormSheet
            title={`Receive · ${r.name.en}`}
            description="Records the purchase in your accounts and adds to stock."
            action={receiveStockAction.bind(null, slug, r.id)}
            submitLabel="Receive stock"
            trigger={
              <Button variant="secondary" size="sm">
                <PackagePlus /> Receive
              </Button>
            }
          >
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label={`Quantity (${r.unit})`} name="qty">
                <Input id="qty" name="qty" inputMode="decimal" />
              </Field>
              <Field label="Total paid (AED)" name="totalAed">
                <Input id="totalAed" name="totalAed" inputMode="decimal" />
              </Field>
              <Field label="Date" name="date">
                <Input id="date" name="date" type="date" defaultValue={todayDubai()} />
              </Field>
              <Field label="Paid from" name="paidVia">
                <Select id="paidVia" name="paidVia" defaultValue="cash">
                  <option value="cash">Cash</option>
                  <option value="bank">Bank</option>
                </Select>
              </Field>
            </div>
            <Label className="flex items-center gap-2.5 text-sm font-normal">
              <Checkbox name="hasVat" defaultChecked /> Includes 5% VAT (on a tax invoice)
            </Label>
          </FormSheet>
          <FormSheet
            title={`Count · ${r.name.en}`}
            description="Enter what's actually on the shelf; the difference is posted as an adjustment at cost."
            action={adjustStockAction.bind(null, slug, r.id)}
            submitLabel="Save count"
            trigger={
              <Button variant="ghost" size="sm">
                Count
              </Button>
            }
          >
            <input type="hidden" name="current" value={r.qty} />
            <Field
              label={`Counted (${r.unit})`}
              name="counted"
              hint={`System says ${qtyText(r.qty)} ${r.unit}.`}
            >
              <Input id="counted" name="counted" inputMode="decimal" defaultValue={r.qty} />
            </Field>
            <Field label="Reason" name="note">
              <Input id="note" name="note" placeholder="Monthly count, damaged, expired…" />
            </Field>
          </FormSheet>
          <FormSheet
            title="Edit product"
            action={saveProductAction.bind(null, slug, r.id)}
            trigger={
              <Button variant="ghost" size="sm" aria-label={`Edit ${r.name.en}`}>
                <Pencil />
              </Button>
            }
          >
            {productForm(r)}
          </FormSheet>
        </div>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Inventory"
        description="Oils, linen and retail products. Treatments use up consumables automatically; purchases and counts flow into your accounts."
        actions={
          <FormSheet
            title="Add product"
            action={saveProductAction.bind(null, slug, null)}
            submitLabel="Add product"
            trigger={
              <Button>
                <Plus /> Add product
              </Button>
            }
          >
            {productForm()}
          </FormSheet>
        }
      />
      <PageBody>
        <div className="grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-3">
          <StatCard label="Products" value={rows.length} format="int" />
          <StatCard
            label="Running low"
            value={low.length}
            format="int"
            hint={
              low
                .map((l) => l.name.en)
                .slice(0, 2)
                .join(', ') || 'All good'
            }
          />
          <StatCard label="Stock value" value={Math.round(stockValue)} format="aed" hint="at cost" />
        </div>

        <Card className="py-2">
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            empty={
              <EmptyState
                icon={<Boxes className="size-5" strokeWidth={1.5} />}
                title="No products yet"
                description="Add massage oils, towels and anything you sell to clients."
              />
            }
          />
        </Card>

        <div className="grid gap-6 lg:grid-cols-12">
          <Card className="lg:col-span-7">
            <CardHeader
              title="Used per treatment"
              description="Deducted from stock when a booking is completed."
              action={
                <FormSheet
                  title="Add usage"
                  action={saveUsageAction.bind(null, slug)}
                  trigger={
                    <Button variant="secondary" size="sm" disabled={!data.variants.length || !rows.length}>
                      <Plus /> Add
                    </Button>
                  }
                >
                  <Field label="Treatment" name="serviceVariantId">
                    <Select id="serviceVariantId" name="serviceVariantId" defaultValue="">
                      <option value="" disabled>
                        Choose…
                      </option>
                      {data.variants.map((v) => (
                        <option key={v.id} value={v.id}>
                          {variantName.get(v.id)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Product" name="productId">
                    <Select id="productId" name="productId" defaultValue="">
                      <option value="" disabled>
                        Choose…
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
                  <Field label="Amount per treatment" name="qty">
                    <Input id="qty" name="qty" inputMode="decimal" placeholder="30" />
                  </Field>
                </FormSheet>
              }
            />
            <CardBody className="pt-3">
              {data.usage.length === 0 ? (
                <p className="text-sm text-muted">e.g. 60 min Swedish uses 30 ml oil and 2 towels.</p>
              ) : (
                <div className="divide-y">
                  {data.usage.map((u) => {
                    const p = productById.get(u.productId)
                    return (
                      <div
                        key={`${u.serviceVariantId}-${u.productId}`}
                        className="flex items-center justify-between gap-3 py-2 text-sm"
                      >
                        <span className="min-w-0 truncate">
                          {variantName.get(u.serviceVariantId) ?? 'Treatment'}
                        </span>
                        <span className="flex shrink-0 items-center gap-2 text-muted">
                          {qtyText(Number(u.qty))} {p?.unit} {p?.name.en}
                          <form action={removeUsageAction.bind(null, slug, u.serviceVariantId, u.productId)}>
                            <Button variant="ghost" size="sm" type="submit" aria-label="Remove">
                              <X />
                            </Button>
                          </form>
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardBody>
          </Card>
          <Card className="lg:col-span-5">
            <CardHeader title="Recent movements" />
            <CardBody className="pt-3">
              {data.moves.length === 0 ? (
                <p className="text-sm text-muted">Nothing yet.</p>
              ) : (
                <div className="divide-y">
                  {data.moves.map(({ m, name, unit }) => (
                    <div key={m.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className="min-w-0">
                        <span className="block truncate">{name.en}</span>
                        <span className="text-xs text-muted">
                          {MOVE_LABEL[m.kind]} · {formatDateTime(m.createdAt)}
                        </span>
                      </span>
                      <span
                        className={cn(
                          'shrink-0 tabular-nums',
                          Number(m.qty) < 0 ? 'text-muted' : 'text-success',
                        )}
                      >
                        {Number(m.qty) > 0 ? '+' : ''}
                        {qtyText(Number(m.qty))} {unit}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      </PageBody>
    </>
  )
}
