'use client'
import { canTransition, sheetCode } from '@spa/core'
import { bookingSourceLabel, enumLabel } from '@spa/core/i18n'
import {
  ArrowRightLeft,
  ClipboardList,
  MessageCircle,
  Phone,
  Receipt,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import Link from 'next/link'
import { useRef, useState, useTransition } from 'react'
import {
  deleteBookingAction,
  rescheduleFormAction,
  setOwnStatusAction,
  setStatusAction,
} from '@/app/dashboard/[tenant]/calendar/actions'
import { DetailsForm, TermsForm, type TermsItem } from '@/components/bookings/order-forms'
import { Note, Pill, statusTone } from '@/components/crm'
import { Button } from '@/components/ui/button'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { Input, Select } from '@/components/ui/input'
import { Sheet } from '@/components/ui/sheet'
import { toast } from '@/components/ui/toast'
import { resultText, useI18n, useT } from '@/i18n/client'
import { minuteLabel } from './time'
import type { BookingStatus, CalendarData, CalItem } from './types'

type Target = Exclude<BookingStatus, 'pending' | 'completed'>

const ACTIONS: { to: Target; variant: 'primary' | 'secondary' | 'danger' }[] = [
  { to: 'confirmed', variant: 'primary' },
  { to: 'checked_in', variant: 'primary' },
  { to: 'in_service', variant: 'secondary' },
  { to: 'no_show', variant: 'secondary' },
  { to: 'cancelled', variant: 'danger' },
]

const PENDING_TARGETS: Target[] = ['no_show', 'cancelled']

type OwnTarget = 'checked_in' | 'in_service' | 'completed'
/** A therapist's own booking (G14): check in → start → complete; never confirm, cancel or move. */
const OWN_ACTIONS: { to: OwnTarget; variant: 'primary' | 'secondary' }[] = [
  { to: 'checked_in', variant: 'primary' },
  { to: 'in_service', variant: 'primary' },
  { to: 'completed', variant: 'secondary' },
]
const OWN_FROM: BookingStatus[] = ['confirmed', 'checked_in', 'in_service']

export function BookingSheet({
  data,
  items,
  open,
  onOpenChange,
}: {
  data: CalendarData
  items: CalItem[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const t = useT()
  // Keep the last booking on screen while the sheet animates closed.
  const last = useRef<CalItem[]>([])
  if (items.length) last.current = items
  const shown = items.length ? items : last.current
  const first = shown[0]
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={first?.clientName ?? t('calendar.walkIn')}
      description={
        first
          ? t('calendar.details.ref', {
              ref: first.refCode,
              source: bookingSourceLabel(t, first.source, first.attribution),
            })
          : undefined
      }
    >
      {first && (
        <Details key={first.bookingId} data={data} items={shown} onDeleted={() => onOpenChange(false)} />
      )}
    </Sheet>
  )
}

function Details({
  data,
  items,
  onDeleted,
}: {
  data: CalendarData
  items: CalItem[]
  onDeleted: () => void
}) {
  const { t, fmt } = useI18n()
  const first = items[0]!
  const status = first.status
  const [pending, start] = useTransition()
  const [busy, setBusy] = useState<Target | OwnTarget | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [reason, setReason] = useState('')
  const [moving, setMoving] = useState(false)
  const [editing, setEditing] = useState<'terms' | 'details' | null>(null)
  const movable = data.canManage && !['completed', 'cancelled', 'no_show'].includes(status)
  // R32: a pending booking goes forward only through Confirm (fee + commission, the form below) — it can still be
  // cancelled or marked no-show; completing = Finish & pay.
  const actions =
    data.canManage && status !== 'completed'
      ? ACTIONS.filter(
          (a) => canTransition(status, a.to) && (status !== 'pending' || PENDING_TARGETS.includes(a.to)),
        )
      : []
  const live = status !== 'cancelled' && status !== 'no_show'
  const paid = first.saleId !== null
  const canEdit = data.canManage && live && !data.editLocked
  // Prefill: the typed fee/commission, else the last amounts used for the treatment, else the list price.
  const termsItems: TermsItem[] = items.map((i) => {
    const v = data.variants.find((x) => x.id === i.variantId)
    return {
      id: i.id,
      serviceName: i.serviceName,
      feeAed: i.termsSet ? i.priceAed : (v?.lastFeeAed ?? i.priceAed),
      commissionAed: i.commissionAed ?? v?.lastCommissionAed ?? null,
    }
  })
  const mine =
    !data.canManage &&
    data.ownStatusStaffId !== null &&
    items.some((i) => i.staffIds.includes(data.ownStatusStaffId!))
  const ownActions =
    mine && OWN_FROM.includes(status) ? OWN_ACTIONS.filter((a) => canTransition(status, a.to)) : []

  const changeOwn = (to: OwnTarget) => {
    setBusy(to)
    start(async () => {
      const r = await setOwnStatusAction(data.slug, { bookingId: first.bookingId, status: to })
      setBusy(null)
      if (r?.ok) toast.success(resultText(t, r) ?? t('calendar.updated'))
      else if (r) toast.error(resultText(t, r) ?? r.error ?? '')
    })
  }

  // R39: same people as cancel; the server refuses a booking with a payment or commission.
  const removable = data.canManage && !paid && !data.editLocked
  const remove = () => {
    start(async () => {
      const r = await deleteBookingAction(data.slug, first.bookingId)
      if (r?.ok) {
        toast.success(resultText(t, r) ?? t('calendar.updated'))
        onDeleted()
      } else if (r) {
        setDeleting(false)
        toast.error(resultText(t, r) ?? r.error ?? '')
      }
    })
  }

  const change = (to: Target, why?: string) => {
    setBusy(to)
    start(async () => {
      const r = await setStatusAction(data.slug, { bookingId: first.bookingId, status: to, reason: why })
      setBusy(null)
      if (r?.ok) {
        toast.success(resultText(t, r) ?? t('calendar.updated'))
        setCancelling(false)
      } else if (r) toast.error(resultText(t, r) ?? r.error ?? '')
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={statusTone(status)}>{enumLabel(t, 'bookingStatus', status)}</Pill>
        <Pill>{sheetCode(first)}</Pill>
        {first.ownLead && <Pill tone="own">{t('calendar.sheet.ownClient')}</Pill>}
        {first.clientPhone && (
          <span className="inline-flex items-center gap-1.5 text-sm text-muted tabular">
            <Phone className="size-3.5" strokeWidth={1.5} /> {first.clientPhone}
          </span>
        )}
        {first.clientWhatsapp && (
          <a
            href={first.clientWhatsapp}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-9 items-center gap-1.5 text-sm font-medium text-accent hover:underline"
          >
            <MessageCircle className="size-3.5" /> {t('calendar.details.chat')}
          </a>
        )}
      </div>

      <ul className="divide-y rounded-xl border">
        {items.map((it) => (
          <li key={it.id} className="flex items-start justify-between gap-4 px-4 py-3.5">
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-medium">{it.serviceName}</p>
              <p className="text-[13px] text-muted tabular">
                {minuteLabel(it.startMin)}–{minuteLabel(it.endMin)} ·{' '}
                {t('calendar.minutes', { min: it.durationMin })}
              </p>
              <p className="text-[13px] text-muted">
                {it.staffIds
                  .map((id) => data.staffNames[id]?.name ?? t('calendar.details.therapist'))
                  .join(' & ') || t('calendar.details.noTherapist')}
                {it.roomId
                  ? ` · ${data.rooms.find((r) => r.id === it.roomId)?.name ?? t('calendar.details.room')}`
                  : ''}
                {it.equipment.length ? ` · ${it.equipment.join(', ')}` : ''}
              </p>
              {it.equipmentMissing.length > 0 && (
                <p className="text-[13px] font-medium text-danger" role="note">
                  {t('equipment.calendar.conflict', { types: it.equipmentMissing.join(', ') })}
                </p>
              )}
            </div>
            <p className="shrink-0 text-sm font-medium tabular">
              {it.priceAed == null ? t('common.priceOnRequest') : fmt.aed(it.priceAed)}
            </p>
          </li>
        ))}
      </ul>

      {(first.notes || first.cancelReason) && (
        <div className="space-y-1 rounded-xl bg-subtle/60 px-4 py-3 text-sm">
          {first.notes && <p>{first.notes}</p>}
          {first.cancelReason && (
            <p className="text-muted">{t('calendar.details.cancelled', { reason: first.cancelReason })}</p>
          )}
        </div>
      )}

      {data.canManage && live && data.editLocked && <Note>{t('calendar.sheet.closedNote')}</Note>}
      {status === 'completed' && !paid && <Note tone="warn">{t('calendar.sheet.notPaid')}</Note>}
      {paid && (
        <Link
          href={`${data.salesBase}/${first.saleId}`}
          className="inline-flex min-h-9 items-center gap-2 text-sm font-medium text-accent hover:underline"
        >
          <Receipt className="size-4" strokeWidth={1.5} />{' '}
          {t('calendar.sheet.sale', { number: first.saleNumber ?? '' })}
        </Link>
      )}

      {canEdit && status === 'pending' && (
        <div className="space-y-3 rounded-xl border p-4">
          <p className="text-sm font-medium">{t('calendar.sheet.confirm')}</p>
          <TermsForm
            slug={data.slug}
            bookingId={first.bookingId}
            items={termsItems}
            canCommission={data.canCommission}
            confirm
          />
        </div>
      )}

      {canEdit && (
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {!paid && status !== 'pending' && (
            <button
              type="button"
              onClick={() => setEditing((e) => (e === 'terms' ? null : 'terms'))}
              aria-expanded={editing === 'terms'}
              className="inline-flex min-h-9 items-center gap-2 text-sm font-medium text-accent hover:underline"
            >
              <Receipt className="size-4" strokeWidth={1.5} /> {t('calendar.sheet.terms')}
            </button>
          )}
          <button
            type="button"
            onClick={() => setEditing((e) => (e === 'details' ? null : 'details'))}
            aria-expanded={editing === 'details'}
            className="inline-flex min-h-9 items-center gap-2 text-sm font-medium text-accent hover:underline"
          >
            <SlidersHorizontal className="size-4" strokeWidth={1.5} /> {t('calendar.sheet.details')}
          </button>
        </div>
      )}
      {canEdit && editing === 'terms' && !paid && status !== 'pending' && (
        <div className="rounded-xl border p-4">
          <TermsForm
            slug={data.slug}
            bookingId={first.bookingId}
            items={termsItems}
            canCommission={data.canCommission}
            onDone={() => setEditing(null)}
          />
        </div>
      )}
      {canEdit && editing === 'details' && (
        <div className="rounded-xl border p-4">
          <DetailsForm
            slug={data.slug}
            bookingId={first.bookingId}
            source={first.source}
            phoneLines={data.phoneLines}
            phoneLine={first.phoneLine}
            clientType={first.clientType}
            ownLead={first.ownLead}
            onDone={() => setEditing(null)}
          />
        </div>
      )}

      {actions.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted">
            {t('calendar.details.status')}
          </p>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            {actions.map((a) => (
              <Button
                key={a.to}
                variant={a.variant}
                size="lg"
                className="sm:h-10 sm:text-sm"
                pending={pending && busy === a.to}
                disabled={pending}
                onClick={() => (a.to === 'cancelled' ? setCancelling((c) => !c) : change(a.to))}
              >
                {t(`calendar.details.actions.${a.to}`)}
              </Button>
            ))}
          </div>
          <AnimatePresence initial={false}>
            {cancelling && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="flex flex-col gap-2 pt-1 sm:flex-row">
                  <Input
                    aria-label={t('calendar.details.reasonLabel')}
                    placeholder={t('calendar.details.reasonPlaceholder')}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    autoFocus
                  />
                  <Button
                    variant="danger"
                    disabled={!reason.trim() || pending}
                    pending={pending && busy === 'cancelled'}
                    onClick={() => change('cancelled', reason.trim())}
                  >
                    {t('calendar.details.cancelBooking')}
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {ownActions.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted">
            {t('calendar.details.status')}
          </p>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            {ownActions.map((a) => (
              <Button
                key={a.to}
                variant={a.variant}
                size="lg"
                className="sm:h-10 sm:text-sm"
                pending={pending && busy === a.to}
                disabled={pending}
                onClick={() => changeOwn(a.to)}
              >
                {t(`calendar.details.actions.${a.to}`)}
              </Button>
            ))}
          </div>
        </div>
      )}

      {movable && (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setMoving((m) => !m)}
            aria-expanded={moving}
            className="inline-flex min-h-9 items-center gap-2 text-sm font-medium text-accent hover:underline"
          >
            <ArrowRightLeft className="size-4" strokeWidth={1.5} /> {t('calendar.details.reschedule')}
          </button>
          <AnimatePresence initial={false}>
            {moving && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <MoveForm data={data} items={items} onDone={() => setMoving(false)} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {data.canManage && (
        <Button asChild variant="secondary" size="lg" className="w-full">
          <Link href={`${data.bookingsBase}/${first.bookingId}`}>
            <ClipboardList /> {t('bookings.openBooking')}
          </Link>
        </Button>
      )}

      {data.canCheckout && live && !paid && status !== 'pending' && !data.editLocked && (
        <Button
          asChild
          variant={status === 'completed' ? 'primary' : 'secondary'}
          size="lg"
          className="w-full"
        >
          <Link href={`${data.checkoutBase}?booking=${first.bookingId}`}>
            <Receipt /> {t('calendar.sheet.finish')}
          </Link>
        </Button>
      )}

      {removable &&
        (deleting ? (
          <div className="space-y-2 rounded-md border border-danger/40 p-3">
            <p className="text-sm">{t('calendar.details.deleteConfirm')}</p>
            <div className="flex gap-2">
              <Button variant="danger" pending={pending} disabled={pending} onClick={remove}>
                {t('calendar.details.deleteYes')}
              </Button>
              <Button variant="secondary" disabled={pending} onClick={() => setDeleting(false)}>
                {t('calendar.details.deleteNo')}
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setDeleting(true)}
            disabled={pending}
            className="inline-flex min-h-9 items-center gap-2 text-sm font-medium text-danger hover:underline"
          >
            <Trash2 className="size-4" strokeWidth={1.5} /> {t('calendar.details.delete')}
          </button>
        ))}
    </div>
  )
}

function MoveForm({ data, items, onDone }: { data: CalendarData; items: CalItem[]; onDone: () => void }) {
  const t = useT()
  const [itemId, setItemId] = useState(items[0]!.id)
  const item = items.find((i) => i.id === itemId) ?? items[0]!
  const mainStaff = item.staffIds[0] ?? ''
  return (
    <ActionForm
      key={item.id}
      action={rescheduleFormAction.bind(null, data.slug)}
      onSuccess={onDone}
      className="space-y-4 rounded-xl border p-4"
    >
      <input type="hidden" name="itemId" value={item.id} />
      <input type="hidden" name="keepStaff" value={item.staffIds.slice(1).join(',')} />
      {items.length > 1 && (
        <Field label={t('calendar.fields.service')} name="item">
          <Select id="item" value={itemId} onChange={(e) => setItemId(e.target.value)}>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.serviceName} · {minuteLabel(i.startMin)}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('calendar.fields.date')} name="date">
          <Input id="date" name="date" type="date" defaultValue={data.date} className="tabular" />
        </Field>
        <Field label={t('calendar.fields.time')} name="time">
          <Input
            id="time"
            name="time"
            type="time"
            step={300}
            defaultValue={minuteLabel(item.startMin)}
            className="tabular"
          />
        </Field>
        <Field label={t('calendar.fields.therapist')} name="staffId">
          <Select id="staffId" name="staffId" defaultValue={mainStaff}>
            {data.staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('calendar.fields.room')} name="roomId">
          <Select id="roomId" name="roomId" defaultValue={item.roomId ?? ''}>
            {data.rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <SubmitButton className="w-full sm:w-auto">{t('calendar.details.move')}</SubmitButton>
    </ActionForm>
  )
}
