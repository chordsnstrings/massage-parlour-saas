'use server'
import { mediaAssets, withTenant } from '@spa/db'
import {
  assetUsage,
  DomainError,
  deleteAsset,
  fileIdFromUrl,
  listAssets,
  persistRemoteAsset,
  postImageUrl,
  repointPostImages,
  saveRemoteImage,
  setTags,
  updateAlt,
} from '@spa/services'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { toMediaItem } from '@/components/media/types'
import { type ActionResult, fail, formObject, fromZod, ok } from '@/lib/action'
import { guard } from '@/server/access'
import { audit } from '@/server/audit'
import { tenantSiteUrl } from '@/server/origin'

const uuid = z.string().uuid()
const revalidate = (slug: string) => revalidatePath(`/dashboard/${slug}/media`)

const Filter = z.object({
  q: z.string().trim().max(80).optional(),
  source: z.enum(['upload', 'ai']).optional(),
  tag: z.string().trim().max(32).optional(),
  offset: z.number().int().min(0).max(5000).optional(),
})

/**
 * Library page for the image picker (website editor, service / therapist photos). AI images still on their
 * temporary 7-day link are left out — picking one would embed a URL that soon breaks.
 */
export async function listMediaAction(slug: string, filter: z.input<typeof Filter> = {}) {
  const { ctx, error } = await guard(slug, 'site.content')
  if (error) return { ok: false as const, error }
  const f = Filter.safeParse(filter)
  if (!f.success) return { ok: false as const, error: 'Invalid filter' }
  const rows = await withTenant(ctx.tenant.id, (tx) =>
    listAssets(tx, { ...f.data, storedOnly: true, limit: 49 }),
  )
  return { ok: true as const, items: rows.slice(0, 48).map(toMediaItem), more: rows.length > 48 }
}

const AltSchema = z.object({
  altEn: z.string().trim().max(300).optional(),
  altAr: z.string().trim().max(300).optional(),
  tags: z.string().trim().max(300).optional(),
})

export async function saveAssetAction(
  slug: string,
  id: string,
  _p: ActionResult,
  fd: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'site.content')
  if (error) return fail(error)
  if (!uuid.safeParse(id).success) return fail('Image not found')
  const parsed = AltSchema.safeParse(formObject(fd))
  if (!parsed.success) return fromZod(parsed.error)
  const d = parsed.data
  try {
    await withTenant(ctx.tenant.id, async (tx) => {
      await updateAlt(tx, id, { en: d.altEn, ar: d.altAr })
      await setTags(tx, id, (d.tags ?? '').split(','))
    })
  } catch (e) {
    if (e instanceof DomainError) return fail(e.message)
    throw e
  }
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: 'media.updated',
    entity: 'media_asset',
    entityId: id,
    data: { alt: { en: d.altEn, ar: d.altAr }, tags: d.tags },
  })
  revalidate(slug)
  return ok('Image details saved')
}

/** Where this image is used — pages, service and therapist photos, unpublished posts (for the delete warning). */
export async function assetUsageAction(slug: string, id: string) {
  const { ctx, error } = await guard(slug, 'site.content')
  if (error) return { ok: false as const, error }
  if (!uuid.safeParse(id).success) return { ok: false as const, error: 'Image not found' }
  const used = await withTenant(ctx.tenant.id, async (tx) => {
    const [row] = await tx.select({ url: mediaAssets.url }).from(mediaAssets).where(eq(mediaAssets.id, id))
    return row ? assetUsage(tx, row.url) : null
  })
  return {
    ok: true as const,
    usage: {
      pages: (used?.pages ?? []).map((p) => p.title.en || 'Home'),
      services: (used?.services ?? []).map((s) => s.name.en || s.name.ar || 'Service'),
      staff: (used?.staff ?? []).map((s) => s.name),
      posts: used?.posts.length ?? 0,
      sections: (used?.sections ?? []).map((s) => s.name),
    },
  }
}

export async function deleteAssetAction(slug: string, id: string): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'site.content')
  if (error) return fail(error)
  if (!uuid.safeParse(id).success) return fail('Image not found')
  const removed = await withTenant(ctx.tenant.id, (tx) => deleteAsset(tx, id))
  if (!removed) return fail('Image not found')
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: 'media.deleted',
    entity: 'media_asset',
    entityId: id,
    data: { url: removed.url, source: removed.source },
  })
  revalidate(slug)
  return ok('Image deleted')
}

/**
 * Saves an AI image that still points at its temporary (7-day) link into the library, and moves the social
 * posts that use that link onto the stored copy (so approval doesn't download it again, and it outlives the link).
 */
export async function persistAssetAction(slug: string, id: string): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'site.content')
  if (error) return fail(error)
  if (!uuid.safeParse(id).success) return fail('Image not found')
  const [row] = await withTenant(ctx.tenant.id, (tx) =>
    tx.select().from(mediaAssets).where(eq(mediaAssets.id, id)),
  )
  if (!row) return fail('Image not found')
  if (fileIdFromUrl(row.url)) return ok('Already saved')
  try {
    const image = await saveRemoteImage(row.url)
    const origin = new URL(await tenantSiteUrl(slug)).origin
    await withTenant(ctx.tenant.id, async (tx) => {
      const asset = await persistRemoteAsset(tx, {
        tenantId: ctx.tenant.id,
        remoteUrl: row.url,
        image,
        createdBy: ctx.user.id,
      })
      await repointPostImages(tx, row.url, postImageUrl(asset.url, origin))
    })
  } catch (e) {
    if (e instanceof DomainError) return fail(`Couldn’t save it: ${e.message}`)
    console.error('persist media failed', e)
    return fail('Couldn’t save the image — please try again.')
  }
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: 'media.persisted',
    entity: 'media_asset',
    entityId: id,
  })
  revalidate(slug)
  revalidatePath(`/dashboard/${slug}/ai/content`)
  return ok('Saved to your library')
}
