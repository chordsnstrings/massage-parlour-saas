/** Client-safe helpers for the WhatsApp outbox (no DB imports). */

export const MESSAGE_KINDS = [
  'booking_confirmation',
  'reminder',
  'thank_you',
  'review_request',
  'rebook',
  'birthday',
  'winback',
  'slot_offer',
  'custom',
] as const
export type MessageKind = (typeof MESSAGE_KINDS)[number]

/** Kinds with an editable template (custom messages are free text). */
export const TEMPLATE_KINDS = MESSAGE_KINDS.filter((k) => k !== 'custom')

export const KIND_LABEL: Record<MessageKind, string> = {
  booking_confirmation: 'Confirmation',
  reminder: 'Reminder',
  thank_you: 'Thank you',
  review_request: 'Review request',
  rebook: 'Rebook nudge',
  birthday: 'Birthday',
  winback: 'Win-back',
  slot_offer: 'Free slot offer',
  custom: 'Custom',
}

export const KIND_HINT: Record<MessageKind, string> = {
  booking_confirmation: 'Sent as soon as a booking is confirmed.',
  reminder: 'Queued the day before, or a couple of hours ahead.',
  thank_you: 'After a completed visit.',
  review_request: 'After a completed visit, with your review link.',
  rebook: 'When a regular is due for their next treatment.',
  birthday: 'In the client’s birthday week.',
  winback: 'For clients who have not visited in a while.',
  slot_offer: 'To fill a gap that just opened in the day.',
  custom: 'Free text.',
}

export const KIND_TONE: Record<MessageKind, 'accent' | 'neutral' | 'warning' | 'success'> = {
  booking_confirmation: 'accent',
  reminder: 'warning',
  thank_you: 'success',
  review_request: 'success',
  rebook: 'neutral',
  birthday: 'neutral',
  winback: 'neutral',
  slot_offer: 'neutral',
  custom: 'neutral',
}

/** Variables staff can insert (shown as chips). `{link}` and `{text}` are accepted too. */
export const TEMPLATE_VARIABLES = ['first_name', 'service', 'day', 'time', 'spa', 'ref'] as const
export const ALLOWED_VARIABLES = [...TEMPLATE_VARIABLES, 'name', 'link', 'text'] as const

export const VARIABLE_LABEL: Record<(typeof TEMPLATE_VARIABLES)[number], string> = {
  first_name: 'First name',
  service: 'Treatment',
  day: 'Day',
  time: 'Time',
  spa: 'Spa name',
  ref: 'Booking ref',
}

/** Same substitution rule as the server-side renderer: unknown variables are left as typed. */
export const previewTemplate = (body: string, vars: Record<string, string>) =>
  body.replace(/\{(\w+)\}/g, (m, key: string) => vars[key] ?? m)

export const unknownVariables = (body: string) =>
  [...body.matchAll(/\{(\w+)\}/g)]
    .map((m) => m[1] ?? '')
    .filter((v) => !(ALLOWED_VARIABLES as readonly string[]).includes(v))

export type WaMode = 'web' | 'desktop' | 'mobile'
export const WA_MODES: { key: WaMode; label: string; hint: string }[] = [
  { key: 'web', label: 'WhatsApp Web', hint: 'Reuses one browser tab' },
  { key: 'desktop', label: 'Desktop app', hint: 'Opens the installed app' },
  { key: 'mobile', label: 'Phone', hint: 'wa.me link for phones' },
]
export const WA_MODE_KEY = 'spa.wa-mode'

export type OutboxRow = {
  id: string
  kind: MessageKind
  status: 'queued' | 'opened' | 'sent' | 'skipped'
  clientName: string
  /** Masked unless the viewer may see phone numbers. */
  phone: string
  text: string
  dueAt: string
  bookingAt: string | null
  sentAt: string | null
  sentBy: string | null
  links: Record<WaMode, string>
}
