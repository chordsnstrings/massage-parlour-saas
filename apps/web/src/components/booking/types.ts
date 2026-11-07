import type { Bi } from './i18n'

/** Public site identity used by the booking actions (subdomain slug or verified custom domain). */
export type SiteKey = { slug: string } | { hostname: string }

/** `priceAed` null = price on request (none set, or hidden on the website — R4). */
export type BookingVariant = { id: string; durationMin: number; priceAed: number | null }
export type BookingService = {
  id: string
  name: Bi
  description: Bi | null
  imageUrl: string | null
  therapistsRequired: number
  variants: BookingVariant[]
}
export type BookingGroup = { id: string; name: Bi | null; services: BookingService[] }
export type BookingTherapist = { id: string; name: string; photoUrl: string | null; serviceIds: string[] }
export type BookingDate = { date: string; closed: boolean }

export type BookingCatalog = {
  spa: string
  /** `mapsHref`: the branch's Google Maps link (exact pin, else an address search; null without an address). */
  branch: { id: string; name: string; address: string | null; mapsHref: string | null; hasWhatsapp: boolean }
  /** Open branches; the page shows a picker when there is more than one (G22). */
  branches: { id: string; name: string; address: string | null }[]
  groups: BookingGroup[]
  therapists: BookingTherapist[]
  dates: BookingDate[]
}

export type SlotOption = { start: string; minutes: number }

export type BookingDone = {
  ref: string
  start: string
  end: string
  service: string
  durationMin: number
  priceAed: number | null
  therapist: string | null
  whatsappUrl: string | null
  spa: string
  address: string | null
  /** Auto-confirmed returning client (G21); otherwise a request the spa confirms. */
  confirmed: boolean
}
