// R28 P3 (docs/design/r28-dynamic-html-designs.md §4): fill a spa's CRM from a contract design's own data (its
// `window.CRM_DATA` literal) when a super-admin applies it: treatments get the design's photos and descriptions,
// missing treatments can be created, therapist photos are assigned by click. Preview first (`planDesignSeed`, read
// only), then `applyDesignSeed` with the super-admin's choices. These are CRM changes that go live at once; the
// design file itself never changes (R24). Pictures are the design's `data:` images, re-encoded once into the spa's
// media library (tag `design:{sha8}`; a re-run reuses them). Prices and durations of existing services are never
// touched. Like every service: takes the caller's tenant tx; no permission or audit checks (web: seed-actions.ts).
import { createHash } from 'node:crypto'
import { crmName, crmSlug, designSeedPairs } from '@spa/core'
import { type Bilingual, mediaAssets, services, staff, type Tx } from '@spa/db'
import { and, arrayContains, asc, eq, inArray } from 'drizzle-orm'
import {
  NEW_SERVICE_DEFAULTS,
  SERVICE_DURATION_MAX,
  SERVICE_DURATION_MIN,
  saveService,
  setServiceImage,
  setStaffPhoto,
} from './catalog'
import { DomainError } from './errors'
import { createAsset, MediaError, processImage, sniffImageType } from './media'
import { MAX_FILE_BYTES } from './storage'

/** Picture types a design may embed for seeding (`data:` URIs; never SVG). */
export const DESIGN_SEED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const
/** Largest embedded picture taken (decoded bytes), the stored-file limit. */
export const DESIGN_SEED_IMAGE_BYTES = MAX_FILE_BYTES
/** Duration of a created service when the design names none. */
export const DESIGN_SEED_DEFAULT_DURATION = 60
const DESCRIPTION_MAX = 600
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ─── Reading the design ──────────────────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const list = (v: unknown) => (Array.isArray(v) ? v : []).map((x) => (isObj(x) ? x : {}))
/** A design text: a string, or the English of `{en, ar}`. */
const text = (v: unknown): string =>
  (typeof v === 'string' ? v : isObj(v) && typeof v.en === 'string' ? v.en : '').trim()

function uniqueIds() {
  const seen = new Set<string>()
  return (base: string) => {
    let id = base
    for (let n = 2; seen.has(id); n++) id = `${base}-${n}`
    seen.add(id)
    return id
  }
}

type DesignService = {
  designId: string
  index: number
  name: string
  durations: number[]
  note: string
  description: string
  image: unknown
}
type DesignStaff = { designId: string; index: number; name: string; photo: unknown }

/** The design's services (named ones), each with a stable id: its own id, else the slug of its name. */
function designServices(data: Record<string, unknown> | null | undefined): DesignService[] {
  const id = uniqueIds()
  return list(data?.services).flatMap((x, index) => {
    const name = text(x.name)
    if (!name) return []
    const durations = [
      ...new Set(
        (Array.isArray(x.durations) ? x.durations : [])
          .map(Number)
          .filter((d) => Number.isInteger(d) && d >= SERVICE_DURATION_MIN && d <= SERVICE_DURATION_MAX),
      ),
    ].sort((a, b) => a - b)
    return [
      {
        designId: id(text(x.id) || crmSlug(name) || `service-${index + 1}`),
        index,
        name,
        durations,
        note: text(x.note),
        description: text(x.description),
        image: x.image,
      },
    ]
  })
}

/** The design's team members, each with a stable id (own id, slug of the name, else `staff-{n}`). */
function designStaff(data: Record<string, unknown> | null | undefined): DesignStaff[] {
  const id = uniqueIds()
  return list(data?.staff).map((x, index) => {
    const name = text(x.name)
    return {
      designId: id(text(x.id) || crmSlug(name) || `staff-${index + 1}`),
      index,
      name,
      photo: x.photo,
    }
  })
}

const DATA_URI = /^data:([a-z]+\/[\w.+-]+)((?:;[^;,]*)*),/i

/** The base64 body of a usable embedded picture (PNG / JPEG / WebP / GIF `data:` URI, ≤ 8 MB), without decoding. */
function dataImage(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('data:')) return null
  const m = DATA_URI.exec(value.slice(0, 256))
  if (!m) return null
  const declared = m[1]!.toLowerCase()
  const type = declared === 'image/jpg' ? 'image/jpeg' : declared
  if (!(DESIGN_SEED_IMAGE_TYPES as readonly string[]).includes(type)) return null
  if (!m[2]!.split(';').some((p) => p.trim().toLowerCase() === 'base64')) return null
  const body = value.slice(m[0].length)
  const size = Math.floor((body.replace(/[\s=]+/g, '').length * 3) / 4)
  return size > 0 && size <= DESIGN_SEED_IMAGE_BYTES ? body : null
}

/** Whether a design value is a picture seeding can use. */
export const isDesignSeedImage = (value: unknown) => dataImage(value) !== null

// ─── Plan (read only) ────────────────────────────────────────────────────────

export type DesignSeedPlan = {
  /** The design's services, in design order, with the CRM service each pairs with (score ≥ 0.5) or null. */
  services: {
    designId: string
    /** Position in the design's `services[]` (the UI shows the design's own picture from there). */
    index: number
    designName: string
    durations: number[]
    note: string
    description: string
    hasImage: boolean
    match: { serviceId: string; name: string; score: number } | null
  }[]
  /** The design's team photos (position in its `staff[]`) that can go to a therapist. */
  staffPhotos: { designId: string; index: number; name: string }[]
  /** The spa's active therapists (a photo can go to any of them). */
  crmStaff: { id: string; name: string; hasPhoto: boolean; showOnSite: boolean }[]
}

/** What applying the design would pair and offer (nothing is written). `designData` = the design's CRM_DATA. */
export async function planDesignSeed(
  tx: Tx,
  tenantId: string,
  designData: Record<string, unknown> | null | undefined,
): Promise<DesignSeedPlan> {
  const own = designServices(designData)
  const crm = await tx
    .select({ id: services.id, name: services.name })
    .from(services)
    .where(and(eq(services.tenantId, tenantId), eq(services.active, true)))
    .orderBy(asc(services.sort), asc(services.createdAt))
  const pairs = designSeedPairs(
    own.map((s) => ({ name: s.name, id: s.designId })),
    crm.map((s) => ({ names: [s.name.en, s.name.ar ?? ''] })),
  )
  const people = await tx
    .select({ id: staff.id, name: staff.displayName, photoUrl: staff.photoUrl, showOnSite: staff.showOnSite })
    .from(staff)
    .where(and(eq(staff.tenantId, tenantId), eq(staff.active, true)))
    .orderBy(asc(staff.sort), asc(staff.displayName))
  return {
    services: own.map((s, i) => {
      const p = pairs[i]
      const m = p ? crm[p.crm]! : null
      return {
        designId: s.designId,
        index: s.index,
        designName: s.name,
        durations: s.durations,
        note: s.note,
        description: s.description,
        hasImage: isDesignSeedImage(s.image),
        match: m && p ? { serviceId: m.id, name: m.name.en, score: p.score } : null,
      }
    }),
    staffPhotos: designStaff(designData)
      .filter((s) => isDesignSeedImage(s.photo))
      .map(({ designId, index, name }) => ({ designId, index, name })),
    crmStaff: people.map((p) => ({
      id: p.id,
      name: p.name,
      hasPhoto: Boolean(p.photoUrl),
      showOnSite: p.showOnSite,
    })),
  }
}

// ─── Apply ───────────────────────────────────────────────────────────────────

export type DesignSeedChoices = {
  /**
   * Per design service: `fill` the paired CRM service `serviceId` (photo / description only where empty, or both
   * when `replace`), `create` a new service (the design's durations, price on request), or `skip` it (any other
   * action is a skip).
   */
  services: { designId: string; action: 'fill' | 'create' | 'skip'; serviceId?: string; replace?: boolean }[]
  /** Design team photo → CRM therapist; `showOnSite` switches "Show on website" on (never off). */
  staff: { designId: string; staffId: string; showOnSite?: boolean }[]
  /** Every other design picture (skipped services, photos nobody got) goes to the media library too. Default true. */
  library?: boolean
}

export type DesignSeedSummary = {
  servicesFilled: number
  servicesCreated: number
  photosSet: number
  /** New media-library pictures (pictures already there from an earlier run are reused, not counted). */
  assets: number
  /** Embedded pictures that couldn't be read (skipped; the rest still applies). */
  picturesFailed: number
}

const isEmptyText = (b: Bilingual | null | undefined) => !b?.en?.trim()
const sha8 = (b: Buffer) => createHash('sha256').update(b).digest('hex').slice(0, 8)

/**
 * Applies the super-admin's choices for a design (`designData` = its CRM_DATA): fills / creates services, sets the
 * picked therapists' photos, stores the pictures in the media library. Ids that aren't this spa's (RLS) or a design
 * id the design doesn't have refuse the whole apply. Run it in one tx (pictures are re-encoded inside it).
 */
export async function applyDesignSeed(
  tx: Tx,
  tenantId: string,
  designData: Record<string, unknown> | null | undefined,
  choices: DesignSeedChoices,
  opts: { userId: string | null },
): Promise<DesignSeedSummary> {
  const own = new Map(designServices(designData).map((s) => [s.designId, s]))
  const team = new Map(designStaff(designData).map((s) => [s.designId, s]))
  const summary: DesignSeedSummary = {
    servicesFilled: 0,
    servicesCreated: 0,
    photosSet: 0,
    assets: 0,
    picturesFailed: 0,
  }

  // Check every id first: nothing is written when one is wrong.
  for (const c of choices.services) {
    if (!own.has(c.designId)) throw new DomainError(`The design has no service “${c.designId}”`, 'invalid')
    if (c.action === 'fill' && !(c.serviceId && UUID.test(c.serviceId)))
      throw new DomainError('Pick the CRM service to fill', 'invalid')
  }
  for (const c of choices.staff) {
    if (!team.has(c.designId))
      throw new DomainError(`The design has no team member “${c.designId}”`, 'invalid')
    if (!UUID.test(c.staffId)) throw new DomainError('Pick the therapist for the photo', 'invalid')
  }
  const serviceIds = [
    ...new Set(choices.services.flatMap((c) => (c.action === 'fill' && c.serviceId ? [c.serviceId] : []))),
  ]
  const crm = await tx
    .select({
      id: services.id,
      name: services.name,
      imageUrl: services.imageUrl,
      description: services.description,
    })
    .from(services)
    .where(eq(services.tenantId, tenantId))
  const crmById = new Map(crm.map((s) => [s.id, s]))
  if (serviceIds.some((id) => !crmById.has(id))) throw new DomainError('Service not found', 'not_found')
  const staffIds = [...new Set(choices.staff.map((c) => c.staffId))]
  if (staffIds.length) {
    const found = await tx
      .select({ id: staff.id })
      .from(staff)
      .where(and(eq(staff.tenantId, tenantId), inArray(staff.id, staffIds)))
    if (found.length !== staffIds.length) throw new DomainError('Therapist not found', 'not_found')
  }

  // Pictures: decoded, checked by magic bytes, re-encoded once; the same bytes again → the same library picture.
  const stored = new Map<string, string>()
  const unreadable = new Set<string>()
  const failed = (body: string) => {
    unreadable.add(body)
    summary.picturesFailed++
    return null
  }
  const picture = async (value: unknown, label: string): Promise<string | null> => {
    const body = dataImage(value)
    if (body === null || unreadable.has(body)) return null
    const bytes = Buffer.from(body, 'base64')
    const type = sniffImageType(bytes)
    if (
      !type ||
      !(DESIGN_SEED_IMAGE_TYPES as readonly string[]).includes(type) ||
      bytes.length > MAX_FILE_BYTES
    )
      return failed(body)
    const tag = `design:${sha8(bytes)}`
    const known = stored.get(tag)
    if (known) return known
    const [existing] = await tx
      .select({ url: mediaAssets.url })
      .from(mediaAssets)
      .where(and(eq(mediaAssets.tenantId, tenantId), arrayContains(mediaAssets.tags, [tag])))
      .limit(1)
    if (existing) {
      stored.set(tag, existing.url)
      return existing.url
    }
    let image: Awaited<ReturnType<typeof processImage>>
    try {
      image = await processImage(bytes)
    } catch (e) {
      if (!(e instanceof MediaError)) throw e
      return failed(body)
    }
    const row = await createAsset(tx, {
      tenantId,
      image,
      source: 'upload',
      filename: `design-${crmSlug(label) || 'picture'}`,
      alt: { en: label || undefined },
      tags: ['design', tag],
      createdBy: opts.userId,
    })
    summary.assets++
    stored.set(tag, row.url)
    return row.url
  }

  /** Photo / description from the design into a CRM service: only empty fields unless `replace`. */
  const fill = async (serviceId: string, s: DesignService, replace: boolean) => {
    const row = crmById.get(serviceId)!
    const set: { imageUrl?: string; description?: Bilingual } = {}
    if (replace || !row.imageUrl) {
      const url = await picture(s.image, s.name)
      if (url && url !== row.imageUrl) set.imageUrl = url
    }
    const description = s.description.slice(0, DESCRIPTION_MAX)
    if (description && (replace || isEmptyText(row.description)) && description !== row.description?.en)
      set.description = { en: description, ...(row.description?.ar ? { ar: row.description.ar } : {}) }
    if (!Object.keys(set).length) return
    await setServiceImage(tx, serviceId, set)
    crmById.set(serviceId, { ...row, ...set })
    summary.servicesFilled++
  }

  for (const c of choices.services) {
    const s = own.get(c.designId)!
    if (c.action === 'fill') await fill(c.serviceId!, s, Boolean(c.replace))
    else if (c.action === 'create') {
      // Already there under the same name (a second apply): fill that one, never a duplicate.
      const same = [...crmById.values()].find((r) => crmName(r.name.en) === crmName(s.name))
      if (same) {
        await fill(same.id, s, false)
        continue
      }
      const imageUrl = await picture(s.image, s.name)
      const description = s.description.slice(0, DESCRIPTION_MAX)
      const name = { en: s.name.slice(0, 80) }
      const id = await saveService(tx, tenantId, {
        ...NEW_SERVICE_DEFAULTS,
        name,
        description: description ? { en: description } : null,
        imageUrl,
        variants: (s.durations.length ? s.durations : [DESIGN_SEED_DEFAULT_DURATION]).map((durationMin) => ({
          durationMin,
          priceAed: null,
        })),
      })
      crmById.set(id!, { id: id!, name, imageUrl, description: description ? { en: description } : null })
      summary.servicesCreated++
    }
  }

  // Last pick per therapist wins.
  const picks = new Map(choices.staff.map((c) => [c.staffId, c]))
  for (const c of picks.values()) {
    const s = team.get(c.designId)!
    const url = await picture(s.photo, s.name)
    if (!url) continue
    await setStaffPhoto(tx, c.staffId, { photoUrl: url, ...(c.showOnSite ? { showOnSite: true } : {}) })
    summary.photosSet++
  }

  if (choices.library !== false) {
    for (const s of own.values()) await picture(s.image, s.name)
    for (const s of team.values()) await picture(s.photo, s.name)
  }
  return summary
}
