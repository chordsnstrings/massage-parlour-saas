/**
 * Booking engine — pure functions (no DB). Times are absolute instants (Date); the business runs on
 * Asia/Dubai time (UTC+4, no DST). A "business date" ends at the branch cutoff (e.g. 05:00), so a
 * 01:30 treatment belongs to the previous day's books.
 */

export const DUBAI_OFFSET_MIN = 4 * 60
const MIN = 60_000

export type Interval = { start: Date; end: Date }
export type Weekday = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat'
export type OpeningHours = Partial<Record<Weekday, { open: string; close: string }[]>>
const WEEKDAYS: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

/** Dubai wall-clock date (YYYY-MM-DD) + minutes since midnight → instant. Minutes may exceed 1440. */
export function dubaiInstant(date: string, minutes: number): Date {
  const [y, mo, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y!, mo! - 1, d!, 0, minutes - DUBAI_OFFSET_MIN))
}

/** Dubai wall-clock parts of an instant. */
export function dubaiParts(instant: Date) {
  const local = new Date(instant.getTime() + DUBAI_OFFSET_MIN * MIN)
  const date = local.toISOString().slice(0, 10)
  return {
    date,
    minutes: local.getUTCHours() * 60 + local.getUTCMinutes(),
    weekday: WEEKDAYS[local.getUTCDay()]!,
  }
}

export const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Monday (ISO week start; UAE week Mon–Sun) of a YYYY-MM-DD date. */
export const weekStartOf = (date: string) =>
  addDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7))

/** Calendar month grid for the month containing `date`: Monday on/before the 1st → Sunday on/after the last day. */
export function monthGridRange(date: string) {
  const first = `${date.slice(0, 7)}-01`
  const d = new Date(`${first}T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + 1)
  d.setUTCDate(0)
  const last = d.toISOString().slice(0, 10)
  return { first, last, from: weekStartOf(first), to: addDays(weekStartOf(last), 6) }
}

/** Same day-of-month in the month `months` away, clamped to its length (31 Jan + 1 → 28/29 Feb). */
export function addMonths(date: string, months: number) {
  const [y, m, day] = date.split('-').map(Number)
  const target = new Date(Date.UTC(y!, m! - 1 + months, 1))
  const len = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(day!, len))
  return target.toISOString().slice(0, 10)
}

/** Business date of an instant given the branch cutoff ("HH:MM", e.g. "05:00"). */
export function businessDateOf(instant: Date, cutoff = '05:00'): string {
  const { date, minutes } = dubaiParts(instant)
  return minutes < toMin(cutoff) ? addDays(date, -1) : date
}

/** The instant range covered by a business date: [date cutoff, date+1 cutoff). */
export function businessDayWindow(date: string, cutoff = '05:00'): Interval {
  const c = toMin(cutoff)
  return { start: dubaiInstant(date, c), end: dubaiInstant(date, c + 1440) }
}

export const DEFAULT_HOURS: OpeningHours = Object.fromEntries(
  WEEKDAYS.map((d) => [d, [{ open: '10:00', close: '24:00' }]]),
)

/**
 * Opening intervals for a business date. A close time earlier than the open time (e.g. 12:00–02:00)
 * runs past midnight. Empty/missing hours fall back to 10:00–24:00 daily.
 */
export function openIntervals(date: string, hours: OpeningHours | null | undefined): Interval[] {
  const useHours = hours && Object.keys(hours).length ? hours : DEFAULT_HOURS
  const weekday = dubaiParts(dubaiInstant(date, 12 * 60)).weekday
  return (useHours[weekday] ?? []).map(({ open, close }) => {
    const o = toMin(open)
    let c = toMin(close)
    if (c <= o) c += 1440
    return { start: dubaiInstant(date, o), end: dubaiInstant(date, c) }
  })
}

export const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end
export const contains = (outer: Interval, inner: Interval) =>
  outer.start <= inner.start && inner.end <= outer.end

/** Hold = service time plus cleanup/prep buffers; this is what gets reserved. */
export function holdInterval(
  start: Date,
  durationMin: number,
  bufferBeforeMin = 0,
  bufferAfterMin = 0,
): Interval {
  return {
    start: new Date(start.getTime() - bufferBeforeMin * MIN),
    end: new Date(start.getTime() + (durationMin + bufferAfterMin) * MIN),
  }
}

export type StaffAvailability = {
  id: string
  shifts: Interval[]
  busy: Interval[]
  skills: string[]
  /** Approved leave (whole business days); blocks slots even inside a shift. */
  leave?: Interval[]
}
export type RoomAvailability = { id: string; type: string; busy: Interval[] }
export type EquipmentAvailability = { id: string; type: string; busy: Interval[] }

export type SlotQuery = {
  date: string
  cutoff?: string
  hours?: OpeningHours | null
  serviceId: string
  durationMin: number
  bufferBeforeMin?: number
  bufferAfterMin?: number
  therapistsRequired?: number
  /** Allowed room types; empty = any. */
  roomTypes?: string[]
  staff: StaffAvailability[]
  rooms: RoomAvailability[]
  /** Equipment types the service needs, one unit per entry (repeat a type for two). */
  equipmentTypes?: string[]
  equipment?: EquipmentAvailability[]
  /** Restrict to these therapists (client preference). */
  preferredStaffIds?: string[]
  stepMin?: number
  /** Slots starting before this are skipped (e.g. now + lead time). */
  notBefore?: Date
}

export type Slot = {
  start: Date
  end: Date
  staffIds: string[]
  roomIds: string[]
  /** One free unit per required equipment type (empty when the service needs none). */
  equipmentIds: string[]
}

const isFree = (busy: Interval[], hold: Interval) => !busy.some((b) => overlaps(b, hold))

/** True when the person is on approved leave at any point of the interval. */
export const onLeave = (s: Pick<StaffAvailability, 'leave'>, i: Interval) =>
  (s.leave ?? []).some((l) => overlaps(l, i))

/**
 * Picks one distinct free unit per required type (`types` may repeat a type for two units); null when any type
 * runs out. Units of a type are interchangeable, so taking the first free one is optimal.
 */
export function pickEquipment(
  units: EquipmentAvailability[],
  types: string[] | undefined,
  hold: Interval,
): string[] | null {
  const taken: string[] = []
  for (const type of types ?? []) {
    const unit = units.find((u) => u.type === type && !taken.includes(u.id) && isFree(u.busy, hold))
    if (!unit) return null
    taken.push(unit.id)
  }
  return taken
}

/**
 * Every bookable start time on a business date, with the therapists and rooms free for it.
 * A slot needs `therapistsRequired` distinct skilled therapists on shift and free for the whole hold,
 * plus one free room of an allowed type (couples treatments share one room) and one free unit of each required
 * equipment type. Therapists on approved leave are never offered.
 */
export function findSlots(q: SlotQuery): Slot[] {
  const step = q.stepMin ?? 15
  const need = Math.max(1, q.therapistsRequired ?? 1)
  const window = businessDayWindow(q.date, q.cutoff)
  const opens = openIntervals(q.date, q.hours)
  const skilled = q.staff.filter(
    (s) =>
      s.skills.includes(q.serviceId) && (!q.preferredStaffIds?.length || q.preferredStaffIds.includes(s.id)),
  )
  const rooms = q.rooms.filter((r) => !q.roomTypes?.length || q.roomTypes.includes(r.type))
  const slots: Slot[] = []
  for (const open of opens) {
    for (let t = open.start.getTime(); t + q.durationMin * MIN <= open.end.getTime(); t += step * MIN) {
      const start = new Date(t)
      if (start < window.start || start >= window.end) continue
      if (q.notBefore && start < q.notBefore) continue
      const service: Interval = { start, end: new Date(t + q.durationMin * MIN) }
      const hold = holdInterval(start, q.durationMin, q.bufferBeforeMin, q.bufferAfterMin)
      const staffIds = skilled
        .filter((s) => s.shifts.some((sh) => contains(sh, hold)) && isFree(s.busy, hold) && !onLeave(s, hold))
        .map((s) => s.id)
      if (staffIds.length < need) continue
      const roomIds = rooms.filter((r) => isFree(r.busy, hold)).map((r) => r.id)
      if (roomIds.length === 0) continue
      const equipmentIds = pickEquipment(q.equipment ?? [], q.equipmentTypes, hold)
      if (!equipmentIds) continue
      slots.push({ start, end: service.end, staffIds, roomIds, equipmentIds })
    }
  }
  return slots
}

/**
 * Picks therapists for a slot: preferred first, then the rotation order (fair turns for walk-ins),
 * then whoever has the fewest bookings that day.
 */
export function pickStaff(
  candidates: string[],
  need: number,
  opts: { rotation?: string[]; load?: Record<string, number> } = {},
) {
  const rank = (id: string) => {
    const r = opts.rotation?.indexOf(id) ?? -1
    return [r === -1 ? Number.MAX_SAFE_INTEGER : r, opts.load?.[id] ?? 0] as const
  }
  return [...candidates]
    .sort((a, b) => {
      const [ra, la] = rank(a)
      const [rb, lb] = rank(b)
      return ra - rb || la - lb || a.localeCompare(b)
    })
    .slice(0, need)
}

/** Postgres tstzrange literal for a hold. */
export const toRange = (i: Interval) => `[${i.start.toISOString()},${i.end.toISOString()})`

/** Short human booking reference, e.g. K7Q2 (no 0/O/1/I). */
export function newRefCode(random: () => number = Math.random, length = 5) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from({ length }, () => alphabet[Math.floor(random() * alphabet.length)]).join('')
}

/** VAT included in a VAT-inclusive amount (UAE standard rate 5%). */
export const includedVat = (gross: number, ratePct = 5) =>
  Math.round(((gross * ratePct) / (100 + ratePct)) * 100) / 100

/**
 * Allowed booking status transitions. Staff mark bookings Pending / Completed / Cancelled (PLAN §14.8 R2):
 * a completed booking can be re-opened (pending) or cancelled — its commission is then reversed.
 */
export const BOOKING_TRANSITIONS: Record<string, string[]> = {
  pending: ['confirmed', 'cancelled', 'checked_in', 'no_show', 'completed'],
  confirmed: ['checked_in', 'in_service', 'cancelled', 'no_show', 'pending', 'completed'],
  checked_in: ['in_service', 'completed', 'cancelled'],
  in_service: ['completed'],
  completed: ['pending', 'cancelled'],
  no_show: ['confirmed'],
  cancelled: ['confirmed'],
}
export const canTransition = (from: string, to: string) => BOOKING_TRANSITIONS[from]?.includes(to) ?? false

/** The three marks staff use (PLAN §14.8 R2); other statuses stay internal. */
export type BookingMark = 'pending' | 'completed' | 'cancelled'
export const bookingMark = (status: string): BookingMark | null =>
  status === 'completed'
    ? 'completed'
    : status === 'cancelled'
      ? 'cancelled'
      : status === 'no_show'
        ? null
        : 'pending'
/** The statuses a mark filter covers. */
export const MARK_STATUSES: Record<BookingMark, string[]> = {
  pending: ['pending', 'confirmed', 'checked_in', 'in_service'],
  completed: ['completed'],
  cancelled: ['cancelled', 'no_show'],
}
