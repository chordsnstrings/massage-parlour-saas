'use client'
import { Check, Heart, Loader2, Plus, Search, Trash2, UserPlus, UserRound, X } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useMemo, useState, useTransition } from 'react'
import { createSaleAction, searchPosClientsAction } from '@/app/dashboard/[tenant]/sales/actions'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { Input, Label, Select } from '@/components/ui/input'
import { toast } from '@/components/ui/toast'
import { cn, formatAed } from '@/lib/utils'

export type CheckoutLine = {
  key: string
  kind: 'service' | 'other'
  refId: string | null
  description: string
  qty: number
  unitPriceAed: number | string
  discountAed: number | string
  staffId: string | null
}
type Method = 'cash' | 'card_terminal' | 'bank_transfer' | 'other'
type Payment = { key: string; method: Method; amount: string; reference: string }
type Tip = { key: string; staffId: string; amount: string; method: Method }
type ClientHit = { id: string; name: string; phone: string | null }

const METHODS: { value: Method; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'card_terminal', label: 'Card terminal' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'other', label: 'Other' },
]

const f = (v: string | number) => {
  const n = typeof v === 'number' ? v : Number.parseFloat(v.replace(/,/g, ''))
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}
const fmt = (fils: number) => formatAed(fils / 100)
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
  staff,
  receiptBase,
}: {
  slug: string
  branchId: string
  bookingId: string | null
  client: ClientHit | null
  initialLines: CheckoutLine[]
  menu: { variantId: string; label: string; priceAed: number }[]
  staff: { id: string; name: string }[]
  receiptBase: string
}) {
  const router = useRouter()
  const reduce = useReducedMotion()
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

  const subtotal = lines.reduce((s, l) => s + Math.max(0, f(l.unitPriceAed) * l.qty - f(l.discountAed)), 0)
  const discount = Math.min(f(saleDiscount), subtotal)
  const total = subtotal - discount
  const vat = Math.round((total * 5) / 105)
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
    const method = METHODS.find((m) => !used.has(m.value))?.value ?? 'other'
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
        toast.success(r.message ?? 'Sale recorded')
        router.push(`${receiptBase}/${r.data?.id as string}`)
      } else if (r) {
        setErrors(r.fieldErrors ?? {})
        toast.error(r.error)
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
    <div className="grid gap-6 lg:grid-cols-12 lg:gap-8">
      <div className="min-w-0 space-y-6 lg:col-span-7">
        {/* Client */}
        <Card>
          <CardHeader
            title="Client"
            description={bookingId ? 'From the booking' : 'Search, add, or leave as walk-in'}
          />
          <div className="px-5 pt-4 pb-5 sm:px-6 sm:pb-6">
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
                    aria-label="Change client"
                  >
                    <X className="size-4" strokeWidth={1.5} />
                  </button>
                )}
              </div>
            ) : newClient ? (
              <div className="space-y-4 rounded-xl border p-4">
                <div className="flex items-center justify-between">
                  <p className="text-[13px] font-medium">New client</p>
                  <button
                    type="button"
                    onClick={() => setNewClient(null)}
                    className="min-h-9 text-[13px] font-medium text-accent hover:underline"
                  >
                    Search instead
                  </button>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="ncName">Name</Label>
                    <Input
                      id="ncName"
                      value={newClient.name}
                      onChange={(e) => setNewClient({ ...newClient, name: e.target.value })}
                      autoComplete="off"
                      className="h-11"
                    />
                    {errors['newClient.name'] && (
                      <p className="text-[13px] text-danger">{errors['newClient.name']}</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ncPhone">Mobile</Label>
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
        <Card>
          <CardHeader
            title="Items"
            description={
              lines.length ? `${lines.length} ${lines.length === 1 ? 'item' : 'items'}` : 'Add what was sold'
            }
          />
          <ul className="mt-4 divide-y border-t">
            <AnimatePresence initial={false}>
              {lines.map((l, i) => (
                <motion.li key={l.key} {...rowAnim} className="overflow-hidden">
                  <div className="grid grid-cols-2 gap-3 px-5 py-4 sm:grid-cols-12 sm:items-end sm:px-6">
                    <div className="col-span-2 space-y-1.5 sm:col-span-12">
                      {l.kind === 'service' ? (
                        <p className="flex items-center justify-between gap-3 text-sm font-medium">
                          <span className="truncate">{l.description}</span>
                          <span className="shrink-0 tabular">
                            {fmt(Math.max(0, f(l.unitPriceAed) * l.qty - f(l.discountAed)))}
                          </span>
                        </p>
                      ) : (
                        <>
                          <Label htmlFor={`desc-${l.key}`}>Item {i + 1}</Label>
                          <Input
                            id={`desc-${l.key}`}
                            value={l.description}
                            placeholder="e.g. Aromatherapy oil"
                            onChange={(e) => patchLine(l.key, { description: e.target.value })}
                            className="h-11"
                          />
                        </>
                      )}
                    </div>
                    <div className="col-span-2 space-y-1.5 sm:col-span-5">
                      <Label htmlFor={`staff-${l.key}`}>Therapist</Label>
                      <Select
                        id={`staff-${l.key}`}
                        aria-label={`Therapist for item ${i + 1}`}
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
                      <Label htmlFor={`price-${l.key}`}>Price</Label>
                      <Input
                        id={`price-${l.key}`}
                        inputMode="decimal"
                        value={String(l.unitPriceAed)}
                        onChange={(e) => patchLine(l.key, { unitPriceAed: e.target.value })}
                        className="h-11 tabular"
                      />
                    </div>
                    <div className="space-y-1.5 sm:col-span-3">
                      <Label htmlFor={`disc-${l.key}`}>Discount</Label>
                      <Input
                        id={`disc-${l.key}`}
                        aria-label={`Discount for item ${i + 1}`}
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
                        aria-label={`Remove item ${i + 1}`}
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
          <div className="flex flex-col gap-3 border-t px-5 py-4 sm:flex-row sm:items-center sm:px-6">
            <Select
              aria-label="Add a service"
              value=""
              onChange={(e) => addService(e.target.value)}
              className="h-11 sm:max-w-sm"
            >
              <option value="">Add a service…</option>
              {menu.map((m) => (
                <option key={m.variantId} value={m.variantId}>
                  {m.label} — {formatAed(m.priceAed)}
                </option>
              ))}
            </Select>
            <Button type="button" variant="ghost" size="lg" onClick={addCustom}>
              <Plus /> Custom item
            </Button>
          </div>
        </Card>

        {/* Tips */}
        <Card>
          <CardHeader
            title="Tips"
            description="On top of the bill, kept for the therapist"
            action={
              <Button type="button" variant="secondary" onClick={addTip} disabled={!staff.length}>
                <Heart /> Add tip
              </Button>
            }
          />
          <ul className={cn('mt-4', tips.length ? 'divide-y border-t' : '')}>
            <AnimatePresence initial={false}>
              {tips.map((t, i) => (
                <motion.li key={t.key} {...rowAnim} className="overflow-hidden">
                  <div className="grid grid-cols-2 gap-3 px-5 py-4 sm:grid-cols-12 sm:items-end sm:px-6">
                    <div className="col-span-2 space-y-1.5 sm:col-span-5">
                      <Label htmlFor={`tip-staff-${t.key}`}>Therapist</Label>
                      <Select
                        id={`tip-staff-${t.key}`}
                        aria-label={`Tip ${i + 1} therapist`}
                        value={t.staffId}
                        onChange={(e) => patchTip(t.key, { staffId: e.target.value })}
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
                      <Label htmlFor={`tip-amt-${t.key}`}>Amount</Label>
                      <Input
                        id={`tip-amt-${t.key}`}
                        aria-label={`Tip ${i + 1} amount`}
                        inputMode="decimal"
                        placeholder="0"
                        value={t.amount}
                        onChange={(e) => patchTip(t.key, { amount: e.target.value })}
                        className="h-11 tabular"
                      />
                    </div>
                    <div className="space-y-1.5 sm:col-span-3">
                      <Label htmlFor={`tip-m-${t.key}`}>Paid by</Label>
                      <Select
                        id={`tip-m-${t.key}`}
                        aria-label={`Tip ${i + 1} method`}
                        value={t.method}
                        onChange={(e) => patchTip(t.key, { method: e.target.value as Method })}
                        className="h-11"
                      >
                        {METHODS.map((m) => (
                          <option key={m.value} value={m.value}>
                            {m.label}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="col-span-2 flex justify-end sm:col-span-1">
                      <button
                        type="button"
                        onClick={() => setTips((ts) => ts.filter((x) => x.key !== t.key))}
                        aria-label={`Remove tip ${i + 1}`}
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
          {tips.length === 0 && <div className="pb-5 sm:pb-6" />}
        </Card>
      </div>

      {/* Summary + payment */}
      <div className="lg:col-span-5">
        <Card className="lg:sticky lg:top-6">
          <CardHeader title="Payment" description="Split across methods if needed" />
          <dl className="mt-5 space-y-2.5 px-5 text-sm sm:px-6">
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Subtotal</dt>
              <dd className="tabular">{fmt(subtotal)}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt>
                <Label htmlFor="saleDiscount" className="font-normal text-muted">
                  Discount (AED)
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
              <dt>VAT 5% included</dt>
              <dd className="tabular">{fmt(vat)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 border-t pt-3">
              <dt className="font-medium">Total</dt>
              <dd className="text-2xl font-semibold tracking-tight tabular" data-testid="sale-total">
                {fmt(total)}
              </dd>
            </div>
          </dl>

          <div className="mt-5 space-y-3 border-t px-5 pt-5 sm:px-6">
            <AnimatePresence initial={false}>
              {payments.map((p, i) => (
                <motion.div key={p.key} {...rowAnim} className="overflow-hidden">
                  <div className="grid grid-cols-[minmax(0,1fr)_7rem_2.75rem] items-center gap-2">
                    <Select
                      aria-label={`Payment ${i + 1} method`}
                      value={p.method}
                      onChange={(e) => patchPayment(p.key, { method: e.target.value as Method })}
                      className="h-11"
                    >
                      {METHODS.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </Select>
                    <Input
                      aria-label={`Payment ${i + 1} amount`}
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
                      aria-label={`Remove payment ${i + 1}`}
                      className="grid size-11 place-items-center rounded-lg text-muted transition-colors hover:bg-subtle hover:text-fg disabled:opacity-30"
                    >
                      <X className="size-4" strokeWidth={1.5} />
                    </button>
                    {(p.method === 'card_terminal' || p.method === 'bank_transfer') && (
                      <Input
                        aria-label={`Payment ${i + 1} reference`}
                        placeholder={
                          p.method === 'card_terminal'
                            ? 'Terminal slip no. (optional)'
                            : 'Transfer ref (optional)'
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
              <Plus /> Split payment
            </Button>
          </div>

          <div className="mt-4 space-y-4 border-t bg-subtle/40 px-5 py-5 sm:px-6">
            <div className="flex items-center justify-between gap-4 text-sm" aria-live="polite">
              <span className="flex items-center gap-2 text-muted">
                {remaining < 0 ? 'Over by' : 'Remaining'}
                {remaining > 0 && payments.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const last = payments.at(-1)!
                      patchPayment(last.key, { amount: plain(f(last.amount) + remaining) })
                    }}
                    className="min-h-9 rounded-full border bg-surface px-3 text-xs font-medium text-fg transition-colors hover:border-accent hover:text-accent"
                  >
                    Fill {METHODS.find((m) => m.value === payments.at(-1)!.method)?.label.toLowerCase()}
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
                {fmt(Math.abs(remaining))}
              </motion.span>
            </div>
            {tipTotal > 0 && (
              <p className="flex justify-between text-sm text-muted">
                <span>
                  Tips{' '}
                  {tips.length === 1 && staffName.get(tips[0]!.staffId)
                    ? `for ${staffName.get(tips[0]!.staffId)}`
                    : ''}
                </span>
                <span className="tabular">+{fmt(tipTotal)}</span>
              </p>
            )}
            <Button
              size="lg"
              className="h-12 w-full"
              disabled={!canSubmit}
              pending={pending}
              onClick={submit}
            >
              Complete sale · {fmt(total + tipTotal)}
            </Button>
            {lines.length === 0 && (
              <p className="text-center text-[13px] text-muted">Add an item to continue.</p>
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
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<ClientHit[]>([])
  const [pending, start] = useTransition()

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([])
      return
    }
    const t = setTimeout(
      () =>
        start(async () => {
          const r = await searchPosClientsAction(slug, q)
          setHits(r?.ok ? ((r.data?.clients as ClientHit[]) ?? []) : [])
        }),
      220,
    )
    return () => clearTimeout(t)
  }, [q, slug])

  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="sr-only">
        Find client
      </Label>
      <div className="relative">
        <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <Input
          id={id}
          aria-label="Find client"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name or mobile — or leave empty for a walk-in"
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
              <li className="px-3 py-2.5 text-sm text-muted">No matching clients</li>
            )}
          </motion.ul>
        )}
      </AnimatePresence>
      <button
        type="button"
        onClick={onNew}
        className="inline-flex min-h-10 items-center gap-1.5 text-[13px] font-medium text-accent hover:underline"
      >
        <UserPlus className="size-3.5" /> New client
      </button>
    </div>
  )
}
