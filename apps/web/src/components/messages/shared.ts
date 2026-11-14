/** Client-safe helpers for the WhatsApp outbox (no DB imports). */
import { enumLabel } from '@spa/core/i18n/labels'
import type { Translator } from '@spa/core/i18n/translate'
import type { Tone } from '@/components/crm'

export const MESSAGE_KINDS = [
  'booking_confirmation',
  'reminder',
  'reminder_2h',
  'thank_you',
  'review_request',
  'rebook',
  'birthday',
  'winback',
  'slot_offer',
  'waitlist_slot',
  'membership_renewal',
  'custom',
] as const
export type MessageKind = (typeof MESSAGE_KINDS)[number]

/** Kinds with an editable template (custom messages are free text). */
export const TEMPLATE_KINDS = MESSAGE_KINDS.filter((k) => k !== 'custom')

/** Pill tone per kind in the queue (labels: `enumLabel(t, 'messageKind', kind)`). */
export const KIND_TONE: Record<MessageKind, Tone> = {
  booking_confirmation: 'info',
  reminder: 'warn',
  reminder_2h: 'warn',
  thank_you: 'ok',
  review_request: 'ok',
  rebook: 'neutral',
  birthday: 'neutral',
  winback: 'neutral',
  slot_offer: 'neutral',
  waitlist_slot: 'info',
  membership_renewal: 'warn',
  custom: 'neutral',
}

/** Variables staff can insert (shown as chips). `{link}` and `{text}` are accepted too. */
export const TEMPLATE_VARIABLES = ['first_name', 'service', 'day', 'time', 'spa', 'ref', 'link'] as const
export const ALLOWED_VARIABLES = [...TEMPLATE_VARIABLES, 'name', 'text'] as const

/** Same substitution rule as the server-side renderer: unknown variables are left as typed. */
export const previewTemplate = (body: string, vars: Record<string, string>) =>
  body.replace(/\{(\w+)\}/g, (m, key: string) => vars[key] ?? m)

export const unknownVariables = (body: string) =>
  [...body.matchAll(/\{(\w+)\}/g)]
    .map((m) => m[1] ?? '')
    .filter((v) => !(ALLOWED_VARIABLES as readonly string[]).includes(v))

export type WaMode = 'web' | 'desktop' | 'mobile'
export const WA_MODES: WaMode[] = ['web', 'desktop', 'mobile']
export const WA_MODE_KEY = 'spa.wa-mode'

export type OutboxRow = {
  id: string
  kind: MessageKind
  /** Part of a campaign (sent as kind 'custom'): labelled "Campaign" in the queue. */
  campaign: boolean
  status: 'queued' | 'opened' | 'sent' | 'skipped'
  clientName: string
  /** Masked unless the viewer may see phone numbers. */
  phone: string
  text: string
  dueAt: string
  bookingAt: string | null
  sentAt: string | null
  sentBy: string | null
  /** F28: member responsible for sending it; `assignedAuto` = picked by the auto-assign rule. */
  assignedTo: string | null
  assignedAuto: boolean
  links: Record<WaMode, string>
}

export type AssigneeFilter = 'all' | 'mine' | 'unassigned'
/** Assignment data for the queue (F28). `options` = who a message can go to; `names` also covers former senders. */
export type AssignProps = {
  who: AssigneeFilter
  counts: Record<AssigneeFilter, number>
  options: { id: string; name: string }[]
  names: Record<string, string>
  meId: string | null
  autoAssign: boolean
}

export const rowLabel = (t: Translator, row: Pick<OutboxRow, 'kind' | 'campaign'>) =>
  row.campaign ? t('messages.campaign') : enumLabel(t, 'messageKind', row.kind)
