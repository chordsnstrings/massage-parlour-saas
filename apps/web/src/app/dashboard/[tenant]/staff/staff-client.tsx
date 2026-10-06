'use client'
import { CalendarPlus, Moon, Pencil, Plus, Trash2 } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useRouter } from 'next/navigation'
import { Fragment, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ActionForm, Field, FieldError, SubmitButton, useFormCtx } from '@/components/ui/form'
import { Checkbox, Input, Select } from '@/components/ui/input'
import { Sheet } from '@/components/ui/sheet'
import { appPath } from '@/lib/paths'
import { cn } from '@/lib/utils'
import { ChipCheckbox, ColorPicker, Toggle, useConfirmAction } from '../services/services-client'
import { deleteShiftAction, deleteStaffAction, generateShiftsAction, saveStaffAction } from './actions'

type MemberOption = { id: string; name: string; email: string }
type ServiceOption = { id: string; name: string; active: boolean }

export type StaffInput = {
  id: string
  displayName: string
  gender: 'female' | 'male' | 'other' | null
  phoneE164: string | null
  color: string
  bookable: boolean
  active: boolean
  commissionPct: number
  baseSalaryAed: number
  memberId: string | null
  skills: string[]
}

export function StaffSheet({
  slug,
  members,
  services,
  person,
}: {
  slug: string
  members: MemberOption[]
  services: ServiceOption[]
  person?: StaffInput
}) {
  const [open, setOpen] = useState(false)
  const router = useRouter()
  const { pending, run } = useConfirmAction()
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={person ? `Edit ${person.displayName}` : 'New therapist'}
      description="Shown on the calendar and, if bookable, on your booking page."
      className="md:max-w-2xl"
      trigger={
        person ? (
          <Button variant="secondary">
            <Pencil /> Edit profile
          </Button>
        ) : (
          <Button>
            <Plus /> Add therapist
          </Button>
        )
      }
    >
      <ActionForm
        action={saveStaffAction.bind(null, slug)}
        className="space-y-6"
        onSuccess={(r) => {
          setOpen(false)
          const id = (r.data as { id?: string } | undefined)?.id
          if (!person && id) router.push(appPath(`/${slug}/staff/${id}`))
        }}
      >
        <input type="hidden" name="id" value={person?.id ?? ''} />
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Display name" name="displayName" hint="First name is enough — clients see it.">
            <Input
              id="displayName"
              name="displayName"
              defaultValue={person?.displayName}
              placeholder="Maya"
              required
            />
          </Field>
          <Field label="Gender" name="gender" hint="Clients often ask for a female or male therapist.">
            <Select id="gender" name="gender" defaultValue={person?.gender ?? ''}>
              <option value="">Not set</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="other">Other</option>
            </Select>
          </Field>
          <Field label="UAE mobile" name="phone">
            <Input
              id="phone"
              name="phone"
              type="tel"
              inputMode="tel"
              defaultValue={person?.phoneE164 ? `+${person.phoneE164}` : ''}
              placeholder="050 123 4567"
            />
          </Field>
          <Field
            label="Team member login"
            name="memberId"
            hint="Optional — lets them see their own schedule."
          >
            <Select id="memberId" name="memberId" defaultValue={person?.memberId ?? ''}>
              <option value="">Not linked</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.email})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Commission" name="commissionPct" hint="Percent of service sales.">
            <div className="relative">
              <Input
                id="commissionPct"
                name="commissionPct"
                inputMode="decimal"
                defaultValue={person?.commissionPct ?? 0}
                className="pe-9 tabular-nums"
              />
              <span className="pointer-events-none absolute inset-y-0 end-3 grid place-items-center text-sm text-muted">
                %
              </span>
            </div>
          </Field>
          <Field label="Base salary" name="baseSalaryAed" hint="Monthly, in AED.">
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 start-3 grid place-items-center text-sm text-muted">
                AED
              </span>
              <Input
                id="baseSalaryAed"
                name="baseSalaryAed"
                inputMode="decimal"
                defaultValue={person?.baseSalaryAed ?? 0}
                className="ps-12 tabular-nums"
              />
            </div>
          </Field>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-[13px] font-medium">Colour on the calendar</legend>
          <ColorPicker name="color" defaultValue={person?.color} />
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-[13px] font-medium">Skills</legend>
          {services.length === 0 ? (
            <p className="text-[13px] text-muted">
              Add services first, then choose what this therapist performs.
            </p>
          ) : (
            <>
              <p className="text-[13px] text-muted">Only these services can be booked with them.</p>
              <div className="flex flex-wrap gap-2 pt-1">
                {services.map((s) => (
                  <ChipCheckbox
                    key={s.id}
                    name="skills"
                    value={s.id}
                    label={s.active ? s.name : `${s.name} (inactive)`}
                    defaultChecked={person ? person.skills.includes(s.id) : s.active}
                  />
                ))}
              </div>
            </>
          )}
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <Toggle
            name="bookable"
            label="Bookable"
            hint="Appears on the calendar and booking page."
            defaultChecked={person?.bookable ?? true}
          />
          <Toggle
            name="active"
            label="Active"
            hint="Archived staff keep their history."
            defaultChecked={person?.active ?? true}
          />
        </div>

        <div className="flex flex-col-reverse gap-2 border-t pt-5 sm:flex-row sm:justify-between">
          {person?.active ? (
            <Button
              type="button"
              variant="ghost"
              className="text-danger"
              pending={pending}
              onClick={() =>
                run(
                  `Archive ${person.displayName}? They’ll no longer be bookable.`,
                  () => deleteStaffAction(slug, person.id),
                  () => setOpen(false),
                )
              }
            >
              <Trash2 /> Archive
            </Button>
          ) : (
            <span />
          )}
          <SubmitButton>{person ? 'Save' : 'Add therapist'}</SubmitButton>
        </div>
      </ActionForm>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// Weekly pattern → shifts
// ---------------------------------------------------------------------------

const DAYS = [
  ['mon', 'Monday'],
  ['tue', 'Tuesday'],
  ['wed', 'Wednesday'],
  ['thu', 'Thursday'],
  ['fri', 'Friday'],
  ['sat', 'Saturday'],
  ['sun', 'Sunday'],
] as const

/**
 * React resets a form after its action completes, which leaves controlled checkboxes showing their
 * initial state. Remounting the controls after each submit re-syncs the DOM with component state.
 */
function ResyncAfterSubmit({ children }: { children: React.ReactNode }) {
  const { pending } = useFormCtx()
  const [version, setVersion] = useState(0)
  const was = useRef(false)
  useEffect(() => {
    if (was.current && !pending) setVersion((v) => v + 1)
    was.current = pending
  }, [pending])
  return <Fragment key={version}>{children}</Fragment>
}

type DayKey = (typeof DAYS)[number][0]
type DayState = { on: boolean; start: string; end: string }

export function PatternForm({
  slug,
  staffId,
  branches,
  from,
  to,
  initial,
}: {
  slug: string
  staffId: string
  branches: { id: string; name: string }[]
  from: string
  to: string
  initial?: Partial<Record<DayKey, { start: string; end: string }>>
}) {
  const [days, setDays] = useState<Record<DayKey, DayState>>(() => {
    const hasInitial = initial && Object.keys(initial).length > 0
    return Object.fromEntries(
      DAYS.map(([k]) => {
        const i = initial?.[k]
        return [k, { on: hasInitial ? Boolean(i) : true, start: i?.start ?? '10:00', end: i?.end ?? '22:00' }]
      }),
    ) as Record<DayKey, DayState>
  })
  const set = (k: DayKey, patch: Partial<DayState>) => setDays((d) => ({ ...d, [k]: { ...d[k], ...patch } }))
  const copyFirst = () => {
    const first = DAYS.map(([k]) => days[k]).find((d) => d.on)
    if (!first) return
    setDays(
      (d) =>
        Object.fromEntries(
          DAYS.map(([k]) => [k, d[k].on ? { ...d[k], start: first.start, end: first.end } : d[k]]),
        ) as Record<DayKey, DayState>,
    )
  }

  return (
    <ActionForm action={generateShiftsAction.bind(null, slug)} className="space-y-6">
      <input type="hidden" name="staffId" value={staffId} />
      <div className={cn('grid gap-5', branches.length > 1 ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
        <Field label="From" name="from">
          <Input id="from" name="from" type="date" defaultValue={from} required />
        </Field>
        <Field label="Until" name="to">
          <Input id="to" name="to" type="date" defaultValue={to} required />
        </Field>
        {branches.length > 1 ? (
          <Field label="Branch" name="branchId">
            <Select id="branchId" name="branchId" defaultValue={branches[0]?.id}>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <input type="hidden" name="branchId" value={branches[0]?.id ?? ''} />
        )}
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[13px] font-medium">Working days</p>
          <Button type="button" variant="ghost" size="sm" onClick={copyFirst}>
            Copy first day to all
          </Button>
        </div>
        <ResyncAfterSubmit>
          <ul className="divide-y rounded-xl border">
            {DAYS.map(([k, label]) => {
              const d = days[k]
              const overnight = d.on && d.end <= d.start && d.end !== d.start
              return (
                <li
                  key={k}
                  className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2 px-3 py-3 sm:px-4 sm:grid-cols-[10rem_1fr]"
                >
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 sm:min-h-0">
                    <Checkbox
                      name={`${k}_on`}
                      checked={d.on}
                      onChange={(e) => set(k, { on: e.target.checked })}
                      aria-label={`Works on ${label}`}
                    />
                    <span className={cn('text-sm font-medium', !d.on && 'text-muted')}>{label}</span>
                  </label>
                  <AnimatePresence initial={false} mode="wait">
                    {d.on ? (
                      <motion.div
                        key="on"
                        initial={{ opacity: 0, x: 6 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0 }}
                        className="col-span-2 flex flex-wrap items-center gap-2 sm:col-span-1"
                      >
                        <Input
                          type="time"
                          name={`${k}_start`}
                          aria-label={`${label} start`}
                          value={d.start}
                          onChange={(e) => set(k, { start: e.target.value })}
                          className="min-w-0 flex-1 px-2.5 sm:w-36 sm:flex-none sm:px-3"
                        />
                        <span className="text-muted">–</span>
                        <Input
                          type="time"
                          name={`${k}_end`}
                          aria-label={`${label} end`}
                          value={d.end}
                          onChange={(e) => set(k, { end: e.target.value })}
                          className="min-w-0 flex-1 px-2.5 sm:w-36 sm:flex-none sm:px-3"
                        />
                        {overnight && (
                          <span className="flex basis-full items-center gap-1 text-[13px] text-muted sm:basis-auto">
                            <Moon className="size-3.5" /> next day
                          </span>
                        )}
                        <FieldError name={k} />
                      </motion.div>
                    ) : (
                      <motion.span
                        key="off"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="text-end text-sm text-muted sm:text-start"
                      >
                        Day off
                      </motion.span>
                    )}
                  </AnimatePresence>
                </li>
              )
            })}
          </ul>
        </ResyncAfterSubmit>
        <FieldError name="pattern" />
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[13px] text-muted">Days that already have an overlapping shift are skipped.</p>
        <SubmitButton>
          <CalendarPlus /> Generate shifts
        </SubmitButton>
      </div>
    </ActionForm>
  )
}

export function DeleteShiftButton({
  slug,
  shiftId,
  label,
}: {
  slug: string
  shiftId: string
  label: string
}) {
  const { pending, run } = useConfirmAction()
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Delete shift ${label}`}
      pending={pending}
      onClick={() => run(null, () => deleteShiftAction(slug, shiftId))}
    >
      <Trash2 />
    </Button>
  )
}
