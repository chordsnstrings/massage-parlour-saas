import { notFound, redirect } from 'next/navigation'
import { z } from 'zod'
import { isStudio, requireMember } from '@/server/access'
import { studioUrl } from '@/server/studio'

/** R23: blog posts are written in the console — old links forward super-admins there; others get a 404. */
export default async function OldBlogPostPage({
  params,
}: {
  params: Promise<{ tenant: string; postId: string }>
}) {
  const { tenant, postId } = await params
  if (postId !== 'new' && !z.uuid().safeParse(postId).success) notFound()
  const ctx = await requireMember(tenant)
  if (!(await isStudio(ctx))) notFound()
  redirect(await studioUrl(ctx.tenant.slug, `/blog/${postId}`))
}
