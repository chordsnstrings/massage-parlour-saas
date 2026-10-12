'use server'
import { withTenant } from '@spa/db'
import {
  applyDesignSeed,
  type DesignSeedPlan,
  type DesignSeedSummary,
  DomainError,
  designSeedSource,
  isDesignSeedImage,
  planDesignSeed,
} from '@spa/services'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { type ActionResult, fail, failDomain, fromZod, ok } from '@/lib/action'
import { can, type MemberContext, studioGuard } from '@/server/access'
import { audit } from '@/server/audit'
import { revalidateStudio } from '@/server/studio'

/*
 * R28 P3 "Fill the CRM from the design" (docs/design/r28-dynamic-html-designs.md §4): for a page whose draft is an
 * HTML design with window.CRM_DATA, a preview of how its treatments pair with the CRM (planDesignSeed, read only),
 * then the super-admin's choices applied (applyDesignSeed). These are CRM changes that go live at once (treatments,
 * therapists, media library); prices are never changed and the design file never changes.
 */

const uuid = z.string().uuid()

/** Website design + the CRM's treatments and team: the seed writes all three. */
async function seedGuard(slug: string) {
  const { ctx, error } = await studioGuard(slug, 'site.design')
  if (error) return { ctx, error }
  if (!can(ctx, 'services.manage') || !can(ctx, 'staff.manage'))
    return { ctx, error: 'Filling the CRM needs the treatments and team permissions' }
  return { ctx, error: null }
}

export type DesignSeedPreview = {
  page: { id: string; title: string }
  plan: DesignSeedPlan
  /** The design's own pictures (its `data:` URIs) by design id, shown small in the sheet. */
  pictures: { services: Record<string, string>; staff: Record<string, string> }
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const item = (data: Record<string, unknown>, key: 'services' | 'staff', index: number) => {
  const list = data[key]
  const x = Array.isArray(list) ? list[index] : null
  return isObj(x) ? x : {}
}

/** The preview: pairings with scores, the design's pictures, the team photos and the CRM's therapists. */
export async function designSeedPlanAction(slug: string, pageId: string): Promise<ActionResult> {
  const { ctx, error } = await seedGuard(slug)
  if (error) return fail(error)
  if (!uuid.safeParse(pageId).success) return fail('Page not found')
  const preview = await withTenant(ctx.tenant.id, async (tx): Promise<DesignSeedPreview | null> => {
    const src = await designSeedSource(tx, ctx.tenant.id, pageId)
    if (!src) return null
    const plan = await planDesignSeed(tx, ctx.tenant.id, src.data)
    const pictures: DesignSeedPreview['pictures'] = { services: {}, staff: {} }
    for (const s of plan.services) {
      const image = item(src.data, 'services', s.index).image
      if (s.hasImage && isDesignSeedImage(image)) pictures.services[s.designId] = image as string
    }
    for (const s of plan.staffPhotos) {
      const photo = item(src.data, 'staff', s.index).photo
      if (isDesignSeedImage(photo)) pictures.staff[s.designId] = photo as string
    }
    return { page: { id: src.page.id, title: src.page.title.en }, plan, pictures }
  })
  if (!preview) return fail('This page’s design has no CRM data (window.CRM_DATA) to fill the CRM from')
  return ok(undefined, preview as unknown as Record<string, unknown>)
}

const designId = z.string().trim().min(1).max(200)
const seedSchema = z.object({
  page: uuid,
  /** "Replace existing photos": also over photos (and descriptions) the CRM already has. */
  replace: z.boolean().default(false),
  services: z
    .array(
      z.object({
        designId,
        action: z.enum(['fill', 'create', 'skip']),
        serviceId: uuid.optional(),
      }),
    )
    .max(500),
  staff: z.array(z.object({ designId, staffId: uuid, showOnSite: z.boolean().optional() })).max(200),
})
export type SeedCrmInput = z.input<typeof seedSchema>

const plural = (n: number, one: string, many: string) => (n ? `${n} ${n === 1 ? one : many}` : null)

/** The toast after a seed: what changed in the CRM. */
function summaryText(s: DesignSeedSummary) {
  const parts = [
    plural(s.servicesFilled, 'treatment filled', 'treatments filled'),
    plural(s.servicesCreated, 'treatment created', 'treatments created'),
    plural(s.photosSet, 'therapist photo set', 'therapist photos set'),
    plural(s.assets, 'new picture in the media library', 'new pictures in the media library'),
  ].filter(Boolean)
  const failed = s.picturesFailed
    ? ` · ${s.picturesFailed} ${s.picturesFailed === 1 ? 'picture' : 'pictures'} couldn’t be read`
    : ''
  return `${parts.length ? `CRM updated: ${parts.join(', ')}` : 'Nothing to change: the CRM already has these'}${failed}`
}

const auditAs = (ctx: MemberContext, pageId: string, data: unknown) =>
  audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    impersonatorUserId: ctx.impersonating ? ctx.user.id : undefined,
    action: 'site.design_seed',
    entity: 'site_page',
    entityId: pageId,
    data,
  })

/** Applies the super-admin's choices to the CRM (live at once); the website shows them on its next load. */
export async function seedCrmFromDesignAction(slug: string, input: SeedCrmInput): Promise<ActionResult> {
  const { ctx, error } = await seedGuard(slug)
  if (error) return fail(error)
  const parsed = seedSchema.safeParse(input)
  if (!parsed.success) return fromZod(parsed.error, { english: true })
  const { page, replace, services, staff } = parsed.data
  let summary: DesignSeedSummary | null
  try {
    summary = await withTenant(ctx.tenant.id, async (tx) => {
      const src = await designSeedSource(tx, ctx.tenant.id, page)
      if (!src) return null
      return applyDesignSeed(
        tx,
        ctx.tenant.id,
        src.data,
        { services: services.map((s) => ({ ...s, replace })), staff, library: true },
        { userId: ctx.user.id },
      )
    })
  } catch (e) {
    if (e instanceof DomainError) return failDomain(e)
    throw e
  }
  if (!summary) return fail('This page’s design has no CRM data (window.CRM_DATA) to fill the CRM from')
  await auditAs(ctx, page, {
    ...summary,
    replace,
    fill: services.filter((s) => s.action === 'fill').length,
    create: services.filter((s) => s.action === 'create').length,
    staff: staff.length,
  })
  // The CRM's treatments and team pages, the spa's Website page, the console page; the design pages' CRM data is
  // read live, so the website shows the change on its next load (no publish).
  revalidateStudio(slug)
  revalidatePath(`/dashboard/${slug}/services`)
  revalidatePath(`/dashboard/${slug}/staff`, 'layout')
  return ok(summaryText(summary), { summary })
}
