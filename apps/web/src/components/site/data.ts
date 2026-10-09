import { businessDateOf, dubaiInstant, dubaiParts } from '@spa/core'
import { branches, serviceCategories, services, serviceVariants, staff, type Tx, withTenant } from '@spa/db'
import { editingTheme, getSite, listPages, publicPrice, type SiteRow, spaHidesPrices } from '@spa/services'
import { and, asc, eq } from 'drizzle-orm'
import { normalizeTheme, type SiteTheme } from './theme'
import type { Locale, SiteData, SiteMeta } from './types'

type TenantLite = { id: string; slug: string; name: string }

/** Live data for the smart blocks (services + prices, bookable staff, main branch). */
async function loadLive(tx: Tx, tenant: TenantLite): Promise<Omit<SiteData, 'pages'>> {
  const [branch] = await tx.select().from(branches).where(eq(branches.isDefault, true)).limit(1)
  const serviceRows = await tx
    .select({
      id: services.id,
      name: services.name,
      description: services.description,
      category: serviceCategories.name,
      categorySort: serviceCategories.sort,
      showPrice: services.showPrice,
      sort: services.sort,
    })
    .from(services)
    .leftJoin(serviceCategories, eq(serviceCategories.id, services.categoryId))
    .where(and(eq(services.active, true), eq(services.onlineBookable, true)))
    .orderBy(asc(serviceCategories.sort), asc(services.sort), asc(services.createdAt))
  const variants = await tx
    .select({
      serviceId: serviceVariants.serviceId,
      durationMin: serviceVariants.durationMin,
      priceAed: serviceVariants.priceAed,
    })
    .from(serviceVariants)
    .where(eq(serviceVariants.active, true))
    .orderBy(asc(serviceVariants.sort), asc(serviceVariants.durationMin))
  const spaHides = await spaHidesPrices(tx, tenant.id)
  const people = await tx
    .select({ id: staff.id, name: staff.displayName, photoUrl: staff.photoUrl, bio: staff.bio })
    .from(staff)
    .where(and(eq(staff.active, true), eq(staff.bookable, true)))
    .orderBy(asc(staff.sort), asc(staff.displayName))
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
    services: serviceRows
      .map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description ?? null,
        category: s.category ?? null,
        variants: variants
          .filter((v) => v.serviceId === s.id)
          .map((v) => ({
            durationMin: v.durationMin,
            priceAed: publicPrice(v.priceAed, s.showPrice, spaHides),
          })),
      }))
      .filter((s) => s.variants.length > 0),
    staff: people.map((p) => ({ ...p, bio: p.bio ?? null })),
  }
}

/**
 * Everything a page render needs, in one tenant transaction. `published` limits navigation to live pages
 * (public site); the dashboard previews show every visible page.
 */
export async function loadSite(tenant: TenantLite, opts: { published: boolean }) {
  return withTenant(tenant.id, async (tx) => {
    const site = await getSite(tx, tenant.id)
    const live = await loadLive(tx, tenant)
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
