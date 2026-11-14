// Service + staff write rules shared by the spa dashboard (Services and Staff screens) and the console's "fill the
// CRM from the design" (R28 P3, design-seed.ts): one place for the rules (≥ 1 duration of 10–480 min, prices 0–100,000
// AED or on request, image URLs from the library or https, website bio ≤ 120). The dashboard's zod schemas check the
// same rules first (their messages map to form fields); here they are the last line for every caller. Like every
// service: takes the caller's tenant tx; no permission or audit checks.

import type { MessageKey } from '@spa/core/i18n/types'
import { type Bilingual, services, serviceVariants, staff, type Tx } from '@spa/db'
import { and, count, eq, notInArray } from 'drizzle-orm'
import { DomainError } from './errors'

/** An image URL a service / staff photo may hold: a library file (`/files/{id}[/name]`) or an https link. */
export const IMAGE_URL_PATTERN = /^(\/files\/[0-9a-f-]{36}(\/[\w.-]+)?|https:\/\/[^\s"'<>]+)$/i
export const IMAGE_URL_MAX = 500
export const SERVICE_DURATION_MIN = 10
export const SERVICE_DURATION_MAX = 480
export const SERVICE_PRICE_MAX = 100_000
/** One line for the website team card (typed text, never translated). */
export const STAFF_BIO_MAX = 120

const refuse = (message: string, key: MessageKey, code: 'invalid' | 'not_found' = 'invalid') =>
  new DomainError(message, code, { key })

export type ServiceVariantInput = { id?: string; durationMin: number; priceAed: number | null }

export type ServiceInput = {
  categoryId: string | null
  name: Bilingual
  description: Bilingual | null
  bufferBeforeMin: number
  bufferAfterMin: number
  therapistsRequired: number
  roomTypes: string[]
  equipmentTypes: string[]
  onlineBookable: boolean
  /** null = the spa default (settings), else this service overrides it (R4). */
  showPrice: boolean | null
  active: boolean
  color: string | null
  /** undefined = unchanged (forms without the photo field); null = no photo. */
  imageUrl?: string | null
  /** Durations with prices (null = price on request, typed at checkout). Existing ones keep their id. */
  variants: ServiceVariantInput[]
}

/** A new service's settings when only its name, texts and durations are known (the dashboard form's defaults). */
export const NEW_SERVICE_DEFAULTS = {
  categoryId: null,
  description: null,
  bufferBeforeMin: 0,
  bufferAfterMin: 10,
  therapistsRequired: 1,
  roomTypes: [],
  equipmentTypes: [],
  onlineBookable: true,
  showPrice: null,
  active: true,
  color: null,
} satisfies Omit<ServiceInput, 'name' | 'variants' | 'imageUrl'>

function assertImageUrl(url: string | null | undefined, key: MessageKey) {
  if (url == null) return
  if (url.length > IMAGE_URL_MAX || !IMAGE_URL_PATTERN.test(url))
    throw refuse('Images come from the media library or an https link', key)
}

/** Throws the first broken rule of a service (name, durations, prices, photo). */
export function assertServiceRules(s: Pick<ServiceInput, 'name' | 'variants' | 'imageUrl'>) {
  const name = s.name.en.trim()
  if (name.length < 2 || name.length > 80)
    throw refuse('A service needs a name of 2–80 characters', 'services.v.name')
  if (!s.variants.length) throw refuse('A service needs at least one duration', 'services.v.noDurations')
  for (const v of s.variants) {
    if (
      !Number.isInteger(v.durationMin) ||
      v.durationMin < SERVICE_DURATION_MIN ||
      v.durationMin > SERVICE_DURATION_MAX
    )
      throw refuse('Durations are 10–480 minutes', 'services.v.duration')
    if (
      v.priceAed !== null &&
      (!Number.isFinite(v.priceAed) || v.priceAed < 0 || v.priceAed > SERVICE_PRICE_MAX)
    )
      throw refuse('Prices are 0–100,000 AED or on request', 'services.v.price')
  }
  assertImageUrl(s.imageUrl, 'services.v.image')
}

/**
 * Creates (no `id`) or updates a service with its durations: removed durations are deleted (past bookings keep their
 * name / price snapshot, FK on delete set null), kept ones updated by id, new ones added, in the given order. New
 * services go last. Returns the service id, or null when `id` isn't one of this spa's services (RLS).
 */
export async function saveService(tx: Tx, tenantId: string, input: ServiceInput & { id?: string }) {
  assertServiceRules(input)
  const { id, variants, imageUrl, ...rest } = input
  const values = {
    ...rest,
    equipmentTypes: [...new Set(rest.equipmentTypes)],
    ...(imageUrl !== undefined ? { imageUrl } : {}),
  }
  let serviceId = id
  if (serviceId) {
    const [row] = await tx
      .update(services)
      .set(values)
      .where(eq(services.id, serviceId))
      .returning({ id: services.id })
    if (!row) return null
  } else {
    const [{ n } = { n: 0 }] = await tx.select({ n: count() }).from(services)
    const [row] = await tx
      .insert(services)
      .values({ tenantId, ...values, sort: n })
      .returning({ id: services.id })
    serviceId = row!.id
  }
  const keep = variants.flatMap((v) => (v.id ? [v.id] : []))
  await tx
    .delete(serviceVariants)
    .where(
      keep.length
        ? and(eq(serviceVariants.serviceId, serviceId), notInArray(serviceVariants.id, keep))
        : eq(serviceVariants.serviceId, serviceId),
    )
  for (const [sort, v] of variants.entries()) {
    const row = { durationMin: v.durationMin, priceAed: v.priceAed?.toFixed(2) ?? null, sort }
    if (v.id)
      await tx
        .update(serviceVariants)
        .set(row)
        .where(and(eq(serviceVariants.id, v.id), eq(serviceVariants.serviceId, serviceId)))
    else await tx.insert(serviceVariants).values({ tenantId, serviceId, ...row })
  }
  return serviceId
}

/**
 * Sets a service's photo and/or description (undefined = unchanged; prices and durations are never touched).
 * Returns false when the service isn't one of this spa's (RLS).
 */
export async function setServiceImage(
  tx: Tx,
  serviceId: string,
  p: { imageUrl?: string | null; description?: Bilingual | null },
) {
  assertImageUrl(p.imageUrl, 'services.v.image')
  const set = {
    ...(p.imageUrl !== undefined ? { imageUrl: p.imageUrl } : {}),
    ...(p.description !== undefined ? { description: p.description } : {}),
  }
  const [row] = Object.keys(set).length
    ? await tx.update(services).set(set).where(eq(services.id, serviceId)).returning({ id: services.id })
    : await tx.select({ id: services.id }).from(services).where(eq(services.id, serviceId))
  return Boolean(row)
}

/** The website bio as stored: control characters / line breaks become spaces, trimmed; none → null. */
export function cleanStaffBio(bio: { en?: string; ar?: string } | null | undefined): Bilingual | null {
  const clean = (v: string | undefined) => (v ?? '').replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ').trim()
  const en = clean(bio?.en)
  const ar = clean(bio?.ar)
  if (en.length > STAFF_BIO_MAX || ar.length > STAFF_BIO_MAX)
    throw refuse('The website bio is up to 120 characters', 'staff.validation.bio')
  return en || ar ? { en, ...(ar ? { ar } : {}) } : null
}

/**
 * Sets a therapist's website profile: photo, short bio (≤ 120), "Show on website" (undefined = unchanged). Archived
 * people never show on the website, so `showOnSite: true` on an inactive therapist stays off. Returns false when the
 * therapist isn't one of this spa's (RLS).
 */
export async function setStaffPhoto(
  tx: Tx,
  staffId: string,
  p: { photoUrl?: string | null; bio?: { en?: string; ar?: string } | null; showOnSite?: boolean },
) {
  assertImageUrl(p.photoUrl, 'staff.validation.photo')
  const bio = p.bio === undefined ? undefined : cleanStaffBio(p.bio)
  const set = {
    ...(p.photoUrl !== undefined ? { photoUrl: p.photoUrl } : {}),
    ...(bio !== undefined ? { bio } : {}),
  }
  const [row] = await tx
    .select({ id: staff.id, active: staff.active })
    .from(staff)
    .where(eq(staff.id, staffId))
  if (!row) return false
  const showOnSite = p.showOnSite === undefined ? undefined : p.showOnSite && row.active
  if (Object.keys(set).length || showOnSite !== undefined)
    await tx
      .update(staff)
      .set({ ...set, ...(showOnSite !== undefined ? { showOnSite } : {}) })
      .where(eq(staff.id, staffId))
  return true
}
