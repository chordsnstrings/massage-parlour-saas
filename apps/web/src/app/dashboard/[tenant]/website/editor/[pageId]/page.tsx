import { withTenant } from '@spa/db'
import { getEditablePage } from '@spa/services'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { buildMeta, loadSite } from '@/components/site/data'
import { appPath, PATH_ROUTING, tenantSiteUrl } from '@/lib/paths'
import { can, requireMember } from '@/server/access'
import { SiteEditor } from './editor'

export const metadata: Metadata = { title: 'Edit page' }

export default async function EditorPage({
  params,
}: {
  params: Promise<{ tenant: string; pageId: string }>
}) {
  const { tenant, pageId } = await params
  const ctx = await requireMember(tenant)
  if (!can(ctx, 'site.content')) notFound()
  if (!z.string().uuid().safeParse(pageId).success) notFound()
  const editable = await withTenant(ctx.tenant.id, (tx) => getEditablePage(tx, ctx.tenant.id, pageId))
  if (!editable) notFound()
  const { site, data } = await loadSite(ctx.tenant, { published: false })
  if (!site) notFound()
  const slug = ctx.tenant.slug
  const { page, version } = editable
  const meta = buildMeta({
    data,
    theme: site.theme,
    locale: 'en',
    base: PATH_ROUTING ? `/s/${slug}` : '',
    slug: page.slug,
    editing: true,
  })
  return (
    <SiteEditor
      slug={slug}
      pageId={page.id}
      pageTitle={page.title.en}
      data={editable.data}
      meta={meta}
      status={version?.status ?? 'draft'}
      savedAt={version?.createdAt.toISOString() ?? null}
      canDesign={can(ctx, 'site.design')}
      canPublish={can(ctx, 'site.publish')}
      backHref={appPath(`/${slug}/website`)}
      previewHref={appPath(`/${slug}/website/preview?page=${page.slug}`)}
      liveHref={`${tenantSiteUrl(slug)}${page.slug ? `/${page.slug}` : ''}`}
    />
  )
}
