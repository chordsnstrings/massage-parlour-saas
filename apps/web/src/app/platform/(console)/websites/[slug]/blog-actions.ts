'use server'
// F15 blog (Website Studio, console — English): posts are written and published by the studio only (super-admins,
// `studioGuard`) — save = site.content, publish / unpublish / delete = site.publish. Every change is audited.
import { withTenant } from '@spa/db'
import { DomainError, deletePost, postInputSchema, savePost, setPostStatus } from '@spa/services'
import { z } from 'zod'
import { type ActionResult, fail, failDomain, fromZod, ok } from '@/lib/action'
import { type MemberContext, studioGuard } from '@/server/access'
import { audit } from '@/server/audit'
import { revalidateStudio } from '@/server/studio'

const auditAs = (ctx: MemberContext, action: string, entityId: string, data?: unknown) =>
  audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    impersonatorUserId: ctx.impersonating ? ctx.user.id : undefined,
    action,
    entity: 'site_post',
    entityId,
    data,
  })

const bi = (fd: FormData, name: string) => ({
  en: String(fd.get(`${name}.en`) ?? ''),
  ar: String(fd.get(`${name}.ar`) ?? ''),
})

/** Create (`postId` null) or update a post's content; never changes whether it is live. */
export async function savePostAction(
  slug: string,
  postId: string | null,
  fd: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await studioGuard(slug, 'site.content')
  if (error) return fail(error)
  const id = postId === null ? null : z.uuid().safeParse(postId)
  if (id && !id.success) return fail('errors.notFound')
  const parsed = postInputSchema.safeParse({
    slug: fd.get('slug') ?? '',
    title: bi(fd, 'title'),
    excerpt: bi(fd, 'excerpt'),
    body: bi(fd, 'body'),
    coverImage: fd.get('coverImage') ?? '',
    seoTitle: bi(fd, 'seoTitle'),
    seoDescription: bi(fd, 'seoDescription'),
  })
  if (!parsed.success) return fromZod(parsed.error, { english: true })
  try {
    const post = await withTenant(ctx.tenant.id, (tx) =>
      savePost(tx, ctx.tenant.id, id ? id.data : null, parsed.data, ctx.user.id),
    )
    await auditAs(ctx, id ? 'site.post.updated' : 'site.post.created', post.id, { slug: post.slug })
    revalidateStudio(slug)
    return ok('Post saved', { id: post.id })
  } catch (e) {
    if (e instanceof DomainError)
      return failDomain(
        e,
        e.i18n?.key === 'website.blog.slugTaken'
          ? { slug: 'Another post already uses that address' }
          : undefined,
      )
    throw e
  }
}

export async function setPostStatusAction(
  slug: string,
  postId: string,
  status: 'draft' | 'published',
): Promise<ActionResult> {
  const { ctx, error } = await studioGuard(slug, 'site.publish')
  if (error) return fail(error)
  const parsed = z
    .object({ id: z.uuid(), status: z.enum(['draft', 'published']) })
    .safeParse({ id: postId, status })
  if (!parsed.success) return fromZod(parsed.error, { english: true })
  try {
    const post = await withTenant(ctx.tenant.id, (tx) =>
      setPostStatus(tx, parsed.data.id, parsed.data.status, ctx.user.id),
    )
    await auditAs(ctx, status === 'published' ? 'site.post.published' : 'site.post.unpublished', post.id, {
      slug: post.slug,
    })
    revalidateStudio(slug)
    return ok(status === 'published' ? 'Post published' : 'Post moved back to draft')
  } catch (e) {
    if (e instanceof DomainError) return failDomain(e)
    throw e
  }
}

export async function deletePostAction(slug: string, postId: string): Promise<ActionResult> {
  const { ctx, error } = await studioGuard(slug, 'site.publish')
  if (error) return fail(error)
  const id = z.uuid().safeParse(postId)
  if (!id.success) return fromZod(id.error)
  try {
    const row = await withTenant(ctx.tenant.id, (tx) => deletePost(tx, id.data))
    await auditAs(ctx, 'site.post.deleted', id.data, { slug: row.slug })
    revalidateStudio(slug)
    return ok('Post deleted')
  } catch (e) {
    if (e instanceof DomainError) return failDomain(e)
    throw e
  }
}
