import { dubaiInstant } from '@spa/core'

/**
 * Per-section schedule (PLAN §11.3 layer 4): show a section only between two Asia/Dubai dates or times,
 * e.g. a Ramadan offer band. Values are local Dubai `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm` (datetime-local).
 * A date-only `to` includes that whole day.
 */
export type SectionSchedule = { from?: string; to?: string }
export type ScheduleState = 'always' | 'live' | 'upcoming' | 'ended'

const LOCAL = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2}))?$/

/** Dubai local date/time → instant; date-only `end` values mean the end of that day. */
export function dubaiLocalInstant(value: string | null | undefined, end = false): Date | null {
  const m = value?.trim().match(LOCAL)
  if (!m) return null
  const [, date, hh, mm] = m
  if (hh === undefined) return dubaiInstant(date!, end ? 24 * 60 : 0)
  const minutes = Number(hh) * 60 + Number(mm)
  if (minutes >= 24 * 60) return null
  return dubaiInstant(date!, minutes)
}

export function scheduleState(schedule: SectionSchedule | null | undefined, now = new Date()): ScheduleState {
  const from = dubaiLocalInstant(schedule?.from)
  const to = dubaiLocalInstant(schedule?.to, true)
  if (!from && !to) return 'always'
  if (from && now < from) return 'upcoming'
  if (to && now >= to) return 'ended'
  return 'live'
}

/** Whether a scheduled section is shown to visitors right now. */
export const isScheduleVisible = (schedule: SectionSchedule | null | undefined, now = new Date()) => {
  const state = scheduleState(schedule, now)
  return state === 'always' || state === 'live'
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function pretty(value: string) {
  const m = value.match(LOCAL)
  if (!m) return value
  const [y, mo, d] = m[1]!.split('-').map(Number)
  const time = m[2] !== undefined ? ` ${m[2]}:${m[3]}` : ''
  return `${d} ${MONTHS[mo! - 1]} ${y}${time}`
}

/** "Shows 1 Mar 2026 – 14 Mar 2026" (Dubai time), for badges and the schedule field. */
export function describeSchedule(schedule: SectionSchedule | null | undefined): string {
  const from = schedule?.from && dubaiLocalInstant(schedule.from) ? pretty(schedule.from) : null
  const to = schedule?.to && dubaiLocalInstant(schedule.to, true) ? pretty(schedule.to) : null
  if (from && to) return `Shows ${from} – ${to}`
  if (from) return `Shows from ${from}`
  if (to) return `Shows until ${to}`
  return 'Always shown'
}
