'use server'
import { withTenant } from '@spa/db'
import { DomainError, setSiteProfiles } from '@spa/services'
import { z } from 'zod'
import { type ActionResult, fail, failDomain, fromZod, ok } from '@/lib/action'
import { studioGuard } from '@/server/access'
import { audit } from '@/server/audit'
import { revalidateStudio } from '@/server/studio'

/*
 * R33 Profile links (console spa website page): the spa's official profiles in its JSON-LD sameAs (Google Business
 * Profile share link, Instagram, Facebook …). Live at once on every page, so it needs site.publish.
 */
const schema = z.object({ links: z.string().max(10_000, 'Too much text — up to 10 links, one per line') })

export async function saveProfileLinksAction(
  slug: string,
  _prev: ActionResult,
  fd: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await studioGuard(slug, 'site.publish')
  if (error) return fail(error)
  const parsed = schema.safeParse({ links: fd.get('links') ?? '' })
  if (!parsed.success) return fromZod(parsed.error, { english: true })
  const tenantId = ctx.tenant.id
  try {
    const site = await withTenant(tenantId, (tx) =>
      setSiteProfiles(tx, tenantId, parsed.data.links.split(/\r?\n/)),
    )
    const links = site.seo.profiles ?? []
    await audit({
      tenantId,
      actorUserId: ctx.user.id,
      impersonatorUserId: ctx.impersonating ? ctx.user.id : undefined,
      action: 'site.profiles_updated',
      entity: 'site',
      entityId: site.id,
      data: { count: links.length, links },
    })
    revalidateStudio(slug)
    return ok('Profile links saved')
  } catch (e) {
    if (e instanceof DomainError) return failDomain(e, { links: e.message })
    throw e
  }
}
