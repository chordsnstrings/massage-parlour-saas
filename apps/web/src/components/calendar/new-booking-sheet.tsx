'use client'
import { Check, Loader2, MessageCircle, Search, UserPlus, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState, useTransition } from 'react'
import { createBookingAction, searchClientsAction } from '@/app/dashboard/[tenant]/calendar/actions'
import { Button } from '@/components/ui/button'
import { ActionForm, Field, FieldError, SubmitButton } from '@/components/ui/form'
import { Input, Label, Select, Textarea } from '@/components/ui/input'
import { Sheet } from '@/components/ui/sheet'
import { spring } from '@/lib/motion'
import { cn } from '@/lib/utils'
import type { Draft } from './calendar-view'
import { minuteLabel, snap } from './time'
import type { CalendarData } from './types'

type ClientHit = { id: string; name: string; phone: string | null; blocked: boolean }
type Done = { ref: string; whatsapp: string | null; whatsappWeb: string | null }

/** Default start for a booking opened without a slot: next quarter hour (today) or the first grid hour. */
function defaultStart(data: CalendarData) {
  if (data.date !== data.today) return data.gridStart
  const now = (Date.now() - data.dayStartMs) / 60_000
  return Math.min(Math.max(snap(now + 7), data.gridStart), data.gridEnd - 15)
}

export function NewBookingSheet({
  data,
  draft,
  open,
  onOpenChange,
}: {
  data: CalendarData
  draft: Draft | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [done, setDone] = useState<Done | null>(null)
  const [mode, setMode] = useState<'search' | 'new'>('search')
  const [client, setClient] = useState<ClientHit | null>(null)
  const [startMin] = useState(() => draft?.startMin ?? defaultStart(data))
  const [coarse, setCoarse] = useState(false)
  useEffect(() => {
    setCoarse(window.matchMedia('(pointer: coarse)').matches)
  }, [])
  const staffName = draft?.staffId ? data.staffNames[draft.staffId]?.name : undefined

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={done ? 'Booking confirmed' : 'New booking'}
      description={
        done
          ? 'Send the confirmation from your WhatsApp.'
          : `${minuteLabel(startMin)}${staffName ? ` with ${staffName}` : ''}`
      }
    >
      <AnimatePresence mode="wait" initial={false}>
        {done ? (
          <motion.div
            key="done"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-5"
          >
            <div className="flex items-center gap-3 rounded-xl bg-accent-soft px-4 py-3.5">
              <motion.span
                initial={{ scale: 0.4, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={spring}
                className="grid size-9 place-items-center rounded-full bg-accent text-accent-fg"
              >
                <Check className="size-4" strokeWidth={2} />
              </motion.span>
              <div>
                <p className="text-sm font-medium">Reference {done.ref}</p>
                <p className="text-[13px] text-muted">A reminder is queued in the WhatsApp outbox.</p>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              {done.whatsapp ? (
                <Button asChild size="lg" className="sm:flex-1">
                  <a
                    href={(coarse ? done.whatsapp : done.whatsappWeb) ?? done.whatsapp}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <MessageCircle /> Send confirmation on WhatsApp
                  </a>
                </Button>
              ) : (
                <p className="text-sm text-muted">No mobile number on file, so there’s nothing to send.</p>
              )}
              <Button variant="secondary" size="lg" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </div>
          </motion.div>
        ) : (
          <motion.div key="form" exit={{ opacity: 0, y: -8 }}>
            <ActionForm
              action={createBookingAction.bind(null, data.slug)}
              className="space-y-5"
              onSuccess={(r) => setDone(r.data as Done)}
            >
              <input type="hidden" name="branchId" value={data.branchId} />
              <input type="hidden" name="date" value={data.date} />

              {mode === 'search' ? (
                <ClientSearch
                  slug={data.slug}
                  value={client}
                  onChange={setClient}
                  onNew={() => {
                    setClient(null)
                    setMode('new')
                  }}
                />
              ) : (
                <div className="space-y-4 rounded-xl border p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-[13px] font-medium">New client</p>
                    <button
                      type="button"
                      onClick={() => setMode('search')}
                      className="text-[13px] font-medium text-accent hover:underline"
                    >
                      Search instead
                    </button>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Name" name="clientName">
                      <Input id="clientName" name="clientName" autoComplete="off" autoFocus />
                    </Field>
                    <Field label="UAE mobile" name="clientPhone">
                      <Input
                        id="clientPhone"
                        name="clientPhone"
                        type="tel"
                        inputMode="tel"
                        placeholder="050 123 4567"
                      />
                    </Field>
                  </div>
                </div>
              )}

              <Field label="Service" name="variantId">
                <Select id="variantId" name="variantId" defaultValue={data.variants[0]?.id}>
                  {data.variants.length === 0 && <option value="">Add services first</option>}
                  {data.variants.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </Select>
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Time" name="time">
                  <Input
                    id="time"
                    name="time"
                    type="time"
                    step={300}
                    defaultValue={minuteLabel(startMin)}
                    className="tabular"
                  />
                </Field>
                <Field label="Source" name="source">
                  <Select id="source" name="source" defaultValue="phone">
                    <option value="phone">Phone</option>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="walk_in">Walk-in</option>
                    <option value="instagram">Instagram</option>
                  </Select>
                </Field>
                <Field label="Therapist" name="staffId">
                  <Select id="staffId" name="staffId" defaultValue={draft?.staffId ?? ''}>
                    <option value="">Any (automatic)</option>
                    {data.staff.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Room" name="roomId">
                  <Select id="roomId" name="roomId" defaultValue={draft?.roomId ?? ''}>
                    <option value="">Automatic</option>
                    {data.rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              <Field label="Notes" name="notes" hint="Pressure, focus areas, allergies…">
                <Textarea id="notes" name="notes" rows={2} className="min-h-16" />
              </Field>

              <SubmitButton size="lg" className="w-full">
                Create booking
              </SubmitButton>
            </ActionForm>
          </motion.div>
        )}
      </AnimatePresence>
    </Sheet>
  )
}

function ClientSearch({
  slug,
  value,
  onChange,
  onNew,
}: {
  slug: string
  value: ClientHit | null
  onChange: (c: ClientHit | null) => void
  onNew: () => void
}) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<ClientHit[]>([])
  const [pending, start] = useTransition()

  useEffect(() => {
    if (value || q.trim().length < 2) {
      setHits([])
      return
    }
    const t = setTimeout(
      () =>
        start(async () => {
          const r = await searchClientsAction(slug, q)
          setHits(r?.ok ? ((r.data?.clients as ClientHit[]) ?? []) : [])
        }),
      220,
    )
    return () => clearTimeout(t)
  }, [q, slug, value])

  if (value) {
    return (
      <div className="space-y-1.5">
        <Label>Client</Label>
        <input type="hidden" name="clientId" value={value.id} />
        <div className="flex items-center justify-between gap-3 rounded-lg border bg-subtle/50 px-3 py-2">
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{value.name}</span>
            {value.phone && <span className="block text-xs text-muted tabular">{value.phone}</span>}
          </span>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="grid size-9 place-items-center rounded-md text-muted hover:bg-subtle hover:text-fg"
            aria-label="Change client"
          >
            <X className="size-4" strokeWidth={1.5} />
          </button>
        </div>
        {value.blocked && <p className="text-[13px] text-danger">This client is on the blocklist.</p>}
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor="clientSearch">Client</Label>
      <div className="relative">
        <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <Input
          id="clientSearch"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name or mobile"
          autoComplete="off"
          className="ps-9"
          autoFocus
        />
        {pending && (
          <Loader2 className="absolute end-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted" />
        )}
      </div>
      <FieldError name="clientName" />
      <AnimatePresence initial={false}>
        {(hits.length > 0 || q.trim().length >= 2) && (
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
                  onClick={() => onChange(h)}
                  className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-start text-sm hover:bg-subtle"
                >
                  <span className={cn('truncate font-medium', h.blocked && 'text-danger')}>{h.name}</span>
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
        className="inline-flex min-h-9 items-center gap-1.5 text-[13px] font-medium text-accent hover:underline"
      >
        <UserPlus className="size-3.5" /> New client
      </button>
    </div>
  )
}
