import type { Bi } from './i18n'

/** Public site identity used by the booking actions (subdomain slug or verified custom domain). */
export type SiteKey = { slug: string } | { hostname: string }

export type BookingVariant = { id: string; durationMin: number; priceAed: number }
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
  branch: { name: string; address: string | null; hasWhatsapp: boolean }
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
  priceAed: number
  therapist: string | null
  whatsappUrl: string | null
  spa: string
  address: string | null
}
