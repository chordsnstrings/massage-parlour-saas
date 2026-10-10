// Plans + entitlements (PLAN §18.8, owner 2026-10-09). The single source of truth for what each plan includes:
// web (nav, pages, actions), the AI gateway, the worker and the marketing pricing table all read these helpers.
// Premium = every feature; Standard = the core spa CRM (no AI & Instagram automation, no marketing tools, one
// branch). The yearly AED 24,000 plan stays as an inactive legacy plan (every feature) until each spa's renewal.

import type { AutomationKey } from './automations'
import { createFormat } from './i18n/format'

/** Plan codes (`plans.code`); code never hard-codes plan ids. */
export const PLAN_CODES = {
  premium: 'premium',
  standard: 'standard',
  legacyYearly: 'legacy-yearly',
} as const
export type PlanCode = (typeof PLAN_CODES)[keyof typeof PLAN_CODES]

/**
 * Gated feature keys. `ai` = AI receptionist, Instagram inbox + DM replies / booking from chat, AI insights, receipt
 * scan, AI tools (Meta MCP). `marketing` = campaigns (win-back / birthday drafts), Google Business + Instagram posting,
 * review requests + replies, quiet-slot offers. `multiBranch` = more than one active branch.
 */
export const FEATURES = ['ai', 'marketing', 'multiBranch'] as const
export type Feature = (typeof FEATURES)[number]
/** English names (marketing pricing page, console, services' English errors); the dashboard uses `plan.feature.*`. */
export const FEATURE_LABELS: Record<Feature, string> = {
  ai: 'AI & Instagram automation',
  marketing: 'Marketing tools',
  multiBranch: 'More branches',
}
export const isFeature = (v: unknown): v is Feature =>
  typeof v === 'string' && (FEATURES as readonly string[]).includes(v)

/** Feature tiers: what a plan includes, and the super-admin's per-spa override (`tenants.feature_tier`). */
export const FEATURE_TIERS = ['premium', 'standard'] as const
export type FeatureTier = (typeof FEATURE_TIERS)[number]
export const isFeatureTier = (v: unknown): v is FeatureTier => v === 'premium' || v === 'standard'
export const TIER_FEATURES: Record<FeatureTier, readonly Feature[]> = { premium: FEATURES, standard: [] }

/**
 * AI agents our studio runs on the spa's website (Website Studio: super-admins only). The website is on every plan,
 * so these never need the `ai` feature; every other agent does (AI gateway, packages/ai).
 */
export const STUDIO_AI_AGENTS: readonly string[] = [
  'site_generator',
  'site_editor',
  'translator',
  'seo_agent',
]

/**
 * Automation switches (Automations page, worker jobs) that need a feature: the worker skips spas without it and the
 * page shows them as "Available on Premium". Others (booking messages, package expiry, digests…) are on every plan.
 */
export const AUTOMATION_FEATURE: Partial<Record<AutomationKey, Feature>> = {
  slotFiller: 'marketing',
  instagram: 'marketing',
  googleReviews: 'marketing',
  weeklyInsights: 'ai',
  // F15 automatic client message drafts.
  reviewRequests: 'marketing',
  birthdayMessages: 'marketing',
  winbackMessages: 'marketing',
}

/** Active branches a spa without `multiBranch` may have. */
export const SINGLE_BRANCH_LIMIT = 1

/** `plans.limits`: feature switches (booleans) + caps such as `branches` (number). */
export type PlanLimits = Record<string, number | boolean> | null | undefined

/** The `plans.limits` feature switches of a tier (merged into a plan's other limits). */
export const tierLimits = (tier: FeatureTier): Record<Feature, boolean> =>
  Object.fromEntries(FEATURES.map((f) => [f, TIER_FEATURES[tier].includes(f)])) as Record<Feature, boolean>

/**
 * Features a plan grants. A switch that is missing counts as included, so plans made before §18.8 (and spas
 * without a plan) keep everything; the seeded plans set every switch explicitly.
 */
export const planFeatures = (limits: PlanLimits): Feature[] => FEATURES.filter((f) => limits?.[f] !== false)

/** The tier a plan's switches amount to: Premium when it grants every feature. */
export const planTier = (limits: PlanLimits): FeatureTier =>
  planFeatures(limits).length === FEATURES.length ? 'premium' : 'standard'

/** Effective features of a spa: the super-admin's tier override wins, else its plan's switches. */
export function effectiveFeatures(limits: PlanLimits, override?: FeatureTier | null): Feature[] {
  return override ? [...TIER_FEATURES[override]] : planFeatures(limits)
}

/** Active-branch cap: 1 without `multiBranch`, else the plan's `limits.branches` (null = no cap). */
export function branchCap(features: readonly Feature[], limits: PlanLimits): number | null {
  if (!features.includes('multiBranch')) return SINGLE_BRANCH_LIMIT
  const v = limits?.branches
  return typeof v === 'number' && v > 0 ? v : null
}

/** Monthly amount of a plan or subscription price (stored per 12-month period, R3: 12 monthly invoices). */
export const monthlyAed = (yearlyAed: string | number) => (Number(yearlyAed) / 12).toFixed(2)

const aedEn = createFormat('en').aed

/**
 * English price line of a plan (console, emails): monthly plans "setup AED 14,000 + AED 3,000/month", the legacy
 * yearly plan "AED 24,000/year" (+ setup when it has one). Prices are excl. VAT.
 */
export function planPriceLine(p: { priceAed: string; setupFeeAed: string; billingInterval: string }) {
  const price =
    p.billingInterval === 'month' ? `${aedEn(monthlyAed(p.priceAed))}/month` : `${aedEn(p.priceAed)}/year`
  return Number(p.setupFeeAed) > 0 ? `setup ${aedEn(p.setupFeeAed)} + ${price}` : price
}

/**
 * The comparison table on the pricing page (and the Premium upsell): every row is true on Premium; `feature: null`
 * rows are on every plan. Keep it truthful — Standard keeps everything that isn't gated by a feature key.
 */
export type PlanFeatureRow = { key: string; label: string; feature: Feature | null }
export const PLAN_FEATURES: readonly PlanFeatureRow[] = [
  { key: 'calendar', label: 'Calendar, rooms and resources', feature: null },
  { key: 'booking', label: 'Online booking page and booking widget', feature: null },
  { key: 'pos', label: 'Point of sale and tax invoices', feature: null },
  { key: 'packages', label: 'Packages, gift cards and memberships', feature: null },
  { key: 'clients', label: 'Clients, intake forms and visit history', feature: null },
  { key: 'staff', label: 'Staff, time clock, commission and payroll / WPS', feature: null },
  { key: 'inventory', label: 'Inventory, purchases and warehouse', feature: null },
  { key: 'whatsapp', label: 'WhatsApp click-to-send confirmations and reminders', feature: null },
  { key: 'website', label: 'Website built by our studio, your own domain', feature: null },
  { key: 'reports', label: 'Reports, accounts and VAT', feature: null },
  { key: 'languages', label: 'Dashboard in English and Thai', feature: null },
  { key: 'security', label: 'Two-factor sign-in and an installable app', feature: null },
  { key: 'aiReceptionist', label: 'AI receptionist', feature: 'ai' },
  { key: 'instagram', label: 'Instagram inbox: AI replies and booking from chat', feature: 'ai' },
  { key: 'insights', label: 'AI insights', feature: 'ai' },
  { key: 'receipts', label: 'Receipt scanning for expenses', feature: 'ai' },
  { key: 'campaigns', label: 'Campaigns: win-back, birthday and quiet-slot offers', feature: 'marketing' },
  { key: 'posting', label: 'Google Business and Instagram posting', feature: 'marketing' },
  { key: 'reviews', label: 'Review requests and AI review replies', feature: 'marketing' },
  { key: 'branches', label: 'More than one branch', feature: 'multiBranch' },
]

/** Is this row included in a tier? */
export const rowIncluded = (row: PlanFeatureRow, tier: FeatureTier) =>
  row.feature === null || TIER_FEATURES[tier].includes(row.feature)

// --- Per-spa discounts (super-admin, PLAN §18.8) -------------------------------------------------------------

export const DISCOUNT_KINDS = ['amount', 'percent'] as const
export type DiscountKind = (typeof DISCOUNT_KINDS)[number]
/** `value`: AED (amount) or 0–100 (percent), as a decimal string. */
export type Discount = { kind: DiscountKind; value: string }
/** `subscriptions.discounts`: on the one-time setup fee and/or each monthly fee. */
export type SubscriptionDiscounts = { setup?: Discount | null; monthly?: Discount | null }

const cents = (v: string | number) => Math.round(Number(v) * 100)

/**
 * Parses a discount from form fields. Empty / zero value → null (no discount); a bad value → an error message.
 * Percent 0 < v ≤ 100; amount > 0.
 */
export function parseDiscount(kind: string | null | undefined, value: string | null | undefined) {
  const raw = (value ?? '').replace(/,/g, '').replace(/%$/, '').trim()
  if (!kind || kind === 'none' || raw === '' || Number(raw) === 0)
    return { ok: true as const, discount: null }
  if (kind !== 'amount' && kind !== 'percent') return { ok: false as const, error: 'Choose AED or %' }
  const n = Number(raw)
  if (!/^\d+(\.\d{1,2})?$/.test(raw) || !Number.isFinite(n) || n <= 0)
    return { ok: false as const, error: 'Enter a positive number (up to 2 decimals)' }
  if (kind === 'percent' && n > 100) return { ok: false as const, error: 'A percentage is at most 100' }
  return { ok: true as const, discount: { kind, value: n.toFixed(2) } as Discount }
}

/**
 * Applies a discount to an amount (AED). An amount discount is per month: a plan invoice covering `months` months
 * (the legacy one-time yearly invoice = 12) gets `months` × it. Never below 0. Percent rounds to the cent.
 */
export function applyDiscount(amountAed: string | number, d: Discount | null | undefined, months = 1) {
  const base = cents(amountAed)
  const off = !d
    ? 0
    : Math.min(
        base,
        d.kind === 'percent' ? Math.round((base * Number(d.value)) / 100) : cents(d.value) * months,
      )
  return { netAed: ((base - off) / 100).toFixed(2), discountAed: (off / 100).toFixed(2) }
}

/**
 * Subtotal / VAT / total of an entered amount per the platform's VAT settings (`vatRate` %, prices incl. VAT or
 * not); `chargeVat: false` → no VAT (PLAN §18.3). Services' `invoiceTotals` and the console's live hints use it.
 */
export function vatTotals(
  amount: number,
  s?: { vatRate: string; pricesIncludeVat: boolean } | null,
  chargeVat = true,
) {
  const rate = chargeVat ? Number(s?.vatRate ?? 5) : 0
  const vat = s?.pricesIncludeVat ? (amount * rate) / (100 + rate) : (amount * rate) / 100
  const subtotal = s?.pricesIncludeVat ? amount - vat : amount
  return { subtotalAed: subtotal.toFixed(2), vatAed: vat.toFixed(2), totalAed: (subtotal + vat).toFixed(2) }
}

/** "10%" / "AED 500.00" (per month for the monthly fee). */
export const discountLabel = (d: Discount) =>
  d.kind === 'percent' ? `${Number(d.value)}%` : `AED ${Number(d.value).toFixed(2)}`
