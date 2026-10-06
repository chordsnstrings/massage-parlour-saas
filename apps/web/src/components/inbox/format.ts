// Small display helpers shared by the inbox list and thread (server + client safe).

export type ConversationMode = 'bot' | 'human' | 'closed'

export const MODE_LABEL: Record<ConversationMode, string> = {
  bot: 'AI replying',
  human: 'Team replying',
  closed: 'Closed',
}

export const CHANNEL_LABEL: Record<string, string> = {
  instagram_dm: 'Instagram DM',
  instagram_comment: 'Instagram comment',
}

/** Client name, then @username, then a short opaque id. */
export function displayName(c: {
  clientName?: string | null
  participant?: string | null
  channel: string
  externalThreadId: string
}) {
  if (c.clientName) return c.clientName
  if (c.participant) return c.participant
  const tail = c.externalThreadId.slice(-4)
  return c.channel === 'instagram_comment' ? `Commenter ·${tail}` : `Instagram user ·${tail}`
}

const dubaiDay = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' })
const timeFmt = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Dubai',
})
const dayFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Dubai' })

/** "14:05" today (Dubai), "5 Oct" otherwise. */
export function shortTime(value: Date | string, now = new Date()) {
  const d = typeof value === 'string' ? new Date(value) : value
  return dubaiDay(d) === dubaiDay(now) ? timeFmt.format(d) : dayFmt.format(d)
}

export const dayKey = (value: Date | string) => dubaiDay(typeof value === 'string' ? new Date(value) : value)

/** "Today", "Yesterday" or "5 Oct" (Dubai days). */
export function dayLabel(value: Date | string, now = new Date()) {
  const k = dayKey(value)
  if (k === dubaiDay(now)) return 'Today'
  if (k === dubaiDay(new Date(now.getTime() - 86_400_000))) return 'Yesterday'
  return dayFmt.format(typeof value === 'string' ? new Date(value) : value)
}

export const clockTime = (value: Date | string) =>
  timeFmt.format(typeof value === 'string' ? new Date(value) : value)

/** "5 h 20 min left" for the 24-hour DM reply window. */
export function windowLeft(ms: number) {
  if (ms <= 0) return null
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return h ? `${h} h ${m} min left` : `${Math.max(1, m)} min left`
}
