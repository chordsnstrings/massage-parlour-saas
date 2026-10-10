// F15 blog (PLAN §11.4 "Blog list/post"): posts the studio (super-admins) writes in Website Studio. Published posts
// show in the BlogList block, at `{site}/blog/{slug}` and in the site's sitemap. Callers run these inside
// withTenant(); permission (studioGuard) + audit stay in the caller.
import { sitePosts, type Tx } from '@spa/db'
import { and, desc, eq, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import { DomainError, pgConstraint } from './errors'

export type SitePost = typeof sitePosts.$inferSelect
type Bi = { en: string; ar?: string }

export const POST_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const POST_TITLE_MAX = 140
export const POST_EXCERPT_MAX = 300
export const POST_BODY_MAX = 20_000
export const POST_SEO_TITLE_MAX = 70
export const POST_SEO_DESCRIPTION_MAX = 170
/** Cover: a library file ('/files/{id}', optional ?query) or an https URL. */
const COVER = /^(?:\/files\/[0-9a-f-]{36}(?:\?[\w=&.-]*)?|https:\/\/[^\s"'<>`\\]{1,1000})$/i

const BIDI = /[\u202A-\u202E\u2066-\u2069]/gu
const oneLine = (v: string) =>
  v
    .replace(BIDI, '')
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
const multiLine = (v: string) =>
  v
    .replace(BIDI, '')
    .replace(/\r\n?|[\u2028\u2029]/g, '\n')
    .replace(/(?![\n\t])\p{Cc}/gu, '')
    .trim()

const bi = (max: number, clean: (v: string) => string, required = false) =>
  z
    .object({
      en: z
        .string()
        .max(max * 2)
        .default(''),
      ar: z
        .string()
        .max(max * 2)
        .optional(),
    })
    .transform((v) => {
      const out: Bi = { en: clean(v.en) }
      const ar = v.ar === undefined ? '' : clean(v.ar)
      if (ar) out.ar = ar
      return out
    })
    .refine((v) => v.en.length <= max && (v.ar ?? '').length <= max, 'website.blog.tooLong')
    .refine((v) => !required || v.en.length > 0, 'validation.required')

/** What the Studio post form sends (messages are i18n keys: validation.* / website.blog.*). */
export const postInputSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .max(80, 'website.blog.tooLong')
    .regex(POST_SLUG, 'website.blog.slugInvalid'),
  title: bi(POST_TITLE_MAX, oneLine, true),
  excerpt: bi(POST_EXCERPT_MAX, oneLine),
  body: bi(POST_BODY_MAX, multiLine),
  coverImage: z
    .string()
    .trim()
    .max(1100)
    .nullish()
    .transform((v) => v || null)
    .refine((v) => v === null || COVER.test(v), 'website.blog.coverInvalid'),
  seoTitle: bi(POST_SEO_TITLE_MAX, oneLine),
  seoDescription: bi(POST_SEO_DESCRIPTION_MAX, oneLine),
})
export type PostInput = z.output<typeof postInputSchema>

const slugTaken = () =>
  new DomainError('Another post already uses that address', 'invalid', { key: 'website.blog.slugTaken' })

/** Every post, newest first (Studio list). */
export function listPosts(tx: Tx) {
  return tx
    .select({
      id: sitePosts.id,
      slug: sitePosts.slug,
      status: sitePosts.status,
      title: sitePosts.title,
      publishedAt: sitePosts.publishedAt,
      updatedAt: sitePosts.updatedAt,
    })
    .from(sitePosts)
    .orderBy(desc(sql`coalesce(${sitePosts.publishedAt}, ${sitePosts.createdAt})`))
}

export async function getPost(tx: Tx, id: string): Promise<SitePost | null> {
  const [row] = await tx.select().from(sitePosts).where(eq(sitePosts.id, id)).limit(1)
  return row ?? null
}

/** A live post by its address (public post page). */
export async function getPublishedPost(tx: Tx, slug: string): Promise<SitePost | null> {
  if (!POST_SLUG.test(slug)) return null
  const [row] = await tx
    .select()
    .from(sitePosts)
    .where(and(eq(sitePosts.slug, slug), eq(sitePosts.status, 'published')))
    .limit(1)
  return row ?? null
}

/** Live posts without their bodies, newest first (BlogList block, sitemap). */
export function listPublishedPosts(tx: Tx, limit = 24) {
  return tx
    .select({
      slug: sitePosts.slug,
      title: sitePosts.title,
      excerpt: sitePosts.excerpt,
      coverImage: sitePosts.coverImage,
      publishedAt: sitePosts.publishedAt,
      updatedAt: sitePosts.updatedAt,
    })
    .from(sitePosts)
    .where(eq(sitePosts.status, 'published'))
    .orderBy(desc(sitePosts.publishedAt))
    .limit(limit)
}

/** Creates (`id` null) or updates a post; the status is changed only by `setPostStatus`. */
export async function savePost(
  tx: Tx,
  tenantId: string,
  id: string | null,
  input: PostInput,
  userId: string | null,
): Promise<SitePost> {
  const [clash] = await tx
    .select({ id: sitePosts.id })
    .from(sitePosts)
    .where(and(eq(sitePosts.slug, input.slug), id ? ne(sitePosts.id, id) : undefined))
    .limit(1)
  if (clash) throw slugTaken()
  try {
    if (!id) {
      const [row] = await tx
        .insert(sitePosts)
        .values({ tenantId, ...input, createdBy: userId, updatedBy: userId })
        .returning()
      return row!
    }
    const [row] = await tx
      .update(sitePosts)
      .set({ ...input, updatedBy: userId, updatedAt: new Date() })
      .where(eq(sitePosts.id, id))
      .returning()
    if (!row) throw new DomainError('Post not found', 'not_found', { key: 'errors.notFound' })
    return row
  } catch (e) {
    if (pgConstraint(e) === 'site_posts_slug') throw slugTaken()
    throw e
  }
}

/** Publish (first publish sets the post's date) or take back to draft. */
export async function setPostStatus(
  tx: Tx,
  id: string,
  status: 'draft' | 'published',
  userId: string | null,
) {
  const [row] = await tx
    .update(sitePosts)
    .set({
      status,
      updatedBy: userId,
      updatedAt: new Date(),
      ...(status === 'published' ? { publishedAt: sql`coalesce(${sitePosts.publishedAt}, now())` } : {}),
    })
    .where(eq(sitePosts.id, id))
    .returning()
  if (!row) throw new DomainError('Post not found', 'not_found', { key: 'errors.notFound' })
  return row
}

export async function deletePost(tx: Tx, id: string) {
  const [row] = await tx.delete(sitePosts).where(eq(sitePosts.id, id)).returning({ slug: sitePosts.slug })
  if (!row) throw new DomainError('Post not found', 'not_found', { key: 'errors.notFound' })
  return row
}

/**
 * Post body → blocks for rendering: blank line = new paragraph, a line starting with `## ` = sub-heading, lines
 * starting with `- ` = a bullet list. Plain text only (rendered as React text, never HTML).
 */
export type PostBlock =
  | { kind: 'h2'; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'ul'; items: string[] }
export function postBlocks(body: string): PostBlock[] {
  const out: PostBlock[] = []
  for (const chunk of body.split(/\n\s*\n/)) {
    const lines = chunk.split('\n').map((l) => l.trimEnd())
    let para: string[] = []
    let list: string[] = []
    const flush = () => {
      if (para.length) out.push({ kind: 'p', text: para.join('\n').trim() })
      if (list.length) out.push({ kind: 'ul', items: list })
      para = []
      list = []
    }
    for (const line of lines) {
      const t = line.trim()
      if (!t) continue
      if (t.startsWith('## ')) {
        flush()
        out.push({ kind: 'h2', text: t.slice(3).trim() })
      } else if (/^[-•]\s+/.test(t)) {
        if (para.length) {
          out.push({ kind: 'p', text: para.join('\n').trim() })
          para = []
        }
        list.push(t.replace(/^[-•]\s+/, ''))
      } else {
        if (list.length) {
          out.push({ kind: 'ul', items: list })
          list = []
        }
        para.push(t)
      }
    }
    flush()
  }
  return out.filter((b) => (b.kind === 'ul' ? b.items.length > 0 : b.text.length > 0))
}
