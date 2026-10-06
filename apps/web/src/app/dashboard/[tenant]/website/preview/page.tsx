import '@/components/site/site.css'
import { type Data, Render } from '@puckeditor/core'
import { withTenant } from '@spa/db'
import { getDraftBySlug, globalSectionsFor, PAGE_SLUG } from '@spa/services'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { siteConfig } from '@/components/site/config'
import { buildMeta, loadSite, localeOf } from '@/components/site/data'
import { isTemplateKey, TEMPLATES } from '@/components/site/templates'
import { PATH_ROUTING } from '@/lib/paths'
import { can, requireMember } from '@/server/access'

export const metadata: Metadata = { title: 'Preview', robots: { index: false } }

type Props = {
  params: Promise<{ tenant: string }>
  searchParams: Promise<{ template?: string; page?: string; lang?: string }>
}

/**
 * Draft preview (and template "try on"): the current draft — or the template's starter page before a site
 * exists — rendered with the chosen template's theme and the spa's live data. Links are inert.
 */
export default async function SitePreviewPage({ params, searchParams }: Props) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'site.content') && !can(ctx, 'site.design') && !can(ctx, 'site.publish')) notFound()
  const { template: templateKey, page = '', lang } = await searchParams
  if (!PAGE_SLUG.test(page)) notFound()
  const template = templateKey && isTemplateKey(templateKey) ? TEMPLATES[templateKey] : null
  const { site, data } = await loadSite(ctx.tenant, { published: false })
  const draft = site
    ? await withTenant(ctx.tenant.id, async (tx) => {
        const d = await getDraftBySlug(tx, ctx.tenant.id, page)
        return d ? { ...d, globals: await globalSectionsFor(tx, ctx.tenant.id, d.data) } : null
      })
    : null
  const starter = (template ?? TEMPLATES.zen).pages.find((p) => p.slug === page)
  const pageData = draft?.data ?? starter?.data
  if (!pageData) notFound()
  const meta = {
    ...buildMeta({
      data: site
        ? data
        : {
            ...data,
            pages: (template ?? TEMPLATES.zen).pages.map((p) => ({ slug: p.slug, title: p.title })),
          },
      theme: template?.theme ?? site?.theme ?? null,
      locale: localeOf(lang),
      base: PATH_ROUTING ? `/s/${ctx.tenant.slug}` : '',
      slug: page,
      editing: true,
    }),
    globals: draft?.globals ?? {},
  }
  // Covers the dashboard chrome: this route is shown full-screen and inside thumbnails.
  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-bg">
      <Render config={siteConfig} data={pageData as Partial<Data>} metadata={meta} />
    </div>
  )
}
