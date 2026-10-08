/** Client-safe segment rule + campaign helpers (no DB imports). */
import type { SegmentRule } from '@spa/db'
import type { Format } from '@spa/core/i18n/format'
import type { Translator } from '@spa/core/i18n/translate'
import { z } from 'zod'
import type { Tone } from '@/components/crm'

export type { SegmentRule }
export type RuleKind = SegmentRule['kind']

type NumberParam = { key: 'days' | 'count' | 'aed'; min: number; max: number }
export type RuleGroup = 'visits' | 'spend' | 'birthday' | 'profile' | 'packages'

/**
 * Text lives in the `campaigns.rule.<kind>` keys: `label` (menu), and the sentence around the input
 * "{before} [input] {after}" (`after` only when `hasAfter`).
 */
export type RuleDef = {
  group: RuleGroup
  hasAfter?: boolean
  number?: NumberParam
  select?: 'service' | 'gender' | 'language' | 'tag'
  defaults: SegmentRule
}

const days = (max = 3650): NumberParam => ({ key: 'days', min: 1, max })
const count = (min = 0): NumberParam => ({ key: 'count', min, max: 1000 })

export const RULE_DEFS: Record<RuleKind, RuleDef> = {
  lapsed: { group: 'visits', hasAfter: true, number: days(), defaults: { kind: 'lapsed', days: 60 } },
  visited_within: {
    group: 'visits',
    hasAfter: true,
    number: days(),
    defaults: { kind: 'visited_within', days: 30 },
  },
  visits_at_least: {
    group: 'visits',
    hasAfter: true,
    number: count(1),
    defaults: { kind: 'visits_at_least', count: 2 },
  },
  visits_at_most: {
    group: 'visits',
    hasAfter: true,
    number: count(1),
    defaults: { kind: 'visits_at_most', count: 1 },
  },
  service: { group: 'visits', select: 'service', defaults: { kind: 'service', serviceId: '' } },
  no_shows_at_least: {
    group: 'visits',
    hasAfter: true,
    number: count(1),
    defaults: { kind: 'no_shows_at_least', count: 1 },
  },
  spent_at_least: {
    group: 'spend',
    hasAfter: true,
    number: { key: 'aed', min: 1, max: 1_000_000 },
    defaults: { kind: 'spent_at_least', aed: 2000 },
  },
  birthday_month: { group: 'birthday', defaults: { kind: 'birthday_month' } },
  birthday_within: {
    group: 'birthday',
    hasAfter: true,
    number: days(90),
    defaults: { kind: 'birthday_within', days: 14 },
  },
  gender: { group: 'profile', select: 'gender', defaults: { kind: 'gender', gender: 'female' } },
  language: { group: 'profile', select: 'language', defaults: { kind: 'language', language: 'ar' } },
  tag: { group: 'profile', select: 'tag', defaults: { kind: 'tag', tag: '' } },
  has_package: { group: 'packages', defaults: { kind: 'has_package' } },
  package_expiring: {
    group: 'packages',
    hasAfter: true,
    number: days(365),
    defaults: { kind: 'package_expiring', days: 14 },
  },
}

export const RULE_GROUPS = ['visits', 'spend', 'birthday', 'profile', 'packages'] as const
export const GENDERS = ['female', 'male', 'other'] as const
export const LANGUAGES = ['en', 'ar'] as const

export const ruleLabel = (t: Translator, kind: RuleKind) => t(`campaigns.rule.${kind}.label`)
export const ruleBefore = (t: Translator, kind: RuleKind) => t(`campaigns.rule.${kind}.before`)
export const ruleAfter = (t: Translator, kind: RuleKind) =>
  RULE_DEFS[kind].hasAfter ? t.maybe(`campaigns.rule.${kind}.after`) : undefined

/** Human sentence for a rule ("Last visit more than 60 days ago"); service names and tags stay as typed. */
export function describeRule(
  t: Translator,
  fmt: Format,
  r: SegmentRule,
  serviceName?: (id: string) => string | undefined,
) {
  const before = ruleBefore(t, r.kind)
  switch (r.kind) {
    case 'service':
      return `${before} ${serviceName?.(r.serviceId) ?? t('campaigns.rule.aTreatment')}`
    case 'gender':
      return `${before} ${t(`campaigns.gender.${r.gender}`)}`
    case 'language':
      return `${before} ${t(`campaigns.language.${r.language}`)}`
    case 'tag':
      return `${before} “${r.tag}”`
    default: {
      const key = RULE_DEFS[r.kind].number?.key
      const n = key ? (r as Record<string, unknown>)[key] : undefined
      return [before, typeof n === 'number' ? fmt.number(n) : n, ruleAfter(t, r.kind)]
        .filter((p) => p !== undefined && p !== '')
        .join(' ')
    }
  }
}

/** One line for a whole segment (or "everyone" when it has no conditions). */
export const summarizeRules = (
  t: Translator,
  fmt: Format,
  rules: SegmentRule[],
  serviceName?: (id: string) => string | undefined,
) =>
  rules.length
    ? rules.map((r) => describeRule(t, fmt, r, serviceName)).join(' · ')
    : t('campaigns.everyone')

/** Presets; name + description via `campaigns.preset.<key>.{name,description}`. */
export type SegmentPreset = { key: 'winback' | 'birthday' | 'packageExpiring' | 'vip' | 'firstTimers'; slug: string; rules: SegmentRule[] }

export const SEGMENT_PRESETS: SegmentPreset[] = [
  { key: 'winback', slug: 'winback', rules: [{ kind: 'lapsed', days: 60 }] },
  { key: 'birthday', slug: 'birthday', rules: [{ kind: 'birthday_month' }] },
  { key: 'packageExpiring', slug: 'package-expiring', rules: [{ kind: 'package_expiring', days: 14 }] },
  { key: 'vip', slug: 'vip', rules: [{ kind: 'spent_at_least', aed: 2000 }] },
  {
    key: 'firstTimers',
    slug: 'first-timers',
    rules: [
      { kind: 'visits_at_least', count: 1 },
      { kind: 'visits_at_most', count: 1 },
    ],
  },
]
export const presetName = (t: Translator, p: SegmentPreset) => t(`campaigns.preset.${p.key}.name`)
export const presetDescription = (t: Translator, p: SegmentPreset) => t(`campaigns.preset.${p.key}.description`)

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
      z.object({ kind: z.literal('service'), serviceId: z.uuid('campaigns.validation.chooseTreatment') }),
      z.object({ kind: z.literal('birthday_month') }),
      z.object({ kind: z.literal('birthday_within'), days: int(1, 90) }),
      z.object({ kind: z.literal('gender'), gender: z.enum(['female', 'male', 'other']) }),
      z.object({ kind: z.literal('language'), language: z.enum(['en', 'ar']) }),
      z.object({ kind: z.literal('tag'), tag: z.string().trim().min(1, 'campaigns.validation.chooseTag').max(40) }),
      z.object({ kind: z.literal('has_package') }),
      z.object({ kind: z.literal('package_expiring'), days: int(1, 365) }),
      z.object({ kind: z.literal('no_shows_at_least'), count: int(1, 1000) }),
    ]),
  )
  .max(12, 'campaigns.validation.maxConditions')

/** Rules that are complete enough to preview (a service/tag picked). */
export const completeRules = (rules: SegmentRule[]) =>
  rules.filter((r) => (r.kind === 'service' ? r.serviceId : r.kind === 'tag' ? r.tag.trim() : true))

// ── Campaign messages ────────────────────────────────────────────────────────

/** Labels: `campaigns.variables.<key>`. */
export const CAMPAIGN_VARIABLES = ['name', 'spa', 'booking_link', 'offer_code'] as const
const KNOWN = new Set<string>([...CAMPAIGN_VARIABLES, 'first_name', 'full_name'])

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

export type CampaignStateKey =
  | 'campaigns.state.archived'
  | 'campaigns.state.draft'
  | 'campaigns.state.scheduled'
  | 'campaigns.state.sending'
  | 'campaigns.state.done'

export function campaignState(
  c: CampaignView,
  pending: number,
  now = new Date(),
): { key: CampaignStateKey; tone: Tone } {
  if (c.archivedAt) return { key: 'campaigns.state.archived', tone: 'neutral' }
  if (c.status === 'draft') return { key: 'campaigns.state.draft', tone: 'neutral' }
  if (c.status === 'queued' && c.scheduledAt && new Date(c.scheduledAt) > now)
    return { key: 'campaigns.state.scheduled', tone: 'warn' }
  if (c.status === 'queued' && pending > 0) return { key: 'campaigns.state.sending', tone: 'acc' }
  return { key: 'campaigns.state.done', tone: 'ok' }
}
