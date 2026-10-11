import { platformDb, siteAiEditorStatus, withTenant } from '@spa/db'
import { editStamp, getEditablePage, getPageLock, listPages, listSavedSections } from '@spa/services'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { buildMeta, loadSite } from '@/components/site/data'
import type { SavedSection } from '@/components/site/editor/context'
import { PATH_ROUTING, studioPath } from '@/lib/paths'
import { can, isStudio, requireMember } from '@/server/access'
import { aiFixturesOn } from '@/server/ai-fixture'
import { publicSiteUrl } from '@/server/sites'
import { SiteEditor } from './editor'

export const metadata: Metadata = { title: 'Edit page' }

/** R23: a page of the spa's site in the Puck editor, full screen (no console shell); back = its console page. */
export default async function EditorPage({ params }: { params: Promise<{ slug: string; pageId: string }> }) {
  const { slug: spa, pageId } = await params
  const ctx = await requireMember(spa)
  if (!can(ctx, 'site.content') || !(await isStudio(ctx))) notFound()
  if (!z.string().uuid().safeParse(pageId).success) notFound()
  const loaded = await withTenant(ctx.tenant.id, async (tx) => {
    const editable = await getEditablePage(tx, ctx.tenant.id, pageId)
    if (!editable) return null
    const [pages, sections] = await Promise.all([
      listPages(tx, ctx.tenant.id),
      listSavedSections(tx, ctx.tenant.id),
    ])
    // F29: read only — the editor takes the lock itself once it is open (a prefetch must not lock the page).
    const lock = await getPageLock(tx, ctx.tenant.id, pageId)
    return {
      editable,
      pages,
      sections,
      stamp: await editStamp(tx, ctx.tenant.id, pageId),
      lockHolder:
        lock && lock.userId !== ctx.user.id
          ? {
              name: lock.holderName,
              since: lock.acquiredAt.toISOString(),
              until: lock.expiresAt.toISOString(),
            }
          : null,
    }
  })
  if (!loaded?.stamp) notFound()
  const { site, data } = await loadSite(ctx.tenant, { published: false })
  if (!site) notFound()
  const slug = ctx.tenant.slug
  const { page, version } = loaded.editable
  const meta = buildMeta({
    data,
    theme: site.theme,
    locale: 'en',
    base: PATH_ROUTING ? `/s/${slug}` : '',
    slug: page.slug,
    editing: true,
  })
  const sections: SavedSection[] = loaded.sections.map((s) => ({
    id: s.id,
    name: s.name,
    isGlobal: s.isGlobal,
    data: s.data as SavedSection['data'],
    updatedAt: s.updatedAt.toISOString(),
  }))
  return (
    <SiteEditor
      slug={slug}
      pageId={page.id}
      pageSlug={page.slug}
      pageTitle={page.title.en}
      data={loaded.editable.data}
      meta={meta}
      status={version?.status ?? 'draft'}
      savedAt={version?.createdAt.toISOString() ?? null}
      stamp={loaded.stamp}
      canDesign={can(ctx, 'site.design')}
      canPublish={can(ctx, 'site.publish')}
      canInsights={can(ctx, 'reports.view')}
      aiReady={Boolean(process.env.ARK_API_KEY)}
      aiEditReady={Boolean(process.env.ARK_API_KEY) || aiFixturesOn()}
      aiEditAllowed={(await siteAiEditorStatus(platformDb(), ctx.user.id)) === 'ok'}
      sections={sections}
      pages={loaded.pages.map((p) => ({
        slug: p.slug,
        visible: p.visible,
        published: Boolean(p.publishedAt),
      }))}
      lockHolder={loaded.lockHolder}
      backHref={studioPath(slug)}
      backLabel="Back to console"
      previewHref={studioPath(slug, `/preview?page=${page.slug}`)}
      liveHref={`${await publicSiteUrl(ctx.tenant)}${page.slug ? `/${page.slug}` : ''}`}
    />
  )
}
