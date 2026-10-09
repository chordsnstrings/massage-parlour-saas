// Per-spa automation switches (PLAN §14.7 B3). Stored in `tenants.settings.automations` as `{ [key]: boolean }`;
// a missing key means ON (the behaviour before switches existed). Automations only QUEUE WhatsApp messages or push
// staff notifications — a human still presses send (click-to-send rule).

/** Switchable automations, in the order the Automations page lists them. */
export const AUTOMATIONS = [
  'bookingMessages',
  'thankYou',
  'slotFiller',
  'packageExpiry',
  'instagram',
  'googleReviews',
  'weeklyInsights',
  'dailyDigest',
  'documentAlerts',
] as const
export type AutomationKey = (typeof AUTOMATIONS)[number]

/** Platform duties shown on the page as always on (not switchable). */
export const LOCKED_AUTOMATIONS = ['backups', 'domains'] as const
export type LockedAutomationKey = (typeof LOCKED_AUTOMATIONS)[number]

export type AutomationSettings = Partial<Record<AutomationKey, boolean>>

/** Worker job names (apps/worker/src/jobs/index.ts) that each switch controls; also the `job_runs.job` values. */
export const AUTOMATION_JOBS: Record<AutomationKey, readonly string[]> = {
  bookingMessages: [],
  thankYou: [],
  slotFiller: ['slot-filler'],
  packageExpiry: ['packages-expire'],
  instagram: ['instagram-publish'],
  googleReviews: ['gbp-reviews-sync'],
  weeklyInsights: ['weekly-insights'],
  dailyDigest: ['daily-digest'],
  documentAlerts: ['document-reminders'],
}

export const isAutomationKey = (v: unknown): v is AutomationKey =>
  typeof v === 'string' && (AUTOMATIONS as readonly string[]).includes(v)

/** Is this automation on for the spa? Unknown / missing = on. */
export const automationOn = (
  settings: { automations?: Record<string, boolean | undefined> } | null | undefined,
  key: AutomationKey,
) => settings?.automations?.[key] !== false
