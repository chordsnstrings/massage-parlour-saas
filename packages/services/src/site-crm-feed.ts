// R26: the public CRM facts an HTML design's data contract is built from (docs/design/html-crm-contract.md). Callers
// run these inside withTenant(); only public fields are read (never staff phones, pay or e-mail, private branch data).
import { branches, pageVersions, staff, type Tx, tenants } from '@spa/db'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'

export type WebsiteStaffMember = {
  id: string
  name: string
  bio: { en: string; ar?: string } | null
  photoUrl: string | null
}

/** Staff on the website: active with "Show on website" on (opt-in, default off), by sort then name. */
export async function websiteStaff(tx: Tx): Promise<WebsiteStaffMember[]> {
  const rows = await tx
    .select({ id: staff.id, name: staff.displayName, bio: staff.bio, photoUrl: staff.photoUrl })
    .from(staff)
    .where(and(eq(staff.active, true), eq(staff.showOnSite, true)))
    .orderBy(asc(staff.sort), asc(staff.displayName))
  return rows.map((r) => ({ ...r, bio: r.bio ?? null, photoUrl: r.photoUrl ?? null }))
}

/** Everything the contract needs besides the website services: branches (default first), staff, logo, status. */
export async function crmFeedFacts(tx: Tx, tenantId: string) {
  const [tenant] = await tx
    .select({ name: tenants.name, logoFileId: tenants.logoFileId, status: tenants.status })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
  const open = await tx
    .select({
      name: branches.name,
      address: branches.address,
      mapsUrl: branches.mapsUrl,
      phone: branches.phone,
      whatsappE164: branches.whatsappE164,
      openingHours: branches.openingHours,
    })
    .from(branches)
    .where(eq(branches.active, true))
    .orderBy(desc(branches.isDefault), asc(branches.createdAt))
  return {
    name: tenant?.name ?? '',
    logoFileId: tenant?.logoFileId ?? null,
    status: tenant?.status ?? 'cancelled',
    branches: open,
    staff: await websiteStaff(tx),
  }
}

/**
 * Ids of the live versions (newest published of each visible page) whose content has an HtmlDesign block. Published
 * versions are never rewritten, so the ids address the live content (a cache key). Only a site whose live HTML design
 * uses the contract takes design booking requests (`{site}/crm-enquiry`).
 */
export async function liveHtmlDesignVersionIds(tx: Tx, tenantId: string): Promise<string[]> {
  const { rows } = await tx.execute<{ id: string }>(sql`
    select v.id from site_pages sp
    join sites s on s.id = sp.site_id and s.tenant_id = ${tenantId}
    join lateral (
      select pv.id, pv.data from page_versions pv
      where pv.page_id = sp.id and pv.status = 'published'
      order by pv.created_at desc limit 1
    ) v on true
    where sp.visible and sp.tenant_id = ${tenantId}
      and jsonb_path_exists(v.data, '$.content[*] ? (@.type == "HtmlDesign")')
    order by v.id`)
  return rows.map((r) => r.id)
}

/** Page data of these versions. */
export async function pageVersionsData(tx: Tx, ids: string[]) {
  if (!ids.length) return []
  return tx
    .select({ id: pageVersions.id, data: pageVersions.data })
    .from(pageVersions)
    .where(inArray(pageVersions.id, ids))
}
