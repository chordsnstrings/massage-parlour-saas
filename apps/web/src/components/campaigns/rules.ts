/** Client-safe segment rule + campaign helpers (no DB imports). */
import type { SegmentRule } from '@spa/db'
import { z } from 'zod'

export type { SegmentRule }
export type RuleKind = SegmentRule['kind']

type NumberParam = { key: 'days' | 'count' | 'aed'; min: number; max: number }

export type RuleDef = {
  label: string
  group: 'Visits' | 'Spend' | 'Birthday' | 'Profile' | 'Packages'
  /** Sentence around the input: "{before} [input] {after}". */
  before: string
  after?: string
  number?: NumberParam
  select?: 'service' | 'gender' | 'language' | 'tag'
  defaults: SegmentRule
}

const days = (max = 3650): NumberParam => ({ key: 'days', min: 1, max })
const count = (min = 0): NumberParam => ({ key: 'count', min, max: 1000 })

export const RULE_DEFS: Record<RuleKind, RuleDef> = {
  lapsed: {
    label: 'Last visit more than N days ago',
    group: 'Visits',
    before: 'Last visit more than',
    after: 'days ago',
    number: days(),
    defaults: { kind: 'lapsed', days: 60 },
  },
  visited_within: {
    label: 'Last visit within N days',
    group: 'Visits',
    before: 'Last visit within the last',
    after: 'days',
    number: days(),
    defaults: { kind: 'visited_within', days: 30 },
  },
  visits_at_least: {
    label: 'Visits at least N',
    group: 'Visits',
    before: 'At least',
    after: 'visits',
    number: count(1),
    defaults: { kind: 'visits_at_least', count: 2 },
  },
  visits_at_most: {
    label: 'Visits at most N',
    group: 'Visits',
    before: 'At most',
    after: 'visits',
    number: count(1),
    defaults: { kind: 'visits_at_most', count: 1 },
  },
  service: {
    label: 'Has booked a treatment',
    group: 'Visits',
    before: 'Has booked',
    select: 'service',
    defaults: { kind: 'service', serviceId: '' },
  },
  no_shows_at_least: {
    label: 'No-shows at least N',
    group: 'Visits',
    before: 'At least',
    after: 'no-shows',
    number: count(1),
    defaults: { kind: 'no_shows_at_least', count: 1 },
  },
  spent_at_least: {
    label: 'Total spend at least AED',
    group: 'Spend',
    before: 'Spent at least AED',
    after: 'in total',
    number: { key: 'aed', min: 1, max: 1_000_000 },
    defaults: { kind: 'spent_at_least', aed: 2000 },
  },
  birthday_month: {
    label: 'Birthday this month',
    group: 'Birthday',
    before: 'Birthday this month',
    defaults: { kind: 'birthday_month' },
  },
  birthday_within: {
    label: 'Birthday in the next N days',
    group: 'Birthday',
    before: 'Birthday in the next',
    after: 'days',
    number: days(90),
    defaults: { kind: 'birthday_within', days: 14 },
  },
  gender: {
    label: 'Gender',
    group: 'Profile',
    before: 'Gender is',
    select: 'gender',
    defaults: { kind: 'gender', gender: 'female' },
  },
  language: {
    label: 'Language',
    group: 'Profile',
    before: 'Prefers',
    select: 'language',
    defaults: { kind: 'language', language: 'ar' },
  },
  tag: {
    label: 'Has a tag',
    group: 'Profile',
    before: 'Tagged',
    select: 'tag',
    defaults: { kind: 'tag', tag: '' },
  },
  has_package: {
    label: 'Has an active package',
    group: 'Packages',
    before: 'Has an active package',
    defaults: { kind: 'has_package' },
  },
  package_expiring: {
    label: 'Package expiring within N days',
    group: 'Packages',
    before: 'Package expires within',
    after: 'days',
    number: days(365),
    defaults: { kind: 'package_expiring', days: 14 },
  },
}

export const RULE_GROUPS = ['Visits', 'Spend', 'Birthday', 'Profile', 'Packages'] as const

export const GENDER_LABEL = { female: 'Female', male: 'Male', other: 'Other' } as const
export const LANGUAGE_LABEL = { en: 'English', ar: 'Arabic' } as const

/** Human sentence for a rule ("Last visit more than 60 days ago"). */
export function describeRule(r: SegmentRule, serviceName?: (id: string) => string | undefined) {
  const d = RULE_DEFS[r.kind]
  switch (r.kind) {
    case 'service':
      return `${d.before} ${serviceName?.(r.serviceId) ?? 'a treatment'}`
    case 'gender':
      return `${d.before} ${GENDER_LABEL[r.gender].toLowerCase()}`
    case 'language':
      return `${d.before} ${LANGUAGE_LABEL[r.language]}`
    case 'tag':
      return `${d.before} “${r.tag}”`
    case 'spent_at_least':
      return `${d.before} ${r.aed.toLocaleString('en-AE')} ${d.after}`
    default: {
      const n = d.number ? (r as Record<string, unknown>)[d.number.key] : undefined
      return [d.before, n, d.after].filter((p) => p !== undefined && p !== '').join(' ')
    }
  }
}

export type SegmentPreset = { key: string; name: string; description: string; rules: SegmentRule[] }

export const SEGMENT_PRESETS: SegmentPreset[] = [
  {
    key: 'winback',
    name: 'Win back (no visit 60 days)',
    description: 'Regulars who have not been in for two months.',
    rules: [{ kind: 'lapsed', days: 60 }],
  },
  {
    key: 'birthday',
    name: 'Birthday this month',
    description: 'A birthday treat brings them in.',
    rules: [{ kind: 'birthday_month' }],
  },
  {
    key: 'package-expiring',
    name: 'Package expiring in 14 days',
    description: 'Remind them to use the sessions they paid for.',
    rules: [{ kind: 'package_expiring', days: 14 }],
  },
  {
    key: 'vip',
    name: 'VIPs (spent AED 2,000+)',
    description: 'Your best clients — first to hear about offers.',
    rules: [{ kind: 'spent_at_least', aed: 2000 }],
  },
  {
    key: 'first-timers',
    name: 'First-timers (1 visit)',
    description: 'Turn a first visit into a habit.',
    rules: [
      { kind: 'visits_at_least', count: 1 },
      { kind: 'visits_at_most', count: 1 },
    ],
  },
]

const int = (min: number, max: number) => z.coerce.number().int().min(min).max(max)

/** Server-side validation of the rules JSON posted by the builder. */
export const segmentRulesSchema = z
  .array(
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('lapsed'), days: int(1, 3650) }),
      z.object({ kind: z.literal('visited_within'), days: int(1, 3650) }),
      z.object({ kind: z.literal('visits_at_least'), count: int(1, 1000) }),
      z.object({ kind: z.literal('visits_at_most'), count: int(1, 1000) }),
      z.object({ kind: z.literal('spent_at_least'), aed: z.coerce.number().min(1).max(1_000_000) }),
      z.object({ kind: z.literal('service'), serviceId: z.uuid('Choose a treatment') }),
      z.object({ kind: z.literal('birthday_month') }),
      z.object({ kind: z.literal('birthday_within'), days: int(1, 90) }),
      z.object({ kind: z.literal('gender'), gender: z.enum(['female', 'male', 'other']) }),
      z.object({ kind: z.literal('language'), language: z.enum(['en', 'ar']) }),
      z.object({ kind: z.literal('tag'), tag: z.string().trim().min(1, 'Choose a tag').max(40) }),
      z.object({ kind: z.literal('has_package') }),
      z.object({ kind: z.literal('package_expiring'), days: int(1, 365) }),
      z.object({ kind: z.literal('no_shows_at_least'), count: int(1, 1000) }),
    ]),
  )
  .max(12, 'Up to 12 conditions')

/** Rules that are complete enough to preview (a service/tag picked). */
export const completeRules = (rules: SegmentRule[]) =>
  rules.filter((r) => (r.kind === 'service' ? r.serviceId : r.kind === 'tag' ? r.tag.trim() : true))

// ── Campaign messages ────────────────────────────────────────────────────────

export const CAMPAIGN_VARIABLES = [
  { key: 'name', label: 'First name' },
  { key: 'spa', label: 'Spa name' },
  { key: 'booking_link', label: 'Booking link' },
  { key: 'offer_code', label: 'Offer code' },
] as const
const KNOWN = new Set<string>([...CAMPAIGN_VARIABLES.map((v) => v.key), 'first_name', 'full_name'])

export const MAX_MESSAGE = 700
/** WhatsApp click-to-send links stop opening reliably past ~2000 characters. */
export const MAX_LINK = 2000

export const unknownCampaignVariables = (text: string) =>
  [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).filter((v) => !KNOWN.has(v))

export function previewCampaignMessage(
  body: string,
  vars: { name: string; spa: string; bookingLink: string; offerCode?: string | null },
) {
  const first = vars.name.trim().split(/\s+/)[0] ?? vars.name
  const values: Record<string, string> = {
    name: first,
    first_name: first,
    full_name: vars.name,
    spa: vars.spa,
    booking_link: vars.bookingLink,
    offer_code: vars.offerCode ?? '',
  }
  return body.replace(/\{(\w+)\}/g, (m, k: string) => values[k] ?? m).trim()
}

/** Approximate wa.me link length for a message (phone + encoded text). */
export const linkLength = (text: string) => 40 + encodeURIComponent(text).length

// ── Status ───────────────────────────────────────────────────────────────────

export type CampaignView = {
  status: 'draft' | 'queued' | 'done'
  archivedAt: Date | string | null
  scheduledAt: Date | string | null
}

export function campaignState(c: CampaignView, pending: number, now = new Date()) {
  if (c.archivedAt) return { label: 'Archived', tone: 'neutral' as const }
  if (c.status === 'draft') return { label: 'Draft', tone: 'neutral' as const }
  if (c.status === 'queued' && c.scheduledAt && new Date(c.scheduledAt) > now)
    return { label: 'Scheduled', tone: 'warning' as const }
  if (c.status === 'queued' && pending > 0) return { label: 'Sending', tone: 'accent' as const }
  return { label: 'Done', tone: 'success' as const }
}
