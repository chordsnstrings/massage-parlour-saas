import { clients, segments, services, type Tx } from '@spa/db'
import { asc, desc, eq, sql } from 'drizzle-orm'
import { describeRule, type SegmentRule } from '@/components/campaigns/rules'

/** Active treatments for the "has booked" rule. */
export async function serviceOptions(tx: Tx) {
  const rows = await tx
    .select({ id: services.id, name: services.name })
    .from(services)
    .where(eq(services.active, true))
    .orderBy(asc(services.sort))
  return rows.map((s) => ({ id: s.id, name: s.name.en }))
}

/** Tags already used on clients (suggestions for the tag rule). */
export async function clientTags(tx: Tx) {
  const rows = await tx
    .selectDistinct({ tag: sql<string>`unnest(${clients.tags})` })
    .from(clients)
    .limit(200)
  return rows
    .map((r) => r.tag)
    .filter((t) => t && t !== 'no-marketing')
    .sort()
}

export const summarize = (rules: SegmentRule[], services: { id: string; name: string }[]) => {
  const name = (id: string) => services.find((s) => s.id === id)?.name
  return rules.length
    ? rules.map((r) => describeRule(r, name)).join(' · ')
    : 'Everyone who can receive marketing'
}

/** Saved segments with a one-line description of their rules. */
export async function segmentOptions(tx: Tx) {
  const rows = await tx.select().from(segments).orderBy(desc(segments.createdAt))
  const svc = await serviceOptions(tx)
  return rows.map((s) => ({ ...s, summary: summarize(s.rules, svc) }))
}

/** Dubai wall clock as a datetime-local value. */
export const dubaiLocalValue = (d: Date) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dubai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
}

export const DEFAULT_MESSAGE = {
  en: 'Hi {name}, we miss you at {spa}! Treat yourself to your next massage — book here: {booking_link}',
  ar: 'مرحباً {name}، نفتقدك في {spa}! دلّل نفسك بجلسة مساج — احجز هنا: {booking_link}',
}
