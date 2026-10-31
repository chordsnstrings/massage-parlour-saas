import { withTenant } from '@spa/db'
import { getPost } from '@spa/services'
import { ArrowLeft } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { Badge } from '@/components/ui/badge'
import { PageBody, PageHeader } from '@/components/ui/page'
import { studioPath } from '@/lib/paths'
import { formatDate } from '@/lib/utils'
import { can, isStudio, requireMember } from '@/server/access'
import { sitePageUrl } from '@/server/seo'
import { publicSiteUrl } from '@/server/sites'
import { PostForm } from '../post-form'

export const metadata: Metadata = { title: 'Edit blog post' }

/** F15: write / edit one blog post (Website Studio in the console, R23). `new` = a new post. */
export default async function BlogPostEditorPage({
  params,
}: {
  params: Promise<{ slug: string; postId: string }>
}) {
  const { slug: spa, postId } = await params
  const ctx = await requireMember(spa)
  if (!can(ctx, 'site.content') || !(await isStudio(ctx))) notFound()
  const isNew = postId === 'new'
  if (!isNew && !z.uuid().safeParse(postId).success) notFound()
  const post = isNew ? null : await withTenant(ctx.tenant.id, (tx) => getPost(tx, postId))
  if (!isNew && !post) notFound()
  const slug = ctx.tenant.slug
  const liveUrl =
    post?.status === 'published'
      ? sitePageUrl((await publicSiteUrl(ctx.tenant)).replace(/\/$/, ''), `blog/${post.slug}`)
      : null
  return (
    <>
      <PageHeader
        eyebrow={
          <Link
            href={studioPath(slug)}
            className="inline-flex items-center gap-1 normal-case tracking-normal hover:text-fg"
          >
            <ArrowLeft className="size-3.5" /> {ctx.tenant.name} website
          </Link>
        }
        title={post ? post.title.en : 'New blog post'}
        description={post?.publishedAt ? `Published ${formatDate(post.publishedAt)}` : undefined}
        actions={
          post && (
            <Badge tone={post.status === 'published' ? 'success' : 'warning'}>
              {post.status === 'published' ? 'Published' : 'Draft'}
            </Badge>
          )
        }
      />
      <PageBody>
        <PostForm
          slug={slug}
          canPublish={can(ctx, 'site.publish')}
          liveUrl={liveUrl}
          post={
            post && {
              id: post.id,
              slug: post.slug,
              status: post.status,
              title: post.title,
              excerpt: post.excerpt,
              body: post.body,
              coverImage: post.coverImage,
              seoTitle: post.seoTitle,
              seoDescription: post.seoDescription,
            }
          }
        />
      </PageBody>
    </>
  )
}
