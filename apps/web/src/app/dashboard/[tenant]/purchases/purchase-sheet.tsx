'use client'
import { enumLabel } from '@spa/core/i18n'
import { Plus, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { Input, Select, Textarea } from '@/components/ui/input'
import { Sheet } from '@/components/ui/sheet'
import { useI18n } from '@/i18n/client'
import type { ActionResult } from '@/lib/action'
import { ReceiptScanBox, useReceiptScan } from '../accounts/expenses/receipt-scan'

const CATEGORIES = ['materials', 'cleaning', 'consumables', 'equipment', 'other'] as const
const PAID_VIA = ['cash', 'card', 'bank'] as const

type Product = { id: string; name: string; unit: string; costAed: number }
type Line = { key: number; productId: string; description: string; qty: string; unitCost: string }

let nextKey = 1
const blank = (): Line => ({ key: nextKey++, productId: '', description: '', qty: '1', unitCost: '' })
const num = (v: string) => {
  const n = Number(v.replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}
const fils = (n: number) => Math.round(n * 100)

/** "Record purchase" sheet: receipt scan, supplier, lines (stock product or free text), VAT and how it was paid. */
export function PurchaseSheet({
  action,
  scanUrl,
  today,
  aiReady,
  products,
  suppliers,
  locations,
  defaultLocation,
}: {
  action: (prev: ActionResult, fd: FormData) => Promise<ActionResult>
  scanUrl: string
  today: string
  aiReady: boolean
  products: Product[]
  suppliers: string[]
  locations: { value: string; label: string }[]
  defaultLocation: string
}) {
  const { t, fmt } = useI18n()
  const [open, setOpen] = useState(false)
  const receipt = useReceiptScan(scanUrl)
  const { scan, setScan, version } = receipt
  const f = scan?.fields
  const [lines, setLines] = useState<Line[]>(() => [blank()])
  const [vat, setVat] = useState('')
  const [readVersion, setReadVersion] = useState(0)

  // A read receipt prefills VAT and, if nothing is typed yet, one line for the net amount.
  if (f && version !== readVersion) {
    setReadVersion(version)
    if (f.vatAed != null) setVat(f.vatAed.toFixed(2))
    const empty = lines.every((l) => !l.productId && !l.description && !l.unitCost)
    if (empty && f.totalAed != null) {
      const net = Math.max(0, f.totalAed - (f.vatAed ?? 0))
      setLines([{ ...blank(), description: f.vendor ?? '', unitCost: net.toFixed(2) }])
    }
  }

  const productById = new Map(products.map((p) => [p.id, p]))
  const subtotalFils = lines.reduce((s, l) => s + fils(num(l.qty) * num(l.unitCost)), 0)
  const vatFils = fils(num(vat))
  const update = (key: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const reset = () => {
    setScan(null)
    setLines([blank()])
    setVat('')
  }
  const payload = JSON.stringify(
    lines
      .filter((l) => l.productId || l.description.trim() || l.unitCost)
      .map((l) => ({
        productId: l.productId || null,
        description: l.description.trim() || null,
        qty: num(l.qty),
        unitCostAed: num(l.unitCost),
      })),
  )

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
      title={t('purchases.sheet.title')}
      description={t('purchases.sheet.description')}
      trigger={
        <Button>
          <Plus /> {t('purchases.sheet.trigger')}
        </Button>
      }
    >
      <ActionForm
        action={action}
        onSuccess={() => {
          setOpen(false)
          reset()
        }}
        className="space-y-5"
      >
        <ReceiptScanBox state={receipt} aiReady={aiReady} />
        <input type="hidden" name="lines" value={payload} />

        <div key={version} className="grid gap-5 sm:grid-cols-2">
          <Field label={t('purchases.sheet.date')} name="purchaseDate">
            <Input
              id="purchaseDate"
              name="purchaseDate"
              type="date"
              max={today}
              defaultValue={f?.date ?? today}
            />
          </Field>
          <Field label={t('purchases.sheet.supplier')} name="supplier">
            <Input
              id="supplier"
              name="supplier"
              list="purchase-suppliers"
              autoComplete="off"
              placeholder={t('purchases.sheet.supplierPh')}
              defaultValue={f?.vendor ?? undefined}
            />
          </Field>
          <datalist id="purchase-suppliers">
            {suppliers.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <Field label={t('purchases.sheet.category')} name="category">
            <Select id="category" name="category" defaultValue="materials">
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {enumLabel(t, 'purchaseCategory', c)}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={t('purchases.sheet.location')}
            name="location"
            hint={t('purchases.sheet.locationHint')}
          >
            <Select id="location" name="location" defaultValue={defaultLocation}>
              {locations.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <fieldset className="space-y-3">
          <legend className="mb-2 text-sm font-medium">{t('purchases.sheet.items')}</legend>
          {lines.map((l, i) => {
            const p = l.productId ? productById.get(l.productId) : undefined
            return (
              <div key={l.key} className="grid grid-cols-12 items-end gap-2 rounded-lg border p-3">
                <div className="col-span-12 sm:col-span-5">
                  <Select
                    aria-label={t('purchases.sheet.product', { n: i + 1 })}
                    value={l.productId}
                    onChange={(e) => {
                      const next = productById.get(e.target.value)
                      update(l.key, {
                        productId: e.target.value,
                        unitCost: next && !l.unitCost ? next.costAed.toFixed(2) : l.unitCost,
                      })
                    }}
                  >
                    <option value="">{t('purchases.sheet.notStock')}</option>
                    {products.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name} ({x.unit})
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="col-span-12 sm:col-span-7">
                  <Input
                    aria-label={t('purchases.sheet.lineDescription', { n: i + 1 })}
                    placeholder={p ? p.name : t('purchases.sheet.descriptionPh')}
                    value={l.description}
                    maxLength={120}
                    onChange={(e) => update(l.key, { description: e.target.value })}
                  />
                </div>
                <div className="col-span-4">
                  <Input
                    aria-label={t('purchases.sheet.qty', { unit: p?.unit ?? '' })}
                    inputMode="decimal"
                    value={l.qty}
                    onChange={(e) => update(l.key, { qty: e.target.value })}
                  />
                </div>
                <div className="col-span-5">
                  <Input
                    aria-label={t('purchases.sheet.unitCost')}
                    inputMode="decimal"
                    placeholder={t('purchases.sheet.unitCost')}
                    value={l.unitCost}
                    onChange={(e) => update(l.key, { unitCost: e.target.value })}
                  />
                </div>
                <div className="col-span-3 flex items-center justify-end gap-1">
                  <span className="crm-num text-sm">{fmt.aed(fils(num(l.qty) * num(l.unitCost)) / 100)}</span>
                  {lines.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t('purchases.sheet.removeLine', { n: i + 1 })}
                      onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                    >
                      <X />
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={lines.length >= 50}
            onClick={() => setLines((ls) => [...ls, blank()])}
          >
            <Plus /> {t('purchases.sheet.addLine')}
          </Button>
          <p className="crm-muted text-[13px]">{t('purchases.sheet.netHint')}</p>
        </fieldset>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={t('purchases.sheet.vat')} name="vatAed">
            <div className="flex gap-2">
              <Input
                id="vatAed"
                name="vatAed"
                inputMode="decimal"
                placeholder="0.00"
                value={vat}
                onChange={(e) => setVat(e.target.value)}
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => setVat((Math.round(subtotalFils * 0.05) / 100).toFixed(2))}
              >
                {t('purchases.sheet.vat5')}
              </Button>
            </div>
          </Field>
          <Field label={t('purchases.sheet.paidWith')} name="paidVia">
            <Select id="paidVia" name="paidVia" defaultValue="cash">
              {PAID_VIA.map((k) => (
                <option key={k} value={k}>
                  {enumLabel(t, 'expensePaidVia', k)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <dl className="space-y-1 rounded-lg bg-subtle/50 p-3 text-sm">
          <div className="flex justify-between">
            <dt>{t('purchases.sheet.subtotal')}</dt>
            <dd className="crm-num">{fmt.aed(subtotalFils / 100)}</dd>
          </div>
          <div className="crm-muted flex justify-between">
            <dt>{t('purchases.sheet.vatShort')}</dt>
            <dd className="crm-num">{fmt.aed(vatFils / 100)}</dd>
          </div>
          <div className="flex justify-between border-t pt-1 font-semibold">
            <dt>{t('purchases.sheet.total')}</dt>
            <dd className="crm-num">{fmt.aed((subtotalFils + vatFils) / 100)}</dd>
          </div>
        </dl>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={t('purchases.sheet.reference')} name="reference">
            <Input id="reference" name="reference" placeholder={t('common.optional')} maxLength={60} />
          </Field>
          <Field label={t('purchases.sheet.notes')} name="notes">
            <Textarea id="notes" name="notes" rows={2} placeholder={t('common.optional')} maxLength={500} />
          </Field>
        </div>
        <SubmitButton className="w-full sm:w-auto">{t('purchases.sheet.submit')}</SubmitButton>
      </ActionForm>
    </Sheet>
  )
}
