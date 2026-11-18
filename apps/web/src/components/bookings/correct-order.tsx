'use client'
// R32 (D4) Correct payment: new prices per service line, the payment split and tips, with a reason. The action voids
// the sale and re-creates it on the same business date (append-only ledger); the day lock (D6) applies.
import { enumLabel } from '@spa/core/i18n/labels'
import { Plus, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { correctOrderAction } from '@/app/dashboard/[tenant]/bookings/actions'
import { Button } from '@/components/ui/button'
import { Input, Label, Select } from '@/components/ui/input'
import { Sheet } from '@/components/ui/sheet'
import { toast } from '@/components/ui/toast'
import { resultText, useI18n } from '@/i18n/client'

const METHODS = ['cash', 'card_terminal', 'bank_transfer', 'other'] as const
type Method = (typeof METHODS)[number]
/** `reference`: the card slip / transfer reference recorded with the payment (kept unless the method changes). */
type Row = { key: string; method: Method; amount: string; reference: string | null }
type TipRow = { key: string; staffId: string; amount: string; method: Method }

const text = (n: number) => String(Math.round(n * 100) / 100)
const num = (v: string) => {
  const n = Number(v.replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}
let seq = 0
const key = () => `r${seq++}`

export function CorrectOrderForm({
  slug,
  bookingId,
  lines,
  payments,
  tips,
  staff,
}: {
  slug: string
  bookingId: string
  lines: { saleLineId: string; description: string; unitPriceAed: number }[]
  payments: { method: string; amountAed: number; reference?: string | null }[]
  tips: { staffId: string; amountAed: number; method: string }[]
  staff: { id: string; name: string }[]
}) {
  const { t, fmt } = useI18n()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const [prices, setPrices] = useState(() =>
    Object.fromEntries(lines.map((l) => [l.saleLineId, text(l.unitPriceAed)])),
  )
  const asMethod = (m: string): Method =>
    (METHODS as readonly string[]).includes(m) ? (m as Method) : 'other'
  const [pays, setPays] = useState<Row[]>(() =>
    payments.map((p) => ({
      key: key(),
      method: asMethod(p.method),
      amount: text(p.amountAed),
      reference: p.reference ?? null,
    })),
  )
  const [tipRows, setTipRows] = useState<TipRow[]>(() =>
    tips.map((x) => ({
      key: key(),
      staffId: x.staffId,
      amount: text(x.amountAed),
      method: asMethod(x.method),
    })),
  )
  const [reason, setReason] = useState('')
  const total = lines.reduce((s, l) => s + num(prices[l.saleLineId] ?? '0'), 0)
  const paid = pays.reduce((s, p) => s + num(p.amount), 0)

  const submit = () =>
    start(async () => {
      const r = await correctOrderAction(slug, bookingId, {
        reason,
        lines: lines.map((l) => ({
          saleLineId: l.saleLineId,
          unitPriceAed: num(prices[l.saleLineId] ?? '0'),
        })),
        payments: pays.map((p) => ({ method: p.method, amountAed: num(p.amount), reference: p.reference })),
        tips: tipRows.map((x) => ({ staffId: x.staffId, amountAed: num(x.amount), method: x.method })),
      })
      if (r?.ok) {
        toast.success(resultText(t, r) ?? t('bookings.order.correct'))
        setOpen(false)
        router.refresh()
      } else if (r) toast.error(resultText(t, r) ?? r.error ?? t('errors.generic'))
    })

  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        {t('bookings.order.correct')}
      </Button>
      <Sheet open={open} onOpenChange={setOpen} title={t('bookings.order.correctTitle')}>
        <div className="space-y-5">
          <div className="space-y-3">
            {lines.map((l) => (
              <div key={l.saleLineId} className="space-y-1.5">
                <Label htmlFor={`price-${l.saleLineId}`}>
                  {t('bookings.order.priceFor', { service: l.description })}
                </Label>
                <Input
                  id={`price-${l.saleLineId}`}
                  inputMode="decimal"
                  value={prices[l.saleLineId] ?? ''}
                  onChange={(e) => setPrices((v) => ({ ...v, [l.saleLineId]: e.target.value }))}
                  className="tabular"
                />
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">{t('sales.checkout.payment')}</p>
            {pays.map((p, i) => (
              <div key={p.key} className="flex items-end gap-2">
                <Select
                  aria-label={t('bookings.order.paymentMethod', { n: i + 1 })}
                  value={p.method}
                  onChange={(e) =>
                    setPays((rows) =>
                      rows.map((x) =>
                        x.key === p.key ? { ...x, method: e.target.value as Method, reference: null } : x,
                      ),
                    )
                  }
                  className="h-11 flex-1"
                >
                  {METHODS.map((m) => (
                    <option key={m} value={m}>
                      {enumLabel(t, 'paymentMethodKind', m)}
                    </option>
                  ))}
                </Select>
                <Input
                  aria-label={t('bookings.order.paymentAmount', { n: i + 1 })}
                  inputMode="decimal"
                  value={p.amount}
                  onChange={(e) =>
                    setPays((rows) =>
                      rows.map((x) => (x.key === p.key ? { ...x, amount: e.target.value } : x)),
                    )
                  }
                  className="h-11 w-32 tabular"
                />
                <button
                  type="button"
                  aria-label={t('bookings.order.removePayment', { n: i + 1 })}
                  onClick={() => setPays((rows) => rows.filter((x) => x.key !== p.key))}
                  className="grid size-11 place-items-center rounded-lg text-muted hover:bg-danger-soft hover:text-danger"
                >
                  <Trash2 className="size-4" strokeWidth={1.5} />
                </button>
              </div>
            ))}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                setPays((rows) => [...rows, { key: key(), method: 'cash', amount: '', reference: null }])
              }
            >
              <Plus /> {t('bookings.order.addPayment')}
            </Button>
            <p className="text-[13px] text-muted tabular">
              {t('bookings.order.totals', { total: fmt.aed(total), paid: fmt.aed(paid) })}
            </p>
          </div>

          {staff.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">{t('sales.checkout.tips')}</p>
              {tipRows.map((x, i) => (
                <div key={x.key} className="flex flex-wrap items-end gap-2">
                  <Select
                    aria-label={t('sales.checkout.tipTherapist', { n: i + 1 })}
                    value={x.staffId}
                    onChange={(e) =>
                      setTipRows((rows) =>
                        rows.map((r) => (r.key === x.key ? { ...r, staffId: e.target.value } : r)),
                      )
                    }
                    className="h-11 flex-1"
                  >
                    {staff.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                  <Input
                    aria-label={t('sales.checkout.tipAmount', { n: i + 1 })}
                    inputMode="decimal"
                    value={x.amount}
                    onChange={(e) =>
                      setTipRows((rows) =>
                        rows.map((r) => (r.key === x.key ? { ...r, amount: e.target.value } : r)),
                      )
                    }
                    className="h-11 w-28 tabular"
                  />
                  <Select
                    aria-label={t('sales.checkout.tipMethod', { n: i + 1 })}
                    value={x.method}
                    onChange={(e) =>
                      setTipRows((rows) =>
                        rows.map((r) => (r.key === x.key ? { ...r, method: e.target.value as Method } : r)),
                      )
                    }
                    className="h-11 w-36"
                  >
                    {METHODS.map((m) => (
                      <option key={m} value={m}>
                        {enumLabel(t, 'paymentMethodKind', m)}
                      </option>
                    ))}
                  </Select>
                  <button
                    type="button"
                    aria-label={t('sales.checkout.removeTip', { n: i + 1 })}
                    onClick={() => setTipRows((rows) => rows.filter((r) => r.key !== x.key))}
                    className="grid size-11 place-items-center rounded-lg text-muted hover:bg-danger-soft hover:text-danger"
                  >
                    <Trash2 className="size-4" strokeWidth={1.5} />
                  </button>
                </div>
              ))}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  setTipRows((rows) => [
                    ...rows,
                    { key: key(), staffId: staff[0]!.id, amount: '', method: 'cash' },
                  ])
                }
              >
                <Plus /> {t('sales.checkout.addTip')}
              </Button>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="correct-reason">{t('bookings.order.reason')}</Label>
            <Input
              id="correct-reason"
              value={reason}
              maxLength={300}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <Button
            type="button"
            className="w-full"
            pending={pending}
            disabled={reason.trim().length < 3}
            onClick={submit}
          >
            {t('bookings.order.correct')}
          </Button>
        </div>
      </Sheet>
    </>
  )
}
