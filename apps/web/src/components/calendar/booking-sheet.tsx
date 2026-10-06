'use client'
import { canTransition } from '@spa/core'
import { ArrowRightLeft, MessageCircle, Phone, Receipt } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import Link from 'next/link'
import { useRef, useState, useTransition } from 'react'
import { rescheduleFormAction, setStatusAction } from '@/app/dashboard/[tenant]/calendar/actions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { Input, Select } from '@/components/ui/input'
import { Sheet } from '@/components/ui/sheet'
import { toast } from '@/components/ui/toast'
import { formatAed } from '@/lib/utils'
import { minuteLabel, SOURCE_LABEL, STATUS_LABEL, STATUS_TONE } from './time'
import type { BookingStatus, CalendarData, CalItem } from './types'

type Target = Exclude<BookingStatus, 'pending'>

const ACTIONS: { to: Target; label: string; variant: 'primary' | 'secondary' | 'danger' }[] = [
  { to: 'confirmed', label: 'Confirm', variant: 'primary' },
  { to: 'checked_in', label: 'Check in', variant: 'primary' },
  { to: 'in_service', label: 'Start service', variant: 'secondary' },
  { to: 'completed', label: 'Complete', variant: 'secondary' },
  { to: 'no_show', label: 'No-show', variant: 'secondary' },
  { to: 'cancelled', label: 'Cancel…', variant: 'danger' },
]

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
  // Keep the last booking on screen while the sheet animates closed.
  const last = useRef<CalItem[]>([])
  if (items.length) last.current = items
  const shown = items.length ? items : last.current
  const first = shown[0]
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={first?.clientName ?? 'Walk-in'}
      description={first ? `Ref ${first.refCode} · ${SOURCE_LABEL[first.source] ?? first.source}` : undefined}
    >
      {first && <Details key={first.bookingId} data={data} items={shown} />}
    </Sheet>
  )
}

function Details({ data, items }: { data: CalendarData; items: CalItem[] }) {
  const first = items[0]!
  const status = first.status
  const [pending, start] = useTransition()
  const [busy, setBusy] = useState<Target | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [reason, setReason] = useState('')
  const [moving, setMoving] = useState(false)
  const movable = data.canManage && !['completed', 'cancelled', 'no_show'].includes(status)
  const actions = data.canManage ? ACTIONS.filter((a) => canTransition(status, a.to)) : []

  const change = (to: Target, why?: string) => {
    setBusy(to)
    start(async () => {
      const r = await setStatusAction(data.slug, { bookingId: first.bookingId, status: to, reason: why })
      setBusy(null)
      if (r?.ok) {
        toast.success(r.message ?? 'Updated')
        setCancelling(false)
      } else if (r) toast.error(r.error)
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
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
            <MessageCircle className="size-3.5" /> Chat
          </a>
        )}
      </div>

      <ul className="divide-y rounded-xl border">
        {items.map((it) => (
          <li key={it.id} className="flex items-start justify-between gap-4 px-4 py-3.5">
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-medium">{it.serviceName}</p>
              <p className="text-[13px] text-muted tabular">
                {minuteLabel(it.startMin)}–{minuteLabel(it.endMin)} · {it.durationMin} min
              </p>
              <p className="text-[13px] text-muted">
                {it.staffIds.map((id) => data.staffNames[id]?.name ?? 'Therapist').join(' & ') ||
                  'No therapist'}
                {it.roomId ? ` · ${data.rooms.find((r) => r.id === it.roomId)?.name ?? 'Room'}` : ''}
              </p>
            </div>
            <p className="shrink-0 text-sm font-medium tabular">{formatAed(it.priceAed)}</p>
          </li>
        ))}
      </ul>

      {(first.notes || first.cancelReason) && (
        <div className="space-y-1 rounded-xl bg-subtle/60 px-4 py-3 text-sm">
          {first.notes && <p>{first.notes}</p>}
          {first.cancelReason && <p className="text-muted">Cancelled: {first.cancelReason}</p>}
        </div>
      )}

      {actions.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted">Status</p>
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
                {a.label}
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
                    aria-label="Cancellation reason"
                    placeholder="Reason, e.g. client asked to cancel"
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
                    Cancel booking
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
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
            <ArrowRightLeft className="size-4" strokeWidth={1.5} /> Reschedule
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

      {data.canCheckout && status !== 'cancelled' && status !== 'no_show' && (
        <Button
          asChild
          variant={status === 'completed' ? 'primary' : 'secondary'}
          size="lg"
          className="w-full"
        >
          <Link href={`${data.checkoutBase}?booking=${first.bookingId}`}>
            <Receipt /> Check out
          </Link>
        </Button>
      )}
    </div>
  )
}

function MoveForm({ data, items, onDone }: { data: CalendarData; items: CalItem[]; onDone: () => void }) {
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
        <Field label="Service" name="item">
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
        <Field label="Date" name="date">
          <Input id="date" name="date" type="date" defaultValue={data.date} className="tabular" />
        </Field>
        <Field label="Time" name="time">
          <Input
            id="time"
            name="time"
            type="time"
            step={300}
            defaultValue={minuteLabel(item.startMin)}
            className="tabular"
          />
        </Field>
        <Field label="Therapist" name="staffId">
          <Select id="staffId" name="staffId" defaultValue={mainStaff}>
            {data.staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Room" name="roomId">
          <Select id="roomId" name="roomId" defaultValue={item.roomId ?? ''}>
            {data.rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <SubmitButton className="w-full sm:w-auto">Move booking</SubmitButton>
    </ActionForm>
  )
}
