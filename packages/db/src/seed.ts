import { grantListedPlatformAdmins } from './admins'
import type { Db } from './client'
import { aiModelConfig, plans, platformSettings } from './schema'

/** Model defaults from docs/PLAN.md §7 (2026-10). Super-admin can change them; seeding never overwrites. */
export const defaultAiModels: (typeof aiModelConfig.$inferInsert)[] = [
  {
    agentKey: 'dm_agent',
    label: 'Instagram DMs & booking',
    modelId: 'seed-2-0-lite-260428',
    supportsStructuredOutput: true,
    priceInPerM: '0.25',
    priceOutPerM: '2.00',
    priceCachedInPerM: '0.05',
  },
  {
    agentKey: 'comment_agent',
    label: 'Instagram comment replies',
    modelId: 'seed-2-0-lite-260428',
    supportsStructuredOutput: true,
    priceInPerM: '0.25',
    priceOutPerM: '2.00',
    priceCachedInPerM: '0.05',
  },
  {
    agentKey: 'review_agent',
    label: 'Google review replies',
    modelId: 'seed-2-0-lite-260428',
    supportsStructuredOutput: true,
    priceInPerM: '0.25',
    priceOutPerM: '2.00',
    priceCachedInPerM: '0.05',
  },
  {
    agentKey: 'content_agent',
    label: 'Instagram content & captions',
    modelId: 'seed-2-0-pro-260328',
    priceInPerM: '0.50',
    priceOutPerM: '3.00',
    priceCachedInPerM: '0.10',
  },
  {
    agentKey: 'seo_agent',
    label: 'SEO',
    modelId: 'seed-2-0-pro-260328',
    priceInPerM: '0.50',
    priceOutPerM: '3.00',
    priceCachedInPerM: '0.10',
  },
  {
    agentKey: 'site_generator',
    label: 'Site generator',
    modelId: 'seed-2-0-pro-260328',
    priceInPerM: '0.50',
    priceOutPerM: '3.00',
    priceCachedInPerM: '0.10',
  },
  {
    // R16: Website Studio "Ask AI" — returns typed edit ops (validated against the block schema).
    agentKey: 'site_editor',
    label: 'Website Studio AI edits',
    modelId: 'seed-2-0-pro-260328',
    priceInPerM: '0.50',
    priceOutPerM: '3.00',
    priceCachedInPerM: '0.10',
  },
  {
    // R7: "AI tools via Meta MCP" assistant (Instagram / Facebook Page / WhatsApp drafts through MCP tools).
    agentKey: 'meta_agent',
    label: 'Meta tools assistant (MCP)',
    modelId: 'seed-2-0-pro-260328',
    priceInPerM: '0.50',
    priceOutPerM: '3.00',
    priceCachedInPerM: '0.10',
  },
  {
    agentKey: 'insights_agent',
    label: 'Weekly insights',
    modelId: 'seed-2-0-pro-260328',
    priceInPerM: '0.50',
    priceOutPerM: '3.00',
    priceCachedInPerM: '0.10',
  },
  {
    // F30: dashboard "Ask AI" for spa staff (read-only tools over the spa's own data).
    agentKey: 'staff_assistant',
    label: 'Dashboard Ask AI (staff questions)',
    modelId: 'seed-2-0-lite-260428',
    priceInPerM: '0.25',
    priceOutPerM: '2.00',
    priceCachedInPerM: '0.05',
  },
  {
    agentKey: 'translator',
    label: 'Translation & alt text',
    modelId: 'seed-2-0-mini-260428',
    supportsStructuredOutput: true,
    priceInPerM: '0.10',
    priceOutPerM: '0.40',
    priceCachedInPerM: '0.02',
  },
  {
    agentKey: 'image_default',
    label: 'Images (posts, stories)',
    modelId: 'dola-seedream-5-0-flash-260915',
    kind: 'image',
    supportsTools: false,
    pricePerImage: '0.018',
  },
  {
    agentKey: 'image_hero',
    label: 'Images (hero / premium)',
    modelId: 'dola-seedream-5-0-pro-260628',
    kind: 'image',
    supportsTools: false,
    pricePerImage: '0.045',
  },
]

const ALL_FEATURES = { ai: true, marketing: true, multiBranch: true }

/** Feature switches (`limits`) follow `tierLimits` in @spa/core; missing switch = included. */
export const defaultPlans: (typeof plans.$inferInsert)[] = [
  {
    code: 'premium',
    name: 'Premium',
    description:
      'Everything: AI receptionist and Instagram automation, marketing tools and as many branches as you need.',
    priceAed: '36000',
    setupFeeAed: '14000',
    billingInterval: 'month',
    trialDays: 14,
    limits: { ...ALL_FEATURES },
    sort: 1,
  },
  {
    code: 'standard',
    name: 'Standard',
    description:
      'The spa CRM: calendar, online booking, POS, accounts, staff, payroll, inventory and your website, for one branch.',
    priceAed: '24000',
    setupFeeAed: '9000',
    billingInterval: 'month',
    trialDays: 14,
    limits: { ai: false, marketing: false, multiBranch: false },
    sort: 2,
  },
  {
    code: 'legacy-yearly',
    name: 'Yearly (legacy)',
    description:
      'The original AED 24,000 per year plan with every feature. Kept for existing spas until renewal.',
    priceAed: '24000',
    billingInterval: 'year',
    trialDays: 14,
    limits: { branches: 3, staff: 50, customDomain: true, aiBudgetUsd: 25, ...ALL_FEATURES },
    active: false,
    sort: 90,
  },
]

export async function seedPlatform(db: Db, adminEmails: string[] = []) {
  // New installs: the public contact address (= PLATFORM_CONTACT_EMAIL in @spa/core); a saved company email is kept.
  await db.insert(platformSettings).values({ id: 1, email: 'ask@spamanagement.co' }).onConflictDoNothing()
  // PLAN §18.8 (owner 2026-10-09): Premium + Standard (setup + monthly, excl. VAT; price_aed = 12 months, paid as 12
  // monthly invoices) and the old yearly plan as an inactive legacy plan (existing spas keep it until renewal).
  // Existing installs get the same rows from migration 0036 (the old `standard` row is renamed `legacy-yearly`).
  await db.insert(plans).values(defaultPlans).onConflictDoNothing()
  await db.insert(aiModelConfig).values(defaultAiModels).onConflictDoNothing()
  // G2: listed emails are promoted only once verified; existing super-admins are never demoted.
  await grantListedPlatformAdmins(db, adminEmails)
}
