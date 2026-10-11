import '@/components/site/site.css'
import { type Data, Render } from '@puckeditor/core'
import { withTenant } from '@spa/db'
import { getDraftBySlug, getPublishedPage, globalSectionsFor, PAGE_SLUG } from '@spa/services'
import { notFound } from 'next/navigation'
import { siteConfig } from '@/components/site/config'
import { buildMeta, loadSite, localeOf, type TenantLite } from '@/components/site/data'
import { TEMPLATES } from '@/components/site/templates'
import { PATH_ROUTING } from '@/lib/paths'
import { resolveTemplate } from '@/server/site-templates'

export type DraftPreviewQuery = {
  template?: string
  page?: string
  lang?: string
  starter?: string
  /** `1` = the published page (the spa's own Website page once live); falls back to the draft when never published. */
  live?: string
}

/**
 * Draft preview (and template "try on"): the current draft — or the template's starter page before a site
 * exists, or with `starter=1` — rendered with the chosen template's theme and the spa's live data. Links are inert.
 * Shared by the console Website Studio (R23) and the spa's own Website page; the routes do the access checks.
 */
export async function DraftPreview({ tenant, query }: { tenant: TenantLite; query: DraftPreviewQuery }) {
  const { template: templateKey, page = '', lang, starter } = query
  if (!PAGE_SLUG.test(page)) notFound()
  if (query.live === '1') {
    const live = await renderLive(tenant, page, lang)
    if (live) return live
  }
  const template = await resolveTemplate(templateKey)
  const { site, data } = await loadSite(tenant, { published: false })
  const useStarter = !site || (starter === '1' && template)
  const draft = useStarter
    ? null
    : await withTenant(tenant.id, async (tx) => {
        const d = await getDraftBySlug(tx, tenant.id, page)
        return d ? { ...d, globals: await globalSectionsFor(tx, tenant.id, d.data) } : null
      })
  const source = template ?? TEMPLATES.zen
  const starterPage = source.pages.find((p) => p.slug === page)
  const pageData = draft?.data ?? starterPage?.data
  if (!pageData) notFound()
  const meta = {
    ...buildMeta({
      data: useStarter
        ? { ...data, pages: source.pages.map((p) => ({ slug: p.slug, title: p.title })) }
        : data,
      theme: template?.theme ?? site?.theme ?? null,
      locale: localeOf(lang),
      base: PATH_ROUTING ? `/s/${tenant.slug}` : '',
      slug: page,
      editing: true,
    }),
    globals: draft?.globals ?? {},
  }
  // Covers any surrounding chrome: this route is shown full-screen and inside thumbnails.
  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-bg" data-crm-off>
      <Render config={siteConfig} data={pageData as Partial<Data>} metadata={meta} />
    </div>
  )
}

/** The published page as visitors see it (theme, pages and globals of the live site), or null if never published. */
async function renderLive(tenant: TenantLite, page: string, lang?: string) {
  const { site, data } = await loadSite(tenant, { published: true })
  const published = await withTenant(tenant.id, async (tx) => {
    const p = await getPublishedPage(tx, tenant.id, page)
    return p ? { ...p, globals: await globalSectionsFor(tx, tenant.id, p.data) } : null
  })
  if (!published) return null
  const meta = {
    ...buildMeta({
      data,
      theme: site?.theme ?? null,
      locale: localeOf(lang),
      base: PATH_ROUTING ? `/s/${tenant.slug}` : '',
      slug: page,
      editing: true,
    }),
    globals: published.globals,
  }
  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-bg" data-crm-off>
      <Render config={siteConfig} data={published.data as Partial<Data>} metadata={meta} />
    </div>
  )
}
