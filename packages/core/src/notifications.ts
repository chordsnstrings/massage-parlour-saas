// Notification kinds (PLAN §14.7 B2): who may see each kind and how a row's params become text.
// Text lives in the `notifications` i18n namespace (`notifications.kind.<kind>.{title,body}`), rendered in the
// reader's locale. Param conventions: `at` = ISO instant → date + time, `date` = YYYY-MM-DD → date, `amount` = AED.
import type { Format } from './i18n/format'
import type { Translator } from './i18n/translate'
import type { MessageKey, Params } from './i18n/types'
import type { Permission } from './permissions'

export const NOTIFICATION_KINDS = {
  'booking.online': { permission: 'calendar.manage' },
  'booking.pending': { permission: 'calendar.manage' },
  // F15: a lead from the website's enquiry form (Inbox → Enquiries).
  'enquiry.site': { permission: 'clients.view' },
  'stock.low': { permission: 'inventory.manage' },
  'document.expiry': { permission: 'staff.manage' },
  'ai.drafts': { permission: 'ai.approve' },
  // G18 monthly AI budget thresholds (80 % / 100 %), once per threshold per Dubai month.
  'ai.budget_warning': { permission: 'billing.view' },
  'ai.budget_reached': { permission: 'billing.view' },
  'billing.overdue': { permission: 'billing.view' },
  'billing.reminder': { permission: 'billing.view' },
  // F22 automatic billing transitions (once per stage per late episode).
  'billing.late': { permission: 'billing.view' },
  'billing.read_only': { permission: 'billing.view' },
  'billing.restored': { permission: 'billing.view' },
  // Bell copies of the scheduled digests (push-only before): one row per week / business day.
  weekly_insights: { permission: 'reports.view' },
  daily_digest: { permission: 'calendar.manage' },
} as const satisfies Record<string, { permission: Permission }>

export type NotificationKind = keyof typeof NOTIFICATION_KINDS

export const isNotificationKind = (kind: string): kind is NotificationKind => kind in NOTIFICATION_KINDS

export const notificationPermission = (kind: NotificationKind): Permission =>
  NOTIFICATION_KINDS[kind].permission

/** Params as stored in the row's jsonb (nested `{ key }` params are translated first). */
export type NotificationParams = Params

function formatParams(fmt: Format, params: NotificationParams = {}): Params {
  const out: Params = {}
  for (const [name, v] of Object.entries(params)) {
    if (name === 'at' && typeof v === 'string') out[name] = fmt.dateTime(v)
    else if (name === 'date' && typeof v === 'string') out[name] = fmt.date(v)
    else if (name === 'amount' && (typeof v === 'string' || typeof v === 'number')) out[name] = fmt.aed(v)
    else out[name] = v
  }
  return out
}

/** Title + body of a notification in `t`'s locale; unknown kinds (rows from a newer build) get a generic line. */
export function notificationText(
  t: Translator,
  fmt: Format,
  n: { kind: string; params?: NotificationParams | null },
): { title: string; body: string } {
  const p = formatParams(fmt, n.params ?? {})
  const base = `notifications.kind.${n.kind}`
  const title = isNotificationKind(n.kind) ? t.maybe(`${base}.title`, p) : undefined
  return {
    title: title ?? t('notifications.unknown' as MessageKey),
    body: (isNotificationKind(n.kind) && t.maybe(`${base}.body`, p)) || '',
  }
}
