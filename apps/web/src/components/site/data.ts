import { businessDateOf, dubaiInstant, dubaiParts } from '@spa/core'
import { branches, type Tx, withTenant } from '@spa/db'
import {
  editingTheme,
  getSite,
  listPages,
  listPublishedPosts,
  type SiteRow,
  siteInstagram,
  siteReviews,
  websiteServices,
  websiteStaff,
} from '@spa/services'
import { eq } from 'drizzle-orm'
import { hasFeature } from '@/server/entitlements'
import { normalizeTheme, type SiteTheme } from './theme'
import type { Locale, SiteData, SiteMeta } from './types'

export type TenantLite = { id: string; slug: string; name: string }

/**
 * Live data for the smart blocks (services + prices, "Show on website" staff, main branch, blog posts; Google reviews
 * and the Instagram feed only when the plan has `marketing` — F15, PLAN §18.8).
 */
async function loadLive(tx: Tx, tenant: TenantLite, marketing: boolean): Promise<Omit<SiteData, 'pages'>> {
  const [branch] = await tx.select().from(branches).where(eq(branches.isDefault, true)).limit(1)
  // The CRM Website page's "On the website" rule (services websiteServices; R26 adds the photo).
  const serviceRows = await websiteServices(tx, tenant.id)
  // One public-staff rule for every site (Team block, HTML designs): active with "Show on website" on (R26).
  const people = await websiteStaff(tx)
  const posts = await listPublishedPosts(tx, 24)
  const reviews = marketing ? await siteReviews(tx, { limit: 12, minRating: 4 }) : null
  const instagram = marketing ? await siteInstagram(tx, { limit: 12 }) : null
  return {
    tenant: { name: tenant.name, slug: tenant.slug },
    branch: branch
      ? {
          name: branch.name,
          address: branch.address,
          mapsUrl: branch.mapsUrl,
          phone: branch.phone,
          whatsappE164: branch.whatsappE164,
          openingHours: branch.openingHours,
          businessDayCutoff: branch.businessDayCutoff.slice(0, 5),
        }
      : null,
    services: serviceRows,
    staff: people,
    posts: posts.map((p) => ({
      slug: p.slug,
      title: p.title,
      excerpt: p.excerpt,
      coverImage: p.coverImage,
      publishedAt: p.publishedAt?.toISOString() ?? null,
    })),
    reviews: reviews && {
      ...reviews,
      items: reviews.items.map((r) => ({ ...r, reviewedAt: r.reviewedAt?.toISOString() ?? null })),
    },
    instagram,
  }
}

/**
 * Everything a page render needs, in one tenant transaction. `published` limits navigation to live pages
 * (public site); the dashboard previews show every visible page.
 */
export async function loadSite(tenant: TenantLite, opts: { published: boolean }) {
  const marketing = await hasFeature(tenant.id, 'marketing')
  return withTenant(tenant.id, async (tx) => {
    const site = await getSite(tx, tenant.id)
    const live = await loadLive(tx, tenant, marketing)
    const pages = (await listPages(tx, tenant.id)).filter(
      (p) => p.visible && (!opts.published || p.publishedAt),
    )
    // Editor + previews (not published) show unpublished AI edits: the draft theme and pending page renames.
    const draft = !opts.published
    return {
      site: (site && draft ? { ...site, theme: editingTheme(site) } : site) as SiteRow | null,
      data: {
        ...live,
        pages: pages.map((p) => ({ slug: p.slug, title: (draft && p.pending?.title) || p.title })),
      } satisfies SiteData,
    }
  })
}

export function buildMeta(input: {
  data: SiteData
  theme: SiteTheme | Record<string, unknown> | null
  locale: Locale
  base: string
  slug: string
  editing?: boolean
}): SiteMeta {
  // Late-night shops: after midnight but before the cutoff it is still "yesterday" for opening hours.
  const date = businessDateOf(new Date(), input.data.branch?.businessDayCutoff ?? '05:00')
  const weekday = dubaiParts(dubaiInstant(date, 12 * 60)).weekday
  return {
    locale: input.locale,
    base: input.base,
    slug: input.slug,
    data: input.data,
    theme: normalizeTheme(input.theme as Record<string, unknown>),
    editing: input.editing,
    today: weekday,
  }
}

export const localeOf = (lang: string | string[] | undefined): Locale => (lang === 'ar' ? 'ar' : 'en')
