import { enumLabel } from '@spa/core/i18n'
import { withTenant } from '@spa/db'
import { getPost } from '@spa/services'
import { ArrowLeft } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { Pill } from '@/components/crm'
import { PageBody, PageHeader } from '@/components/ui/page'
import { getI18n, getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { can, isStudio, requireMember } from '@/server/access'
import { sitePageUrl } from '@/server/seo'
import { publicSiteUrl } from '@/server/sites'
import { PostForm } from '../post-form'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('website.blog.editTitle') }
}

/** F15: write / edit one blog post (Website Studio, super-admins only). `new` = a new post. */
export default async function BlogPostEditorPage({
  params,
}: {
  params: Promise<{ tenant: string; postId: string }>
}) {
  const { tenant, postId } = await params
  const ctx = await requireMember(tenant)
  if (!can(ctx, 'site.content') || !(await isStudio(ctx))) notFound()
  const isNew = postId === 'new'
  if (!isNew && !z.uuid().safeParse(postId).success) notFound()
  const post = isNew ? null : await withTenant(ctx.tenant.id, (tx) => getPost(tx, postId))
  if (!isNew && !post) notFound()
  const { t, fmt } = await getI18n()
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
            href={appPath(`/${slug}/website`)}
            className="inline-flex items-center gap-1 normal-case tracking-normal hover:text-fg"
          >
            <ArrowLeft className="size-3.5 rtl:rotate-180" /> {t('website.blog.back')}
          </Link>
        }
        title={post ? post.title.en : t('website.blog.newTitle')}
        description={
          post?.publishedAt ? t('website.blog.publishedOn', { date: fmt.date(post.publishedAt) }) : undefined
        }
        actions={
          post && (
            <Pill tone={post.status === 'published' ? 'ok' : 'warn'} dot={post.status === 'published'}>
              {enumLabel(t, 'sitePostStatus', post.status)}
            </Pill>
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
