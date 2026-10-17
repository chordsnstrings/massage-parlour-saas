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
  /** F13: online bookings' website source (bookings.attribution). */
  attribution: string | null
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
  /** Reserved equipment units (names, as typed) and required types not covered by one (B5.3 conflict). */
  equipment: string[]
  equipmentMissing: string[]
  /** R32: the spa phone line called (1–4) for phone bookings; null otherwise. */
  phoneLine: number | null
  /** R32: picked by reception; null = not set. */
  clientType: 'regular' | 'new' | null
  /** R32: the therapist's own client (pink on the day sheet, no rotation turn). */
  ownLead: boolean
  /** R32 planned commission per therapist (AED text; off the ledger until Finish). */
  commissionAed: string | null
  /** R32: the treatment (prefill from its last typed amounts) and whether the fee/commission were typed yet. */
  variantId: string | null
  termsSet: boolean
  /** R32: the order's live sale once finished (Finish & pay). */
  saleId: string | null
  saleNumber: number | null
}

export type CalStaff = {
  id: string
  name: string
  color: string
  /** Shift intervals in grid minutes. */
  shifts: { start: number; end: number }[]
  /** On approved leave during this business day (B5.4). */
  onLeave?: boolean
}

export type CalRoom = { id: string; name: string }

export type CalVariant = {
  id: string
  label: string
  durationMin: number
  priceAed: string | null
  /** R32: the last fee / commission typed for this treatment (prefill), null = none yet. */
  lastFeeAed: number | null
  lastCommissionAed: number | null
}

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
  /** R32: may type the therapist commission (calendar.manage + calendar.commission). */
  canCommission: boolean
  /** R32: the spa's phone lines with a number (Settings → Daily sales sheet). */
  phoneLines: { line: number; number: string | null }[]
  /** R32: a phone booking must pick its line (at least one line has a number). */
  phoneLineRequired: boolean
  /** R32 (D6): this business day is closed and the member lacks pos.correct (orders read-only). */
  editLocked: boolean
  ownOnly: boolean
  /** Staff id whose bookings this member may check in / start / complete (`calendar.ownStatus`, G14). */
  ownStatusStaffId: string | null
  checkoutBase: string
  /** R32: the linked sale of a finished order (`{salesBase}/{saleId}`). */
  salesBase: string
  bookingsBase: string
  calendarBase: string
  /** Booking whose sheet opens on load (`?open=` from the Week view). */
  openBooking: string | null
  /** "Make booking" from a website booking request (`?enquiry=`): New booking opens on load, prefilled. */
  enquiry: EnquiryPrefill | null
}

/** New booking prefilled from a website booking request (Inbox → Enquiries, owner 2026-10-13). */
export type EnquiryPrefill = {
  id: string
  /** Grid minutes on `date` (the business date the request's time falls on). */
  startMin: number
  variantId: string | null
  staffId?: string
  /** This spa's client with the request's phone, else a new client with its name (+ phone when visible). */
  client: { id: string; name: string; phone: string | null; blocked: boolean } | null
  newClient: { name: string; phone: string; phoneHint: string | null } | null
  notes: string
}

/** Calendar range in the URL (`?range=`); Day is the default. */
export type CalRange = 'day' | 'week' | 'month'

/** One booking item in the Week view (minutes relative to 00:00 Dubai of its business date). */
export type SpanItem = {
  id: string
  bookingId: string
  date: string
  startMin: number
  endMin: number
  status: BookingStatus
  title: string
  serviceName: string
  staffName: string | null
  color: string
}

export type SpanDay = {
  date: string
  /** Server-formatted "Thu 8 Oct" (hydration-safe). */
  label: string
  dayNum: number
  inMonth: boolean
  bookings: number
  pending: number
  /** Server-formatted AED. */
  revenue: string
  /** Booked ÷ shift therapist-minutes (0–1), null without shifts. */
  occupancy: number | null
}

export type SpanData = {
  range: 'week' | 'month'
  date: string
  today: string
  title: string
  from: string
  to: string
  prev: string
  next: string
  branchId: string
  branches: { id: string; name: string }[]
  /** Short weekday names Mon…Sun in the viewer's language. */
  weekdays: string[]
  days: SpanDay[]
  /** Week view only (Month shows per-day totals). */
  items: SpanItem[]
  cutoffMin: number
  gridStart: number
  gridEnd: number
  totals: { bookings: number; revenue: string; occupancy: number | null }
  ownOnly: boolean
  canManage: boolean
  calendarBase: string
}
