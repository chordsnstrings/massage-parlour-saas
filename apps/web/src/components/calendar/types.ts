/** Serializable calendar data passed from the server page to the client calendar. */

export type BookingStatus =
  | 'pending'
  | 'confirmed'
  | 'checked_in'
  | 'in_service'
  | 'completed'
  | 'no_show'
  | 'cancelled'

export type BookingSource = 'phone' | 'whatsapp' | 'walk_in' | 'instagram' | 'online' | 'ai_agent' | 'gbp'

/** Minutes are relative to 00:00 Dubai time of the business date (may exceed 1440 past midnight). */
export type CalItem = {
  id: string
  bookingId: string
  refCode: string
  status: BookingStatus
  source: BookingSource
  startMin: number
  endMin: number
  staffIds: string[]
  roomId: string | null
  serviceName: string
  durationMin: number
  priceAed: string | null
  clientName: string | null
  /** Already masked when the viewer lacks clients.phone. */
  clientPhone: string | null
  /** Click-to-chat link; only when the viewer may see the number. */
  clientWhatsapp: string | null
  notes: string | null
  cancelReason: string | null
}

export type CalStaff = {
  id: string
  name: string
  color: string
  /** Shift intervals in grid minutes. */
  shifts: { start: number; end: number }[]
}

export type CalRoom = { id: string; name: string }

export type CalVariant = { id: string; label: string; durationMin: number; priceAed: string | null }

export type RotationRow = {
  staffId: string
  name: string
  color: string
  turns: number
  status: 'free' | 'busy' | 'break' | 'off'
}

export type CalendarData = {
  slug: string
  date: string
  /** Server-formatted "Thu, 8 Oct" in the viewer's language (client ICU may differ → hydration mismatch). */
  dayLabel: string
  today: string
  branchId: string
  branches: { id: string; name: string }[]
  view: 'staff' | 'rooms'
  showCancelled: boolean
  /** Epoch ms of 00:00 Dubai on the business date. */
  dayStartMs: number
  cutoffMin: number
  gridStart: number
  gridEnd: number
  staff: CalStaff[]
  rooms: CalRoom[]
  /** Every staff member (incl. inactive) for names in booking details. */
  staffNames: Record<string, { name: string; color: string }>
  items: CalItem[]
  variants: CalVariant[]
  rotation: RotationRow[] | null
  canManage: boolean
  canCheckout: boolean
  ownOnly: boolean
  checkoutBase: string
  calendarBase: string
}
