import { addDays, branchMapsHref, businessDateOf, type OpeningHours, openIntervals } from '@spa/core'
import {
  branches,
  serviceCategories,
  services,
  serviceVariants,
  staff,
  staffServices,
  type Tx,
  withTenant,
} from '@spa/db'
import { publicPrice, spaHidesPrices } from '@spa/services'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import type { BookingCatalog, BookingGroup } from './types'

export const BOOKING_DAYS = 14
/** Online bookings need at least this much notice. */
export const LEAD_MIN = 60

/**
 * Tenants whose public booking is open. A paused spa (`read_only`, late payment — PLAN §14.8 R12) keeps its site and
 * booking; suspended / cancelled accounts keep the site but not bookings.
 */
export const acceptsBookings = (status: string) =>
  status === 'trial' || status === 'active' || status === 'past_due' || status === 'read_only'

/** Open branches, main first (the public booking page lets clients pick one when there are several — G22). */
export async function bookingBranches(tx: Tx) {
  return tx
    .select()
    .from(branches)
    .where(eq(branches.active, true))
    .orderBy(desc(branches.isDefault), asc(branches.createdAt))
}

/** The branch an online booking goes to: the chosen open branch, else the default, else the first open one. */
export async function bookingBranch(tx: Tx, branchId?: string | null) {
  const rows = await bookingBranches(tx)
  return rows.find((b) => b.id === branchId) ?? rows[0] ?? null
}

/** The next N business dates (branch cutoff aware), starting with today's business date. */
export function bookingDates(branch: { businessDayCutoff: string; openingHours: unknown }, now = new Date()) {
  const first = businessDateOf(now, branch.businessDayCutoff.slice(0, 5))
  return Array.from({ length: BOOKING_DAYS }, (_, i) => {
    const date = addDays(first, i)
    return { date, closed: openIntervals(date, branch.openingHours as OpeningHours).length === 0 }
  })
}

/** Everything the public booking page renders, read under the tenant's RLS context. */
export async function loadBookingCatalog(
  tenant: { id: string; name: string },
  branchId?: string | null,
): Promise<BookingCatalog | null> {
  return withTenant(tenant.id, async (tx) => {
    const all = await bookingBranches(tx)
    const branch = all.find((b) => b.id === branchId) ?? all[0]
    if (!branch) return null
    const [cats, svcRows] = await Promise.all([
      tx.select().from(serviceCategories).orderBy(asc(serviceCategories.sort)),
      tx
        .select()
        .from(services)
        .where(and(eq(services.active, true), eq(services.onlineBookable, true)))
        .orderBy(asc(services.sort), asc(services.createdAt)),
    ])
    const ids = svcRows.map((s) => s.id)
    const variants = ids.length
      ? await tx
          .select()
          .from(serviceVariants)
          .where(and(inArray(serviceVariants.serviceId, ids), eq(serviceVariants.active, true)))
          .orderBy(asc(serviceVariants.sort), asc(serviceVariants.durationMin))
      : []
    const staffRows = (
      await tx
        .select()
        .from(staff)
        .where(and(eq(staff.active, true), eq(staff.bookable, true)))
        .orderBy(asc(staff.sort), asc(staff.displayName))
    ).filter((s) => s.branchIds.length === 0 || s.branchIds.includes(branch.id))
    const skills = staffRows.length
      ? await tx
          .select()
          .from(staffServices)
          .where(
            inArray(
              staffServices.staffId,
              staffRows.map((s) => s.id),
            ),
          )
      : []

    const hides = await spaHidesPrices(tx, tenant.id)
    const groups = new Map<string, BookingGroup>()
    for (const c of cats) groups.set(c.id, { id: c.id, name: c.name, services: [] })
    const other: BookingGroup = { id: 'other', name: null, services: [] }
    for (const s of svcRows) {
      const vs = variants
        .filter((v) => v.serviceId === s.id)
        .map((v) => {
          const price = publicPrice(v.priceAed, s.showPrice, hides)
          return { id: v.id, durationMin: v.durationMin, priceAed: price == null ? null : Number(price) }
        })
      if (!vs.length) continue
      const group = (s.categoryId && groups.get(s.categoryId)) || other
      group.services.push({
        id: s.id,
        name: s.name,
        description: s.description ?? null,
        imageUrl: s.imageUrl,
        therapistsRequired: s.therapistsRequired,
        variants: vs,
      })
    }

    return {
      spa: tenant.name,
      branch: {
        id: branch.id,
        name: branch.name,
        address: branch.address,
        mapsHref: branchMapsHref(branch),
        hasWhatsapp: Boolean(branch.whatsappE164),
      },
      branches: all.map((b) => ({ id: b.id, name: b.name, address: b.address })),
      groups: [...groups.values(), other].filter((g) => g.services.length),
      therapists: staffRows.map((s) => ({
        id: s.id,
        name: s.displayName,
        photoUrl: s.photoUrl,
        serviceIds: skills.filter((k) => k.staffId === s.id).map((k) => k.serviceId),
      })),
      dates: bookingDates(branch),
    }
  })
}
