'use client'
import { enumLabel } from '@spa/core/i18n/labels'
import { Check, Gift, Heart, Loader2, Plus, Search, Trash2, UserPlus, UserRound, X } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useMemo, useState, useTransition } from 'react'
import {
  clientPackagesAction,
  createSaleAction,
  searchPosClientsAction,
} from '@/app/dashboard/[tenant]/sales/actions'
import { Card } from '@/components/crm'
import { Button } from '@/components/ui/button'
import { Checkbox, Input, Label, Select } from '@/components/ui/input'
import { toast } from '@/components/ui/toast'
import { resultText, useI18n } from '@/i18n/client'
import { cn, formatAed } from '@/lib/utils'

export type CheckoutLine = {
  key: string
  kind: 'service' | 'product' | 'package' | 'gift_card' | 'other'
  refId: string | null
  description: string
  qty: number
  unitPriceAed: number | string
  discountAed: number | string
  staffId: string | null
  /** Service covered by a session from this client package (price goes to 0). */
  clientPackageId?: string | null
  listPriceAed?: number | string
}
type Method = 'cash' | 'card_terminal' | 'bank_transfer' | 'other'
type PayMethod = Method | 'gift_card'
type Payment = { key: string; method: PayMethod; amount: string; reference: string }
type ClientPkg = { id: string; name: string; balances: Record<string, number> }
const PREPAID = new Set(['package', 'gift_card'])
type Tip = { key: string; staffId: string; amount: string; method: Method }
type ClientHit = { id: string; name: string; phone: string | null }

const METHODS: Method[] = ['cash', 'card_terminal', 'bank_transfer', 'other']
const PAY_METHODS: PayMethod[] = [...METHODS, 'gift_card']

const f = (v: string | number) => {
  const n = typeof v === 'number' ? v : Number.parseFloat(v.replace(/,/g, ''))
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}
const aed = (fils: number) => formatAed(fils / 100)
const plain = (fils: number) => (fils / 100).toFixed(2).replace(/\.00$/, '')
let seq = 0
const newKey = () => `k${Date.now().toString(36)}${(seq++).toString(36)}`

export function Checkout({
  slug,
  branchId,
  bookingId,
  client: initialClient,
  initialLines,
  menu,
  products = [],
  packages = [],
  staff,
  receiptBase,
}: {
  slug: string
  branchId: string
  bookingId: string | null
  client: ClientHit | null
  initialLines: CheckoutLine[]
  menu: { variantId: string; serviceId?: string; label: string; priceAed: number }[]
  products?: { id: string; label: string; priceAed: number; stock: string }[]
  packages?: { id: string; label: string; priceAed: number }[]
  staff: { id: string; name: string }[]
  receiptBase: string
}) {
  const router = useRouter()
  const reduce = useReducedMotion()
  const { t } = useI18n()
  const methodLabel = (m: PayMethod) => enumLabel(t, 'paymentMethodKind', m)
  const fieldError = (key: string) => {
    const raw = errors[key]
    return raw ? (t.maybe(raw) ?? raw) : undefined
  }
  const [client, setClient] = useState<ClientHit | null>(initialClient)
  const [newClient, setNewClient] = useState<{ name: string; phone: string } | null>(null)
  const [lines, setLines] = useState<CheckoutLine[]>(initialLines)
  const [saleDiscount, setSaleDiscount] = useState('')
  const [payments, setPayments] = useState<Payment[]>([
    { key: 'p0', method: 'cash', amount: '', reference: '' },
  ])
  const [tips, setTips] = useState<Tip[]>([])
  const [pending, start] = useTransition()
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [clientPkgs, setClientPkgs] = useState<ClientPkg[]>([])
  const clientId = client?.id ?? null
  useEffect(() => {
    if (!clientId) {
      setClientPkgs([])
      return
    }
    let live = true
    clientPackagesAction(slug, clientId).then((r) => {
      if (live && r?.ok) setClientPkgs((r.data?.packages as ClientPkg[]) ?? [])
    })
    return () => {
      live = false
    }
  }, [slug, clientId])
  const serviceOf = useMemo(() => new Map(menu.map((m) => [m.variantId, m.serviceId])), [menu])
  const pkgFor = (l: CheckoutLine) => {
    const serviceId = l.refId ? serviceOf.get(l.refId) : undefined
    if (l.kind !== 'service' || !serviceId) return null
    const pkg =
      clientPkgs.find((p) => p.id === l.clientPackageId) ??
      clientPkgs.find((p) => (p.balances[serviceId] ?? 0) > 0)
    return pkg ? { pkg, left: pkg.balances[serviceId] ?? 0 } : null
  }
  const togglePackage = (l: CheckoutLine, pkgId: string | null) =>
    patchLine(
      l.key,
      pkgId
        ? { clientPackageId: pkgId, listPriceAed: l.unitPriceAed, unitPriceAed: 0, discountAed: 0 }
        : { clientPackageId: null, unitPriceAed: l.listPriceAed ?? l.unitPriceAed },
    )

  const subtotal = lines.reduce((s, l) => s + Math.max(0, f(l.unitPriceAed) * l.qty - f(l.discountAed)), 0)
  const discount = Math.min(f(saleDiscount), subtotal)
  const total = subtotal - discount
  const lineNet = (l: CheckoutLine) => Math.max(0, f(l.unitPriceAed) * l.qty - f(l.discountAed))
  // Packages and gift cards carry no VAT at sale; the sale discount is spread pro rata.
  const taxable = lines.filter((l) => !PREPAID.has(l.kind)).reduce((s, l) => s + lineNet(l), 0)
  const vat = subtotal ? Math.round(((taxable * total) / subtotal) * (5 / 105)) : 0
  const paid = payments.reduce((s, p) => s + f(p.amount), 0)
  const remaining = total - paid
  const tipTotal = tips.reduce((s, t) => s + f(t.amount), 0)
  const staffName = useMemo(() => new Map(staff.map((s) => [s.id, s.name])), [staff])

  const patchLine = (key: string, patch: Partial<CheckoutLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const patchPayment = (key: string, patch: Partial<Payment>) =>
    setPayments((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p)))
  const patchTip = (key: string, patch: Partial<Tip>) =>
    setTips((ts) => ts.map((t) => (t.key === key ? { ...t, ...patch } : t)))

  const addService = (variantId: string) => {
    const item = menu.find((m) => m.variantId === variantId)
    if (!item) return
    setLines((ls) => [
      ...ls,
      {
        key: newKey(),
        kind: 'service',
        refId: item.variantId,
        description: item.label,
        qty: 1,
        unitPriceAed: item.priceAed,
        discountAed: 0,
        staffId: ls.at(-1)?.staffId ?? null,
      },
    ])
  }
  const addItem = (kind: 'product' | 'package', id: string) => {
    const item = (kind === 'product' ? products : packages).find((x) => x.id === id)
    if (!item) return
    setLines((ls) => [
      ...ls,
      {
        key: newKey(),
        kind,
        refId: item.id,
        description: item.label,
        qty: 1,
        unitPriceAed: item.priceAed,
        discountAed: 0,
        staffId: null,
      },
    ])
  }
  const addGiftCard = () =>
    setLines((ls) => [
      ...ls,
      {
        key: newKey(),
        kind: 'gift_card',
        refId: null,
        description: 'Gift card',
        qty: 1,
        unitPriceAed: 500,
        discountAed: 0,
        staffId: null,
      },
    ])
  const addCustom = () =>
    setLines((ls) => [
      ...ls,
      {
        key: newKey(),
        kind: 'other',
        refId: null,
        description: '',
        qty: 1,
        unitPriceAed: 0,
        discountAed: 0,
        staffId: null,
      },
    ])
  const addPayment = () => {
    const used = new Set(payments.map((p) => p.method))
    const method = METHODS.find((m) => !used.has(m)) ?? 'other'
    setPayments((ps) => [
      ...ps,
      { key: newKey(), method, amount: remaining > 0 ? plain(remaining) : '', reference: '' },
    ])
  }
  const addTip = () => {
    const firstStaff = lines.find((l) => l.staffId)?.staffId ?? staff[0]?.id ?? ''
    setTips((ts) => [...ts, { key: newKey(), staffId: firstStaff, amount: '', method: 'cash' }])
  }

  const canSubmit = lines.length > 0 && remaining === 0 && !pending

  const submit = () => {
    setErrors({})
    start(async () => {
      const r = await createSaleAction(slug, {
        branchId,
        bookingId,
        clientId: client?.id ?? null,
        newClient: !client && newClient?.name.trim() ? newClient : null,
        lines: lines.map((l) => ({
          kind: l.kind,
          refId: l.refId,
          clientPackageId: l.clientPackageId ?? null,
          description: l.description,
          qty: l.qty,
          unitPriceAed: f(l.unitPriceAed) / 100,
          discountAed: f(l.discountAed) / 100,
          staffId: l.staffId,
        })),
        discountAed: discount / 100,
        payments: payments
          .filter((p) => f(p.amount) > 0)
          .map((p) => ({ method: p.method, amountAed: f(p.amount) / 100, reference: p.reference || null })),
        tips: tips
          .filter((t) => f(t.amount) > 0)
          .map((t) => ({ staffId: t.staffId, amountAed: f(t.amount) / 100, method: t.method })),
      })
      if (r?.ok) {
        toast.success(resultText(t, r) || t('sales.toast.recordedPlain'))
        router.push(`${receiptBase}/${r.data?.id as string}`)
      } else if (r) {
        setErrors(r.fieldErrors ?? {})
        toast.error(resultText(t, r) ?? t('errors.generic'))
      }
    })
  }

  const rowAnim = reduce
    ? {}
    : {
        initial: { opacity: 0, y: -6 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, height: 0 },
        transition: { type: 'spring' as const, stiffness: 420, damping: 34 },
      }

  return (
    <div className="grid gap-[var(--crm-grid-gap)] lg:grid-cols-12">
      <div className="crm-stack min-w-0 lg:col-span-7">
        {/* Client */}
        <Card
          title={t('sales.checkout.client')}
          sub={bookingId ? t('sales.checkout.fromBooking') : t('sales.checkout.clientHint')}
        >
          <div>
            {client ? (
              <div className="flex items-center justify-between gap-3 rounded-xl border bg-subtle/50 px-4 py-3">
                <span className="flex min-w-0 items-center gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
                    <UserRound className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{client.name}</span>
                    {client.phone && <span className="block text-xs text-muted tabular">{client.phone}</span>}
                  </span>
                </span>
                {!bookingId && (
                  <button
                    type="button"
                    onClick={() => setClient(null)}
                    className="grid size-11 place-items-center rounded-lg text-muted hover:bg-subtle hover:text-fg"
                    aria-label={t('sales.checkout.changeClient')}
                  >
                    <X className="size-4" strokeWidth={1.5} />
                  </button>
                )}
              </div>
            ) : newClient ? (
              <div className="space-y-4 rounded-xl border p-4">
                <div className="flex items-center justify-between">
                  <p className="text-[13px] font-medium">{t('sales.checkout.newClient')}</p>
                  <button
                    type="button"
                    onClick={() => setNewClient(null)}
                    className="min-h-9 text-[13px] font-medium text-accent hover:underline"
                  >
                    {t('sales.checkout.searchInstead')}
                  </button>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="ncName">{t('sales.checkout.name')}</Label>
                    <Input
                      id="ncName"
                      value={newClient.name}
                      onChange={(e) => setNewClient({ ...newClient, name: e.target.value })}
                      autoComplete="off"
                      className="h-11"
                    />
                    {fieldError('newClient.name') && (
                      <p className="text-[13px] text-danger">{fieldError('newClient.name')}</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ncPhone">{t('sales.checkout.mobile')}</Label>
                    <Input
                      id="ncPhone"
                      value={newClient.phone}
                      onChange={(e) => setNewClient({ ...newClient, phone: e.target.value })}
                      inputMode="tel"
                      placeholder="050 123 4567"
                      className="h-11 tabular"
                    />
                  </div>
                </div>
              </div>
            ) : (
              <ClientSearch
                slug={slug}
                onPick={setClient}
                onNew={() => setNewClient({ name: '', phone: '' })}
              />
            )}
          </div>
        </Card>

        {/* Items */}
        <Card
          flush
          title={t('sales.checkout.items')}
          sub={
            lines.length
              ? t('sales.checkout.itemCount', { count: lines.length })
              : t('sales.checkout.addWhatSold')
          }
        >
          <ul className="divide-y border-t border-[var(--crm-line)]">
            <AnimatePresence initial={false}>
              {lines.map((l, i) => (
                <motion.li key={l.key} {...rowAnim} className="overflow-hidden">
                  <div className="grid grid-cols-2 gap-3 px-[var(--crm-pad-card)] py-3 sm:grid-cols-12 sm:items-end">
                    <div className="col-span-2 space-y-1.5 sm:col-span-12">
                      {l.kind === 'service' || l.kind === 'product' || l.kind === 'package' ? (
                        <p className="flex items-center justify-between gap-3 text-sm font-medium">
                          <span className="truncate">{l.description}</span>
                          <span className="shrink-0 tabular">
                            {aed(Math.max(0, f(l.unitPriceAed) * l.qty - f(l.discountAed)))}
                          </span>
                        </p>
                      ) : (
                        <>
                          <Label htmlFor={`desc-${l.key}`}>
                            {l.kind === 'gift_card'
                              ? t('sales.checkout.giftCard')
                              : t('sales.checkout.itemN', { n: i + 1 })}
                          </Label>
                          <Input
                            id={`desc-${l.key}`}
                            value={l.description}
                            placeholder={
                              l.kind === 'gift_card'
                                ? t('sales.checkout.giftCardFor')
                                : t('sales.checkout.customPlaceholder')
                            }
                            onChange={(e) => patchLine(l.key, { description: e.target.value })}
                            className="h-11"
                          />
                        </>
                      )}
                    </div>
                    {(() => {
                      const match = pkgFor(l)
                      if (!match) return null
                      return (
                        <Label className="col-span-2 flex items-center gap-2.5 rounded-lg bg-accent-soft/60 px-3 py-2.5 text-[13px] font-normal sm:col-span-12">
                          <Checkbox
                            checked={Boolean(l.clientPackageId)}
                            onChange={(e) => togglePackage(l, e.target.checked ? match.pkg.id : null)}
                          />
                          {t('sales.checkout.usePackage', { name: match.pkg.name, count: match.left })}
                        </Label>
                      )
                    })()}
                    <div className="col-span-2 space-y-1.5 sm:col-span-5">
                      <Label htmlFor={`staff-${l.key}`}>{t('sales.checkout.therapist')}</Label>
                      <Select
                        id={`staff-${l.key}`}
                        aria-label={t('sales.checkout.therapistFor', { n: i + 1 })}
                        value={l.staffId ?? ''}
                        onChange={(e) => patchLine(l.key, { staffId: e.target.value || null })}
                        className="h-11"
                      >
                        <option value="">—</option>
                        {staff.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="space-y-1.5 sm:col-span-3">
                      <Label htmlFor={`price-${l.key}`}>{t('sales.checkout.price')}</Label>
                      <Input
                        id={`price-${l.key}`}
                        inputMode="decimal"
                        value={String(l.unitPriceAed)}
                        disabled={Boolean(l.clientPackageId)}
                        onChange={(e) => patchLine(l.key, { unitPriceAed: e.target.value })}
                        className="h-11 tabular"
                      />
                    </div>
                    <div className="space-y-1.5 sm:col-span-3">
                      <Label htmlFor={`disc-${l.key}`}>{t('sales.checkout.discount')}</Label>
                      <Input
                        id={`disc-${l.key}`}
                        aria-label={t('sales.checkout.discountFor', { n: i + 1 })}
                        inputMode="decimal"
                        placeholder="0"
                        value={l.discountAed ? String(l.discountAed) : ''}
                        onChange={(e) => patchLine(l.key, { discountAed: e.target.value })}
                        className="h-11 tabular"
                      />
                    </div>
                    <div className="col-span-2 flex justify-end sm:col-span-1">
                      <button
                        type="button"
                        onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                        aria-label={t('sales.checkout.removeItem', { n: i + 1 })}
                        className="grid size-11 place-items-center rounded-lg text-muted transition-colors hover:bg-danger-soft hover:text-danger"
                      >
                        <Trash2 className="size-4" strokeWidth={1.5} />
                      </button>
                    </div>
                  </div>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
          <div className="flex flex-col flex-wrap gap-2 border-t border-[var(--crm-line)] px-[var(--crm-pad-card)] py-3 sm:flex-row sm:items-center">
            <Select
              aria-label={t('sales.checkout.addService')}
              value=""
              onChange={(e) => addService(e.target.value)}
              className="h-11 sm:max-w-sm"
            >
              <option value="">{t('sales.checkout.addServiceOption')}</option>
              {menu.map((m) => (
                <option key={m.variantId} value={m.variantId}>
                  {t('sales.checkout.optionPrice', { name: m.label, price: formatAed(m.priceAed) })}
                </option>
              ))}
            </Select>
            {products.length > 0 && (
              <Select
                aria-label={t('sales.checkout.addProduct')}
                value=""
                onChange={(e) => addItem('product', e.target.value)}
                className="h-11 sm:max-w-xs"
              >
                <option value="">{t('sales.checkout.addProductOption')}</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {t('sales.checkout.optionPriceStock', {
                      name: p.label,
                      price: formatAed(p.priceAed),
                      stock: p.stock,
                    })}
                  </option>
                ))}
              </Select>
            )}
            {packages.length > 0 && (
              <Select
                aria-label={t('sales.checkout.sellPackage')}
                value=""
                onChange={(e) => addItem('package', e.target.value)}
                className="h-11 sm:max-w-xs"
              >
                <option value="">{t('sales.checkout.sellPackageOption')}</option>
                {packages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {t('sales.checkout.optionPrice', { name: p.label, price: formatAed(p.priceAed) })}
                  </option>
                ))}
              </Select>
            )}
            <Button type="button" variant="secondary" onClick={addGiftCard}>
              <Gift /> {t('sales.checkout.giftCard')}
            </Button>
            <Button type="button" variant="ghost" onClick={addCustom}>
              <Plus /> {t('sales.checkout.customItem')}
            </Button>
          </div>
        </Card>

        {/* Tips */}
        <Card
          flush
          title={t('sales.checkout.tips')}
          sub={t('sales.checkout.tipsHint')}
          actions={
            <Button type="button" variant="secondary" size="sm" onClick={addTip} disabled={!staff.length}>
              <Heart /> {t('sales.checkout.addTip')}
            </Button>
          }
        >
          <ul className={cn(tips.length ? 'divide-y border-t border-[var(--crm-line)]' : '')}>
            <AnimatePresence initial={false}>
              {tips.map((tip, i) => (
                <motion.li key={tip.key} {...rowAnim} className="overflow-hidden">
                  <div className="grid grid-cols-2 gap-3 px-[var(--crm-pad-card)] py-3 sm:grid-cols-12 sm:items-end">
                    <div className="col-span-2 space-y-1.5 sm:col-span-5">
                      <Label htmlFor={`tip-staff-${tip.key}`}>{t('sales.checkout.therapist')}</Label>
                      <Select
                        id={`tip-staff-${tip.key}`}
                        aria-label={t('sales.checkout.tipTherapist', { n: i + 1 })}
                        value={tip.staffId}
                        onChange={(e) => patchTip(tip.key, { staffId: e.target.value })}
                        className="h-11"
                      >
                        {staff.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="space-y-1.5 sm:col-span-3">
                      <Label htmlFor={`tip-amt-${tip.key}`}>{t('sales.checkout.amount')}</Label>
                      <Input
                        id={`tip-amt-${tip.key}`}
                        aria-label={t('sales.checkout.tipAmount', { n: i + 1 })}
                        inputMode="decimal"
                        placeholder="0"
                        value={tip.amount}
                        onChange={(e) => patchTip(tip.key, { amount: e.target.value })}
                        className="h-11 tabular"
                      />
                    </div>
                    <div className="space-y-1.5 sm:col-span-3">
                      <Label htmlFor={`tip-m-${tip.key}`}>{t('sales.checkout.paidBy')}</Label>
                      <Select
                        id={`tip-m-${tip.key}`}
                        aria-label={t('sales.checkout.tipMethod', { n: i + 1 })}
                        value={tip.method}
                        onChange={(e) => patchTip(tip.key, { method: e.target.value as Method })}
                        className="h-11"
                      >
                        {METHODS.map((m) => (
                          <option key={m} value={m}>
                            {methodLabel(m)}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="col-span-2 flex justify-end sm:col-span-1">
                      <button
                        type="button"
                        onClick={() => setTips((ts) => ts.filter((x) => x.key !== tip.key))}
                        aria-label={t('sales.checkout.removeTip', { n: i + 1 })}
                        className="grid size-11 place-items-center rounded-lg text-muted transition-colors hover:bg-danger-soft hover:text-danger"
                      >
                        <Trash2 className="size-4" strokeWidth={1.5} />
                      </button>
                    </div>
                  </div>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
          {tips.length === 0 && <div className="pb-[var(--crm-pad-card)]" />}
        </Card>
      </div>

      {/* Summary + payment */}
      <div className="lg:col-span-5">
        <Card
          flush
          className="lg:sticky lg:top-6"
          title={t('sales.checkout.payment')}
          sub={t('sales.checkout.paymentHint')}
        >
          <dl className="space-y-2.5 px-[var(--crm-pad-card)] text-[length:var(--crm-fs-td)]">
            <div className="flex justify-between gap-4">
              <dt className="crm-muted">{t('sales.checkout.subtotal')}</dt>
              <dd className="tabular">{aed(subtotal)}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt>
                <Label htmlFor="saleDiscount" className="font-normal text-muted">
                  {t('sales.checkout.saleDiscount')}
                </Label>
              </dt>
              <dd>
                <Input
                  id="saleDiscount"
                  inputMode="decimal"
                  placeholder="0"
                  value={saleDiscount}
                  onChange={(e) => setSaleDiscount(e.target.value)}
                  className="h-10 w-28 text-end tabular"
                />
              </dd>
            </div>
            <div className="flex justify-between gap-4 text-muted">
              <dt>{t('sales.checkout.vatIncluded')}</dt>
              <dd className="tabular">{aed(vat)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 border-t border-[var(--crm-line)] pt-3">
              <dt className="font-semibold">{t('sales.checkout.total')}</dt>
              <dd className="crm-num text-2xl font-semibold tracking-tight tabular" data-testid="sale-total">
                {aed(total)}
              </dd>
            </div>
          </dl>

          <div className="mt-4 space-y-3 border-t border-[var(--crm-line)] px-[var(--crm-pad-card)] pt-4">
            <AnimatePresence initial={false}>
              {payments.map((p, i) => (
                <motion.div key={p.key} {...rowAnim} className="overflow-hidden">
                  <div className="grid grid-cols-[minmax(0,1fr)_7rem_2.75rem] items-center gap-2">
                    <Select
                      aria-label={t('sales.checkout.paymentMethod', { n: i + 1 })}
                      value={p.method}
                      onChange={(e) => patchPayment(p.key, { method: e.target.value as PayMethod })}
                      className="h-11"
                    >
                      {PAY_METHODS.map((m) => (
                        <option key={m} value={m}>
                          {methodLabel(m)}
                        </option>
                      ))}
                    </Select>
                    <Input
                      aria-label={t('sales.checkout.paymentAmount', { n: i + 1 })}
                      inputMode="decimal"
                      placeholder={remaining > 0 ? plain(remaining) : '0'}
                      value={p.amount}
                      onChange={(e) => patchPayment(p.key, { amount: e.target.value })}
                      className="h-11 text-end tabular"
                    />
                    <button
                      type="button"
                      onClick={() => setPayments((ps) => ps.filter((x) => x.key !== p.key))}
                      disabled={payments.length === 1}
                      aria-label={t('sales.checkout.removePayment', { n: i + 1 })}
                      className="grid size-11 place-items-center rounded-lg text-muted transition-colors hover:bg-subtle hover:text-fg disabled:opacity-30"
                    >
                      <X className="size-4" strokeWidth={1.5} />
                    </button>
                    {(p.method === 'card_terminal' ||
                      p.method === 'bank_transfer' ||
                      p.method === 'gift_card') && (
                      <Input
                        aria-label={t('sales.checkout.paymentReference', { n: i + 1 })}
                        placeholder={
                          p.method === 'gift_card'
                            ? t('sales.checkout.refGiftCard')
                            : p.method === 'card_terminal'
                              ? t('sales.checkout.refTerminal')
                              : t('sales.checkout.refTransfer')
                        }
                        value={p.reference}
                        onChange={(e) => patchPayment(p.key, { reference: e.target.value })}
                        className="col-span-2 h-10 text-[13px]"
                      />
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            <Button
              type="button"
              variant="ghost"
              onClick={addPayment}
              className="-ms-2"
              disabled={payments.length >= 6}
            >
              <Plus /> {t('sales.checkout.splitPayment')}
            </Button>
          </div>

          <div className="mt-3 space-y-3 border-t border-[var(--crm-line)] bg-[var(--crm-bg)] px-[var(--crm-pad-card)] py-4">
            <div className="flex items-center justify-between gap-4 text-sm" aria-live="polite">
              <span className="flex items-center gap-2 text-muted">
                {remaining < 0 ? t('sales.checkout.overBy') : t('sales.checkout.remaining')}
                {remaining > 0 && payments.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const last = payments.at(-1)!
                      patchPayment(last.key, { amount: plain(f(last.amount) + remaining) })
                    }}
                    className="min-h-9 rounded-full border bg-surface px-3 text-xs font-medium text-fg transition-colors hover:border-accent hover:text-accent"
                  >
                    {t('sales.checkout.fill', { method: methodLabel(payments.at(-1)!.method).toLowerCase() })}
                  </button>
                )}
              </span>
              <motion.span
                key={remaining === 0 ? 'zero' : 'open'}
                initial={reduce ? false : { scale: 0.92, opacity: 0.6 }}
                animate={{ scale: 1, opacity: 1 }}
                data-testid="remaining"
                className={cn(
                  'inline-flex items-center gap-1.5 font-semibold tabular',
                  remaining === 0 ? 'text-success' : remaining < 0 ? 'text-danger' : 'text-warning',
                )}
              >
                {remaining === 0 && total > 0 && <Check className="size-4" />}
                {aed(Math.abs(remaining))}
              </motion.span>
            </div>
            {tipTotal > 0 && (
              <p className="flex justify-between text-sm text-muted">
                <span>
                  {tips.length === 1 && staffName.get(tips[0]!.staffId)
                    ? t('sales.checkout.tipsFor', { name: staffName.get(tips[0]!.staffId)! })
                    : t('sales.checkout.tipsLine')}
                </span>
                <span className="tabular">+{aed(tipTotal)}</span>
              </p>
            )}
            <Button
              size="lg"
              className="h-12 w-full"
              disabled={!canSubmit}
              pending={pending}
              onClick={submit}
            >
              {t('sales.checkout.complete', { amount: aed(total + tipTotal) })}
            </Button>
            {lines.length === 0 && (
              <p className="text-center text-[13px] text-muted">{t('sales.checkout.addItemFirst')}</p>
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}

function ClientSearch({
  slug,
  onPick,
  onNew,
}: {
  slug: string
  onPick: (c: ClientHit) => void
  onNew: () => void
}) {
  const id = useId()
  const t = useI18n().t
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<ClientHit[]>([])
  const [pending, start] = useTransition()

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([])
      return
    }
    const timer = setTimeout(
      () =>
        start(async () => {
          const r = await searchPosClientsAction(slug, q)
          setHits(r?.ok ? ((r.data?.clients as ClientHit[]) ?? []) : [])
        }),
      220,
    )
    return () => clearTimeout(timer)
  }, [q, slug])

  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="sr-only">
        {t('sales.checkout.findClient')}
      </Label>
      <div className="relative">
        <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <Input
          id={id}
          aria-label={t('sales.checkout.findClient')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('sales.checkout.searchPlaceholder')}
          autoComplete="off"
          className="h-11 ps-9"
        />
        {pending && (
          <Loader2 className="absolute end-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted" />
        )}
      </div>
      <AnimatePresence initial={false}>
        {q.trim().length >= 2 && (
          <motion.ul
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="divide-y overflow-hidden rounded-lg border"
          >
            {hits.map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  onClick={() => onPick(h)}
                  className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-start text-sm hover:bg-subtle"
                >
                  <span className="truncate font-medium">{h.name}</span>
                  {h.phone && <span className="shrink-0 text-xs text-muted tabular">{h.phone}</span>}
                </button>
              </li>
            ))}
            {!pending && hits.length === 0 && (
              <li className="px-3 py-2.5 text-sm text-muted">{t('sales.checkout.noMatches')}</li>
            )}
          </motion.ul>
        )}
      </AnimatePresence>
      <button
        type="button"
        onClick={onNew}
        className="inline-flex min-h-10 items-center gap-1.5 text-[13px] font-medium text-accent hover:underline"
      >
        <UserPlus className="size-3.5" /> {t('sales.checkout.newClient')}
      </button>
    </div>
  )
}
