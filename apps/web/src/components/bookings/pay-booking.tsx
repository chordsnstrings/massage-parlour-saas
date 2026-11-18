'use client'
// R45 (owner 2026-11-02: "our sales are the bookings"): Complete & pay in a pop-up — the booking's lines with the
// agreed fee (editable), Cash / Card / Cash + card, the commission per therapist (members who may enter it), Save =
// createSaleAction (Finish: the sale + commission in one transaction). Tips, discounts, products: the full checkout.
import { enumLabel } from '@spa/core/i18n/labels'
import { Receipt } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { payPrefillAction } from '@/app/dashboard/[tenant]/bookings/actions'
import { createSaleAction } from '@/app/dashboard/[tenant]/sales/actions'
import type { BookingPrefill } from '@/app/dashboard/[tenant]/sales/booking-prefill'
import { Note } from '@/components/crm'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { Sheet } from '@/components/ui/sheet'
import { toast } from '@/components/ui/toast'
import { resultText, useI18n } from '@/i18n/client'

type Loaded = { branchId: string; prefill: BookingPrefill; names: Record<string, string> }
type Mode = 'cash' | 'card' | 'split'

/** Fils from a typed AED amount ("1,200.5" → 120050); blank/invalid → null. */
const fils = (v: string | number) => {
  const s = String(v).replace(/,/g, '').trim()
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null
}
const OK = ['confirmed', 'checked_in', 'in_service', 'completed']

export function PayBookingButton({
  slug,
  bookingId,
  refCode,
  checkoutHref,
  label,
  variant = 'primary',
  size,
  className,
}: {
  slug: string
  bookingId: string
  refCode: string
  /** The full checkout (/sales/new?booking=…) for tips, discounts and products. */
  checkoutHref: string
  label: string
  variant?: 'primary' | 'secondary'
  size?: 'sm' | 'lg'
  className?: string
}) {
  const { t, fmt } = useI18n()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [prices, setPrices] = useState<Record<string, string>>({})
  const [commission, setCommission] = useState<Record<string, string>>({})
  const [mode, setMode] = useState<Mode>('cash')
  const [cashPart, setCashPart] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, startLoad] = useTransition()
  const [saving, startSave] = useTransition()

  const load = () =>
    startLoad(async () => {
      setLoadError(null)
      const r = await payPrefillAction(slug, bookingId)
      if (!r?.ok) {
        setLoadError((r && resultText(t, r)) || t('errors.generic'))
        return
      }
      const data = r.data as Loaded
      setLoaded(data)
      setPrices(Object.fromEntries(data.prefill.lines.map((l) => [l.key, String(l.unitPriceAed)])))
      setCommission(
        Object.fromEntries(
          data.prefill.commissions.map((c) => [`${c.bookingItemId}:${c.staffId}`, String(c.amountAed)]),
        ),
      )
      setMode('cash')
      setCashPart('')
      setError(null)
    })

  const lines = loaded?.prefill.lines ?? []
  const typed = lines.map((l) => fils(prices[l.key] ?? ''))
  const total = typed.reduce<number>((s, v) => s + (v ?? 0), 0)
  const cash = mode === 'cash' ? total : mode === 'card' ? 0 : Math.min(fils(cashPart) ?? 0, total)
  const card = total - cash
  const p = loaded?.prefill
  const blocked = p
    ? p.paid
      ? t('bookings.pay.paidAlready')
      : !OK.includes(p.status)
        ? t('bookings.pay.blocked', { status: enumLabel(t, 'bookingStatus', p.status).toLowerCase() })
        : p.dayLocked
          ? t('bookings.order.closedNote')
          : null
    : null

  const save = () => {
    if (!loaded || !p) return
    if (typed.some((v) => v === null)) {
      setError(t('sales.v.priceRequired'))
      return
    }
    startSave(async () => {
      setError(null)
      const r = await createSaleAction(slug, {
        branchId: loaded.branchId,
        bookingId,
        clientId: p.client?.id ?? null,
        newClient: null,
        lines: lines.map((l, i) => ({
          kind: l.kind,
          refId: l.refId,
          clientPackageId: null,
          membership: null,
          description: l.description,
          qty: l.qty,
          unitPriceAed: (typed[i] ?? 0) / 100,
          discountAed: 0,
          staffId: l.staffId,
        })),
        discountAed: 0,
        payments: [
          ...(cash > 0 ? [{ method: 'cash' as const, amountAed: cash / 100 }] : []),
          ...(card > 0 ? [{ method: 'card_terminal' as const, amountAed: card / 100 }] : []),
        ],
        tips: [],
        // Blank = the booking's planned amount (the server refuses when there is none).
        commissions: p.commissions.flatMap((c) => {
          const v = fils(commission[`${c.bookingItemId}:${c.staffId}`] ?? '')
          return v === null
            ? []
            : [{ bookingItemId: c.bookingItemId, staffId: c.staffId, amountAed: v / 100 }]
        }),
      })
      if (r?.ok) {
        toast.success(resultText(t, r) || t('sales.toast.recordedPlain'))
        setOpen(false)
        router.refresh()
      } else if (r) {
        const field = Object.values(r.fieldErrors ?? {})[0]
        setError((field && t.maybe(field)) || resultText(t, r) || t('errors.generic'))
      }
    })
  }

  const choice = (m: Mode, text: string) => (
    <Button
      type="button"
      size="sm"
      variant={mode === m ? 'primary' : 'secondary'}
      aria-pressed={mode === m}
      onClick={() => setMode(m)}
    >
      {text}
    </Button>
  )

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        className={className}
        onClick={() => {
          setOpen(true)
          load()
        }}
      >
        <Receipt /> {label}
      </Button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title={t('bookings.pay.title', { ref: refCode })}
        description={t('bookings.pay.sub')}
      >
        {loading || (!loaded && !loadError) ? (
          <p className="crm-muted text-sm">{t('bookings.pay.loading')}</p>
        ) : loadError ? (
          <Note tone="warn">{loadError}</Note>
        ) : blocked ? (
          <Note tone="warn">{blocked}</Note>
        ) : (
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault()
              save()
            }}
          >
            {p?.client && (
              <p className="text-sm">
                <b>{p.client.name}</b>
                {p.client.phone && <span className="crm-muted"> · {p.client.phone}</span>}
              </p>
            )}
            <div className="space-y-3">
              {lines.map((l) => (
                <div key={l.key} className="grid grid-cols-[1fr_8rem] items-end gap-3">
                  <div className="min-w-0 text-sm">
                    <p className="truncate font-medium">{l.description}</p>
                    {l.staffId && <p className="crm-muted truncate">{loaded?.names[l.staffId] ?? '—'}</p>}
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`pay-${l.key}`}>{t('bookings.pay.price')}</Label>
                    <Input
                      id={`pay-${l.key}`}
                      inputMode="decimal"
                      required
                      value={prices[l.key] ?? ''}
                      onChange={(e) => setPrices((v) => ({ ...v, [l.key]: e.target.value }))}
                      className="h-11 tabular-nums"
                    />
                  </div>
                </div>
              ))}
              <p className="flex justify-between border-t border-[var(--crm-line)] pt-3 text-base font-semibold">
                <span>{t('bookings.pay.total')}</span>
                <span className="tabular-nums">{fmt.aed(total / 100)}</span>
              </p>
            </div>

            <fieldset className="space-y-3">
              <legend className="mb-2 text-sm font-medium">{t('bookings.pay.method')}</legend>
              <div className="flex flex-wrap gap-2">
                {choice('cash', t('bookings.pay.cash'))}
                {choice('card', t('bookings.pay.card'))}
                {choice('split', t('bookings.pay.split'))}
              </div>
              {mode === 'split' && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="pay-cash">{t('bookings.pay.cashPart')}</Label>
                    <Input
                      id="pay-cash"
                      inputMode="decimal"
                      value={cashPart}
                      onChange={(e) => setCashPart(e.target.value)}
                      className="h-11 tabular-nums"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="pay-card">{t('bookings.pay.cardPart')}</Label>
                    <Input
                      id="pay-card"
                      value={(card / 100).toFixed(2)}
                      readOnly
                      className="h-11 tabular-nums"
                    />
                  </div>
                </div>
              )}
            </fieldset>

            {p && p.commissions.length > 0 && (
              <fieldset className="space-y-3">
                <legend className="mb-1 text-sm font-medium">{t('bookings.pay.commission')}</legend>
                <p className="crm-muted text-[length:var(--crm-fs-sub)]">
                  {t('bookings.pay.commissionHint')}
                </p>
                {p.commissions.map((c) => {
                  const key = `${c.bookingItemId}:${c.staffId}`
                  return (
                    <div key={key} className="grid grid-cols-[1fr_8rem] items-center gap-3">
                      <Label htmlFor={`com-${key}`} className="truncate font-normal">
                        {t('bookings.pay.commissionFor', { name: c.name, service: c.service })}
                      </Label>
                      <Input
                        id={`com-${key}`}
                        inputMode="decimal"
                        value={commission[key] ?? ''}
                        onChange={(e) => setCommission((v) => ({ ...v, [key]: e.target.value }))}
                        className="h-11 tabular-nums"
                      />
                    </div>
                  )
                })}
              </fieldset>
            )}

            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Link href={checkoutHref} className="text-sm font-medium text-accent hover:underline">
                {t('bookings.pay.more')}
              </Link>
              <Button type="submit" pending={saving} disabled={saving}>
                {t('bookings.pay.save')}
              </Button>
            </div>
          </form>
        )}
      </Sheet>
    </>
  )
}
