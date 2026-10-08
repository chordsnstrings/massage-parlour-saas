// Small display helpers shared by the inbox list and thread (server + client safe). Pass `t`/`fmt` from
// getI18n() (server) or useI18n() (client).
import type { Format } from '@spa/core/i18n/format'
import type { Translator } from '@spa/core/i18n/translate'

export type ConversationMode = 'bot' | 'human' | 'closed'

export const modeLabel = (t: Translator, mode: ConversationMode) => t(`inbox.mode.${mode}`)

export const channelLabel = (t: Translator, channel: string) => t.maybe(`inbox.channel.${channel}`) ?? channel

/** Client name, then @username, then a short opaque id. */
export function displayName(
  t: Translator,
  c: {
    clientName?: string | null
    participant?: string | null
    channel: string
    externalThreadId: string
  },
) {
  if (c.clientName) return c.clientName
  if (c.participant) return c.participant
  const tail = c.externalThreadId.slice(-4)
  return c.channel === 'instagram_comment' ? t('inbox.name.commenter', { tail }) : t('inbox.name.user', { tail })
}

const dubaiDay = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' })
const toDate = (value: Date | string) => (typeof value === 'string' ? new Date(value) : value)

/** "14:05" today (Dubai), "5 Oct" otherwise. */
export function shortTime(fmt: Format, value: Date | string, now = new Date()) {
  const d = toDate(value)
  return dubaiDay(d) === dubaiDay(now) ? fmt.time(d) : fmt.dateShort(d)
}

export const dayKey = (value: Date | string) => dubaiDay(toDate(value))

/** "Today", "Yesterday" or "5 Oct" (Dubai days). */
export function dayLabel(t: Translator, fmt: Format, value: Date | string, now = new Date()) {
  const k = dayKey(value)
  if (k === dubaiDay(now)) return t('common.today')
  if (k === dubaiDay(new Date(now.getTime() - 86_400_000))) return t('common.yesterday')
  return fmt.dateShort(toDate(value))
}

/** "5 h 20 min left" for the 24-hour DM reply window. */
export function windowLeft(t: Translator, ms: number) {
  if (ms <= 0) return null
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return h ? t('inbox.thread.left', { h, m }) : t('inbox.thread.leftMin', { m: Math.max(1, m) })
}
