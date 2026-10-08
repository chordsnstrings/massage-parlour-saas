'use server'
import { dubaiInstant, dubaiParts } from '@spa/core'
import { campaigns, promoCodes, type SegmentRule, segments, withTenant } from '@spa/db'
import {
  archiveCampaign,
  DomainError,
  duplicateCampaign,
  planAudience,
  queueCampaign,
  resolveSegment,
} from '@spa/services'
import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { formatPhone, maskPhone } from '@/components/calendar/time'
import { MAX_MESSAGE, segmentRulesSchema, unknownCampaignVariables } from '@/components/campaigns/rules'
import { type ActionResult, fail, failDomain, formObject, fromZod, ok } from '@/lib/action'
import { appPath } from '@/lib/paths'
import { can, guard } from '@/server/access'
import { audit } from '@/server/audit'
import { publicSiteUrl } from '@/server/sites'

const refresh = (slug: string) => {
  revalidatePath(`/dashboard/${slug}/campaigns`, 'layout')
  revalidatePath(`/dashboard/${slug}/messages`)
}
const page = (slug: string, path = '') => appPath(`/${slug}/campaigns${path}`)

function parseRules(raw: unknown) {
  let value: unknown = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw || '[]')
    } catch {
      value = null
    }
  }
  return segmentRulesSchema.safeParse(value)
}

/** Ids arrive through `.bind()` from the client; anything but a UUID is treated as "not found". */
const badId = (id: string | null) => id !== null && !z.uuid().safeParse(id).success

/** A domain error tied to one form field. */
class FieldError extends DomainError {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message)
  }
}

/** Dubai wall-clock "YYYY-MM-DDTHH:MM" → instant. */
function dubaiLocal(value: string | undefined) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(value ?? '')
  return m ? dubaiInstant(m[1]!, Number(m[2]) * 60 + Number(m[3])) : null
}

// ── Segments ─────────────────────────────────────────────────────────────────

/** Live preview for the segment builder: how many clients match, and the first ten. */
export async function previewSegmentAction(slug: string, rules: unknown): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'marketing.campaigns')
  if (error) return fail(error)
  const parsed = parseRules(rules)
  if (!parsed.success) return fromZod(parsed.error)
  const people = await withTenant(ctx.tenant.id, (tx) =>
    resolveSegment(tx, ctx.tenant.id, parsed.data as SegmentRule[]),
  )
  const seePhone = can(ctx, 'clients.phone')
  return ok(undefined, {
    count: people.length,
    sample: people.slice(0, 10).map((p) => ({
      id: p.id,
      name: p.name,
      phone: seePhone ? formatPhone(p.phone!) : maskPhone(p.phone!),
      language: p.language,
      lastVisitAt: p.lastVisitAt?.toISOString() ?? null,
    })),
  })
}

export async function saveSegmentAction(
  slug: string,
  id: string | null,
  _p: ActionResult,
  fd: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'marketing.campaigns')
  if (error) return fail(error)
  if (badId(id)) return fail('campaigns.errors.segmentNotFound')
  const raw = formObject(fd)
  const parsed = z
    .object({
      name: z.string().trim().min(2, 'campaigns.validation.segmentName').max(60),
      intent: z.enum(['save', 'campaign']).default('save'),
    })
    .safeParse(raw)
  if (!parsed.success) return fromZod(parsed.error)
  const rules = parseRules(raw.rules)
  if (!rules.success) return fail(rules.error.issues[0]?.message ?? 'campaigns.validation.checkConditions')
  const values = { name: parsed.data.name, rules: rules.data as SegmentRule[] }
  const saved = await withTenant(ctx.tenant.id, async (tx) => {
    if (id) {
      const [row] = await tx.update(segments).set(values).where(eq(segments.id, id)).returning()
      return row
    }
    const [row] = await tx
      .insert(segments)
      .values({ tenantId: ctx.tenant.id, ...values })
      .returning()
    return row
  })
  if (!saved) return fail('campaigns.errors.segmentNotFound')
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: id ? 'segment.updated' : 'segment.created',
    entity: 'segment',
    entityId: saved.id,
    data: values,
  })
  refresh(slug)
  return ok(id ? 'campaigns.results.segmentUpdated' : 'campaigns.results.segmentSaved', {
    href:
      parsed.data.intent === 'campaign'
        ? page(slug, `/new?segment=${saved.id}`)
        : page(slug, '?tab=segments'),
  })
}

export async function deleteSegmentAction(
  slug: string,
  id: string,
  _p: ActionResult,
  _fd: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'marketing.campaigns')
  if (error) return fail(error)
  if (badId(id)) return fail('campaigns.errors.segmentNotFound')
  const gone = await withTenant(ctx.tenant.id, (tx) =>
    tx.delete(segments).where(eq(segments.id, id)).returning({ id: segments.id, name: segments.name }),
  )
  if (!gone.length) return fail('campaigns.errors.segmentNotFound')
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: 'segment.deleted',
    entity: 'segment',
    entityId: id,
    data: gone[0],
  })
  refresh(slug)
  return ok('campaigns.results.segmentDeleted', { href: page(slug, '?tab=segments') })
}

// ── Campaigns ────────────────────────────────────────────────────────────────

const estimateInput = z.object({
  segmentId: z.uuid(),
  when: z.enum(['now', 'later']),
  sendAt: z.string().optional(),
  campaignId: z.uuid().nullish(),
})

/** Audience for the composer: recipients after the 7-day cap and 500 limit, split by language. */
export async function estimateAudienceAction(
  slug: string,
  input: z.input<typeof estimateInput>,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'marketing.campaigns')
  if (error) return fail(error)
  const parsed = estimateInput.safeParse(input)
  if (!parsed.success) return fromZod(parsed.error)
  const d = parsed.data
  const sendAt = (d.when === 'later' && dubaiLocal(d.sendAt)) || new Date()
  const plan = await withTenant(ctx.tenant.id, async (tx) => {
    const [seg] = await tx.select().from(segments).where(eq(segments.id, d.segmentId))
    if (!seg) return null
    return planAudience(tx, ctx.tenant.id, seg.rules, {
      sendAt,
      excludeCampaignId: d.campaignId ?? undefined,
    })
  })
  if (!plan) return fail('campaigns.errors.segmentNotFound')
  const ar = plan.recipients.filter((r) => r.language === 'ar')
  const en = plan.recipients.filter((r) => r.language !== 'ar')
  return ok(undefined, {
    matched: plan.matched,
    recipients: plan.recipients.length,
    skippedRecent: plan.skippedRecent,
    skippedOverLimit: plan.skippedOverLimit,
    en: en.length,
    ar: ar.length,
    sampleEn: en[0]?.name ?? null,
    sampleAr: ar[0]?.name ?? null,
  })
}

const campaignInput = z.object({
  name: z.string().trim().min(2, 'campaigns.validation.campaignName').max(80),
  segmentId: z.uuid('campaigns.validation.chooseSegment'),
  bodyEn: z
    .string()
    .trim()
    .min(5, 'campaigns.validation.englishMessage')
    .max(MAX_MESSAGE, 'campaigns.validation.tooLong'),
  bodyAr: z.string().trim().max(MAX_MESSAGE, 'campaigns.validation.tooLong').optional(),
  promoCodeId: z
    .uuid()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  when: z.enum(['now', 'later']),
  sendAt: z.string().optional(),
  intent: z.enum(['draft', 'queue']),
})

export async function saveCampaignAction(
  slug: string,
  id: string | null,
  _p: ActionResult,
  fd: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'marketing.campaigns')
  if (error) return fail(error)
  if (badId(id)) return fail('campaigns.errors.campaignNotFound')
  const parsed = campaignInput.safeParse(formObject(fd))
  if (!parsed.success) return fromZod(parsed.error)
  const d = parsed.data
  const fieldErrors: Record<string, string> = {}
  for (const [field, text] of [
    ['bodyEn', d.bodyEn],
    ['bodyAr', d.bodyAr ?? ''],
  ] as const) {
    const unknown = unknownCampaignVariables(text)
    if (unknown.length) fieldErrors[field] = 'campaigns.validation.unknownVariable'
  }
  if (!d.promoCodeId && /\{offer_code\}/.test(`${d.bodyEn} ${d.bodyAr ?? ''}`))
    fieldErrors.promoCodeId = 'campaigns.validation.chooseOffer'
  const now = new Date()
  const bookingLink = `${await publicSiteUrl(ctx.tenant)}/book?src=campaign`
  let sendAt: Date | null = null
  if (d.when === 'later') {
    sendAt = dubaiLocal(d.sendAt)
    if (!sendAt) fieldErrors.sendAt = 'campaigns.validation.pickDateTime'
    else if (sendAt.getTime() < now.getTime() + 60_000) fieldErrors.sendAt = 'campaigns.validation.future'
    else if (sendAt.getTime() > now.getTime() + 90 * 86_400_000)
      fieldErrors.sendAt = 'campaigns.validation.maxAhead'
  }
  if (Object.keys(fieldErrors).length) return fail('errors.checkFields', fieldErrors)

  const values = {
    name: d.name,
    segmentId: d.segmentId,
    body: { en: d.bodyEn, ar: d.bodyAr || undefined },
    promoCodeId: d.promoCodeId ?? null,
    scheduledAt: sendAt,
    updatedAt: now,
  }
  let result: { id: string; queued: number | null }
  try {
    result = await withTenant(ctx.tenant.id, async (tx) => {
      const [seg] = await tx.select().from(segments).where(eq(segments.id, d.segmentId))
      if (!seg)
        throw new DomainError('That segment no longer exists', 'invalid', {
          key: 'campaigns.errors.segmentGone',
        })
      if (d.promoCodeId) {
        const [promo] = await tx
          .select()
          .from(promoCodes)
          .where(and(eq(promoCodes.id, d.promoCodeId), eq(promoCodes.active, true)))
        if (!promo) throw new FieldError('promoCodeId', 'campaigns.validation.promoGone')
        // The code must still work on the day clients receive it.
        const sendDay = dubaiParts(sendAt ?? now).date
        if (promo.validTo && promo.validTo < sendDay)
          throw new FieldError('promoCodeId', 'campaigns.validation.promoExpires')
        if (promo.validFrom && promo.validFrom > sendDay)
          throw new FieldError('promoCodeId', 'campaigns.validation.promoNotStarted')
        if (promo.maxUses !== null && promo.uses >= promo.maxUses)
          throw new FieldError('promoCodeId', 'campaigns.validation.promoUsedUp')
      }
      let campaignId = id
      if (id) {
        const [row] = await tx
          .update(campaigns)
          .set({ ...values, rules: seg.rules })
          .where(and(eq(campaigns.id, id), eq(campaigns.status, 'draft')))
          .returning({ id: campaigns.id })
        if (!row)
          throw new DomainError('Only drafts can be edited', 'invalid', {
            key: 'campaigns.errors.onlyDrafts',
          })
      } else {
        const [row] = await tx
          .insert(campaigns)
          .values({ tenantId: ctx.tenant.id, ...values, rules: seg.rules, createdBy: ctx.user.id })
          .returning({ id: campaigns.id })
        campaignId = row!.id
      }
      if (d.intent === 'draft') return { id: campaignId!, queued: null }
      const queued = await queueCampaign(tx, campaignId!, seg.rules, {
        sendAt: sendAt ?? now,
        bookingLink,
        now,
      })
      if (queued === 0)
        throw new DomainError(
          'Nobody in this segment can be messaged right now (opted out, or already messaged this week).',
          'invalid',
          { key: 'campaigns.errors.nobody' },
        )
      return { id: campaignId!, queued }
    })
  } catch (e) {
    if (e instanceof FieldError) return fail('errors.checkFields', { [e.field]: e.message })
    if (e instanceof DomainError) return failDomain(e)
    throw e
  }
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: result.queued === null ? 'campaign.saved' : 'campaign.queued',
    entity: 'campaign',
    entityId: result.id,
    data: { ...values, queued: result.queued },
  })
  refresh(slug)
  return ok(
    result.queued === null
      ? 'campaigns.results.draftSaved'
      : { key: 'campaigns.results.queued', params: { count: result.queued } },
    { href: page(slug, `/${result.id}`) },
  )
}

export async function duplicateCampaignAction(
  slug: string,
  id: string,
  _p: ActionResult,
  _fd: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'marketing.campaigns')
  if (error) return fail(error)
  if (badId(id)) return fail('campaigns.errors.campaignNotFound')
  let copyId: string
  try {
    copyId = (await withTenant(ctx.tenant.id, (tx) => duplicateCampaign(tx, id, ctx.user.id))).id
  } catch (e) {
    if (e instanceof DomainError) return failDomain(e)
    throw e
  }
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: 'campaign.duplicated',
    entity: 'campaign',
    entityId: copyId,
    data: { from: id },
  })
  refresh(slug)
  return ok('campaigns.results.duplicated', { href: page(slug, `/${copyId}/edit`) })
}

export async function archiveCampaignAction(
  slug: string,
  id: string,
  archivedInput: boolean,
  _p: ActionResult,
  _fd: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'marketing.campaigns')
  if (error) return fail(error)
  if (badId(id)) return fail('campaigns.errors.campaignNotFound')
  const archived = archivedInput === true
  let withdrawn: number
  try {
    withdrawn = await withTenant(ctx.tenant.id, (tx) => archiveCampaign(tx, id, archived))
  } catch (e) {
    if (e instanceof DomainError) return failDomain(e)
    throw e
  }
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: archived ? 'campaign.archived' : 'campaign.restored',
    entity: 'campaign',
    entityId: id,
    data: { withdrawn },
  })
  refresh(slug)
  return ok(
    archived
      ? withdrawn
        ? { key: 'campaigns.results.archivedWithdrawn', params: { count: withdrawn } }
        : 'campaigns.results.archived'
      : 'campaigns.results.restored',
  )
}
