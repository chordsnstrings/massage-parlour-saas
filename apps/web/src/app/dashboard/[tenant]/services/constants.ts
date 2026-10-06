export const ROOM_TYPES = ['single', 'couple', 'vip', 'foot', 'thai', 'other'] as const
export type RoomType = (typeof ROOM_TYPES)[number]

export const ROOM_TYPE_LABEL: Record<RoomType, string> = {
  single: 'Single',
  couple: 'Couple',
  vip: 'VIP',
  foot: 'Foot',
  thai: 'Thai mat',
  other: 'Other',
}

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
