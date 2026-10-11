import { notFound, redirect } from 'next/navigation'
import { z } from 'zod'
import { isStudio, requireMember } from '@/server/access'
import { studioUrl } from '@/server/studio'

/** R23: the page editor moved to the console — old links forward super-admins there; others get a 404. */
export default async function OldEditorPage({
  params,
}: {
  params: Promise<{ tenant: string; pageId: string }>
}) {
  const { tenant, pageId } = await params
  if (!z.string().uuid().safeParse(pageId).success) notFound()
  const ctx = await requireMember(tenant)
  if (!(await isStudio(ctx))) notFound()
  redirect(await studioUrl(ctx.tenant.slug, `/editor/${pageId}`))
}
