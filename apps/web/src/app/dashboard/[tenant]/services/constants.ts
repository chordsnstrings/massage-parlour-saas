export const ROOM_TYPES = ['single', 'couple', 'vip', 'foot', 'thai', 'other'] as const
export type RoomType = (typeof ROOM_TYPES)[number]

/** Calm, distinguishable colours that sit well next to the sage accent. */
export const SWATCHES = [
  '#5e7d6b',
  '#3d5a80',
  '#b5838d',
  '#a26769',
  '#c9a227',
  '#6d597a',
  '#8e7dbe',
  '#4f772d',
  '#d17a22',
  '#577590',
] as const

type ServiceRow = {
  id: string
  categoryId: string | null
  name: { en: string; ar?: string }
  description: { en: string; ar?: string } | null
  bufferBeforeMin: number
  bufferAfterMin: number
  therapistsRequired: number
  roomTypes: string[]
  equipmentTypes: string[]
  onlineBookable: boolean
  showPrice: boolean | null
  active: boolean
  color: string | null
  imageUrl: string | null
}

/** A service row + its variants as the service sheet edits them (services page and website "Services & prices"). */
export const toServiceInput = (
  s: ServiceRow,
  variants: { id: string; durationMin: number; priceAed: string | number | null }[],
) => ({
  id: s.id,
  categoryId: s.categoryId,
  name: s.name,
  description: s.description,
  bufferBeforeMin: s.bufferBeforeMin,
  bufferAfterMin: s.bufferAfterMin,
  therapistsRequired: s.therapistsRequired,
  roomTypes: s.roomTypes,
  equipmentTypes: s.equipmentTypes,
  onlineBookable: s.onlineBookable,
  showPrice: s.showPrice,
  active: s.active,
  color: s.color,
  imageUrl: s.imageUrl,
  variants: variants.map((v) => ({
    id: v.id,
    durationMin: v.durationMin,
    priceAed: v.priceAed == null ? null : Number(v.priceAed),
  })),
})
