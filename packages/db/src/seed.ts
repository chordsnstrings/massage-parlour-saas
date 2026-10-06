import { inArray } from 'drizzle-orm'
import type { Db } from './client'
import { aiModelConfig, plans, platformAdmins, platformSettings, user } from './schema'

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
    agentKey: 'insights_agent',
    label: 'Weekly insights',
    modelId: 'seed-2-0-pro-260328',
    priceInPerM: '0.50',
    priceOutPerM: '3.00',
    priceCachedInPerM: '0.10',
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

export async function seedPlatform(db: Db, adminEmails: string[] = []) {
  await db.insert(platformSettings).values({ id: 1 }).onConflictDoNothing()
  await db
    .insert(plans)
    .values({
      code: 'standard',
      name: 'Standard',
      description: 'Everything included: booking, POS, accounting, site builder, analytics and AI agents.',
      priceAed: '24000',
      billingInterval: 'year',
      trialDays: 14,
      limits: { branches: 3, staff: 50, customDomain: true, aiBudgetUsd: 25 },
    })
    .onConflictDoNothing()
  await db.insert(aiModelConfig).values(defaultAiModels).onConflictDoNothing()
  const emails = adminEmails.map((e) => e.trim().toLowerCase()).filter(Boolean)
  if (emails.length) {
    const admins = await db.select({ id: user.id }).from(user).where(inArray(user.email, emails))
    if (admins.length) {
      await db
        .insert(platformAdmins)
        .values(admins.map((a) => ({ userId: a.id })))
        .onConflictDoNothing()
    }
  }
}
