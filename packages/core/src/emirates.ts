/** The seven emirates (spa applications, PLAN §18.3). Keys are stored; names are shown (EN; TH in `auth.apply.emirate`). */
export const UAE_EMIRATES = [
  'abu_dhabi',
  'dubai',
  'sharjah',
  'ajman',
  'umm_al_quwain',
  'ras_al_khaimah',
  'fujairah',
] as const

export type UaeEmirate = (typeof UAE_EMIRATES)[number]

export const EMIRATE_NAMES: Record<UaeEmirate, string> = {
  abu_dhabi: 'Abu Dhabi',
  dubai: 'Dubai',
  sharjah: 'Sharjah',
  ajman: 'Ajman',
  umm_al_quwain: 'Umm Al Quwain',
  ras_al_khaimah: 'Ras Al Khaimah',
  fujairah: 'Fujairah',
}

export const isEmirate = (v: unknown): v is UaeEmirate =>
  typeof v === 'string' && (UAE_EMIRATES as readonly string[]).includes(v)
