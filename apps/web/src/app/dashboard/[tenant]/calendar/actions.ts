'use server'
import { businessDateOf, dubaiInstant, holdInterval, overlaps } from '@spa/core'
import {
  bookingItems,
  bookings,
  clients,
  rooms,
  services,
  serviceVariants,
  staff,
  type Tx,
  withTenant,
} from '@spa/db'
import {
  createBooking,
  DomainError,
  enqueueBookingMessage,
  findOrCreateClient,
  loadDay,
  outboxLink,
  rescheduleItem,
  rotationFor,
  setBookingStatus,
  takeTurn,
} from '@spa/services'
import { and, asc, eq, ilike, inArray, or } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { maskPhone, timeToGridMinute } from '@/components/calendar/time'
import { type ActionResult, fail, failDomain, formObject, fromZod, ok } from '@/lib/action'
import { can, guard, type MemberContext } from '@/server/access'
import { audit } from '@/server/audit'
import { allowedBranches } from './data'

const DAY_MS = 24 * 3600_000
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'calendar.errors.pickDate')
const time = z.string().regex(/^\d{2}:\d{2}$/, 'calendar.errors.pickTime')
const optionalId = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined))
  .pipe(z.uuid().optional())

const revalidate = (slug: string) => revalidatePath(`/dashboard/${slug}/calendar`)

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

/** Resolves a branch the member may use; throws DomainError otherwise. */
async function branchFor(tx: Tx, ctx: MemberContext, branchId: string) {
  const branch = (await allowedBranches(tx, ctx)).find((b) => b.id === branchId)
  if (!branch) throw new DomainError('Branch not found', 'not_found')
  return branch
}

/** Start instant from a business date + "HH:MM" (times before the cutoff belong to the next calendar day). */
const startFrom = (d: string, t: string, cutoff: string) =>
  dubaiInstant(d, timeToGridMinute(t, toMin(cutoff)))

async function assertStaffAndRoom(tx: Tx, staffIds: string[], roomId?: string) {
  if (staffIds.length) {
    const found = await tx.select({ id: staff.id }).from(staff).where(inArray(staff.id, staffIds))
    if (found.length !== new Set(staffIds).size) throw new DomainError('Therapist not found', 'not_found')
  }
  if (roomId) {
    const [room] = await tx.select({ id: rooms.id }).from(rooms).where(eq(rooms.id, roomId))
    if (!room) throw new DomainError('Room not found', 'not_found', { key: 'calendar.errors.roomNotFound' })
  }
}

const handle = (e: unknown): ActionResult => {
  if (e instanceof DomainError) return failDomain(e)
  throw e
}

// ---------------------------------------------------------------------------
// Client search (for the new-booking sheet)
// ---------------------------------------------------------------------------

export async function searchClientsAction(slug: string, query: string): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'calendar.manage')
  if (error) return fail(error)
  const parsed = z.string().trim().min(2).max(60).safeParse(query)
  if (!parsed.success) return ok(undefined, { clients: [] })
  const q = parsed.data
  const seePhone = can(ctx, 'clients.phone')
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  const digits = q.replace(/\D/g, '').replace(/^0+/, '')
  const rows = await withTenant(ctx.tenant.id, (tx) =>
    tx
      .select({ id: clients.id, name: clients.name, phone: clients.phoneE164, blocked: clients.blocklisted })
      .from(clients)
      .where(
        seePhone && digits.length >= 3
          ? or(ilike(clients.name, like), ilike(clients.phoneE164, `%${digits}%`))
          : ilike(clients.name, like),
      )
      .orderBy(asc(clients.name))
      .limit(8),
  )
  return ok(undefined, {
    clients: rows.map((r) => ({
      id: r.id,
      name: r.name,
      phone: r.phone ? (seePhone ? `+${r.phone}` : maskPhone(r.phone)) : null,
      blocked: r.blocked,
    })),
  })
}

// ---------------------------------------------------------------------------
// New booking
// ---------------------------------------------------------------------------

const bookingSchema = z
  .object({
    branchId: z.uuid(),
    date,
    time,
    variantId: z.uuid('calendar.errors.chooseService'),
    staffId: optionalId,
    roomId: optionalId,
    clientId: optionalId,
    clientName: z.string().trim().max(120).optional(),
    clientPhone: z.string().trim().max(30).optional(),
    source: z.enum(['phone', 'whatsapp', 'walk_in', 'instagram']),
    notes: z.string().trim().max(1000).optional(),
  })
  .superRefine((v, c) => {
    if (v.clientId) return
    if (!v.clientName)
      c.addIssue({ code: 'custom', path: ['clientName'], message: 'calendar.errors.clientName' })
    if (!v.clientPhone)
      c.addIssue({ code: 'custom', path: ['clientPhone'], message: 'calendar.errors.clientPhone' })
  })

export async function createBookingAction(
  slug: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'calendar.manage')
  if (error) return fail(error)
  const parsed = bookingSchema.safeParse(formObject(formData))
  if (!parsed.success) return fromZod(parsed.error)
  const v = parsed.data
  try {
    const result = await withTenant(ctx.tenant.id, async (tx) => {
      const branch = await branchFor(tx, ctx, v.branchId)
      const start = startFrom(v.date, v.time, branch.businessDayCutoff.slice(0, 5))
      await assertStaffAndRoom(tx, v.staffId ? [v.staffId] : [], v.roomId)
      let clientId = v.clientId
      if (clientId) {
        const [c] = await tx.select({ id: clients.id }).from(clients).where(eq(clients.id, clientId))
        if (!c) throw new DomainError('Client not found', 'not_found', { key: 'calendar.errors.clientNotFound' })
      } else {
        clientId = (
          await findOrCreateClient(tx, ctx.tenant.id, {
            name: v.clientName!,
            phone: v.clientPhone!,
            source: v.source,
          })
        ).id
      }
      const booking = await createBooking(tx, {
        tenantId: ctx.tenant.id,
        branchId: branch.id,
        clientId,
        source: v.source,
        status: 'confirmed',
        notes: v.notes || null,
        createdBy: ctx.user.id,
        items: [
          {
            serviceVariantId: v.variantId,
            start,
            staffIds: v.staffId ? [v.staffId] : undefined,
            roomId: v.roomId,
          },
        ],
      })
      const confirmation = await enqueueBookingMessage(tx, booking.id, 'booking_confirmation')
      if (start.getTime() > Date.now())
        await enqueueBookingMessage(
          tx,
          booking.id,
          'reminder',
          new Date(Math.max(Date.now(), start.getTime() - DAY_MS)),
        )
      return { booking, confirmation }
    })
    await audit({
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: 'booking.created',
      entity: 'booking',
      entityId: result.booking.id,
      data: { ref: result.booking.refCode, source: v.source },
    })
    revalidate(slug)
    return ok({ key: 'calendar.results.created', params: { ref: result.booking.refCode } }, {
      ref: result.booking.refCode,
      whatsapp: result.confirmation ? outboxLink(result.confirmation, 'mobile') : null,
      whatsappWeb: result.confirmation ? outboxLink(result.confirmation, 'web') : null,
    })
  } catch (e) {
    return handle(e)
  }
}

// ---------------------------------------------------------------------------
// Status changes
// ---------------------------------------------------------------------------

const statusSchema = z.object({
  bookingId: z.uuid(),
  status: z.enum(['confirmed', 'checked_in', 'in_service', 'completed', 'no_show', 'cancelled']),
  reason: z.string().trim().max(300).optional(),
})

export async function setStatusAction(
  slug: string,
  input: z.input<typeof statusSchema>,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'calendar.manage')
  if (error) return fail(error)
  const parsed = statusSchema.safeParse(input)
  if (!parsed.success) return fromZod(parsed.error)
  const { bookingId, status, reason } = parsed.data
  if (status === 'cancelled' && !reason)
    return fail('calendar.errors.reason', { reason: 'validation.required' })
  try {
    const updated = await withTenant(ctx.tenant.id, async (tx) => {
      const [b] = await tx
        .select({ branchId: bookings.branchId })
        .from(bookings)
        .where(eq(bookings.id, bookingId))
      if (!b) throw new DomainError('Booking not found', 'not_found')
      await branchFor(tx, ctx, b.branchId)
      return setBookingStatus(tx, bookingId, status, reason)
    })
    await audit({
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: `booking.${status}`,
      entity: 'booking',
      entityId: bookingId,
      data: reason ? { reason } : undefined,
    })
    revalidate(slug)
    return ok({
      key: 'calendar.results.status',
      params: { ref: updated.refCode, status: { key: `enums.bookingStatus.${status}` } },
    })
  } catch (e) {
    return handle(e)
  }
}

// ---------------------------------------------------------------------------
// Reschedule (drag or form)
// ---------------------------------------------------------------------------

const rescheduleSchema = z.object({
  itemId: z.uuid(),
  date,
  time,
  staffIds: z.array(z.uuid()).max(4).optional(),
  roomId: optionalId,
})

export async function rescheduleAction(
  slug: string,
  input: z.input<typeof rescheduleSchema>,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'calendar.manage')
  if (error) return fail(error)
  const parsed = rescheduleSchema.safeParse(input)
  if (!parsed.success) return fromZod(parsed.error)
  const v = parsed.data
  try {
    const ref = await withTenant(ctx.tenant.id, async (tx) => {
      const [row] = await tx
        .select({
          branchId: bookings.branchId,
          ref: bookings.refCode,
          roomId: bookingItems.roomId,
          roomTypes: services.roomTypes,
        })
        .from(bookingItems)
        .innerJoin(bookings, eq(bookings.id, bookingItems.bookingId))
        .leftJoin(serviceVariants, eq(serviceVariants.id, bookingItems.serviceVariantId))
        .leftJoin(services, eq(services.id, serviceVariants.serviceId))
        .where(eq(bookingItems.id, v.itemId))
      if (!row) throw new DomainError('Booking not found', 'not_found')
      const branch = await branchFor(tx, ctx, row.branchId)
      await assertStaffAndRoom(tx, v.staffIds ?? [], v.roomId)
      const start = startFrom(v.date, v.time, branch.businessDayCutoff.slice(0, 5))
      try {
        await rescheduleItem(tx, v.itemId, { start, staffIds: v.staffIds, roomId: v.roomId })
      } catch (e) {
        // Room is "automatic" when not chosen: if the current room clashes, try the branch's other rooms.
        if (!(e instanceof DomainError) || e.code !== 'slot_taken' || v.roomId) throw e
        const types = row.roomTypes ?? []
        const others = (
          await tx
            .select({ id: rooms.id, type: rooms.type })
            .from(rooms)
            .where(and(eq(rooms.branchId, row.branchId), eq(rooms.active, true)))
            .orderBy(asc(rooms.sort), asc(rooms.name))
        ).filter((r) => r.id !== row.roomId && (types.length === 0 || types.includes(r.type)))
        let moved = false
        for (const room of others) {
          try {
            await rescheduleItem(tx, v.itemId, { start, staffIds: v.staffIds, roomId: room.id })
            moved = true
            break
          } catch (retry) {
            if (!(retry instanceof DomainError) || retry.code !== 'slot_taken') throw retry
          }
        }
        if (!moved) throw e
      }
      return row.ref
    })
    await audit({
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: 'booking.rescheduled',
      entity: 'booking_item',
      entityId: v.itemId,
      data: { date: v.date, time: v.time, staffIds: v.staffIds, roomId: v.roomId },
    })
    revalidate(slug)
    return ok({ key: 'calendar.results.moved', params: { ref, time: v.time } })
  } catch (e) {
    return handle(e)
  }
}

export async function rescheduleFormAction(
  slug: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const o = formObject(formData)
  const staffId = typeof o.staffId === 'string' && o.staffId ? o.staffId : undefined
  const keep = typeof o.keepStaff === 'string' && o.keepStaff ? o.keepStaff.split(',') : []
  return rescheduleAction(slug, {
    itemId: String(o.itemId ?? ''),
    date: String(o.date ?? ''),
    time: String(o.time ?? ''),
    staffIds: staffId ? [staffId, ...keep.filter((id) => id !== staffId)] : undefined,
    roomId: typeof o.roomId === 'string' ? o.roomId : undefined,
  })
}

// ---------------------------------------------------------------------------
// Walk-in: starts now, next free therapist in the rotation, room automatic
// ---------------------------------------------------------------------------

const walkInSchema = z.object({
  branchId: z.uuid(),
  variantId: z.uuid('calendar.errors.chooseService'),
  staffId: optionalId,
  clientName: z.string().trim().max(120).optional(),
  clientPhone: z.string().trim().max(30).optional(),
})

export async function walkInAction(
  slug: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'calendar.manage')
  if (error) return fail(error)
  const parsed = walkInSchema.safeParse(formObject(formData))
  if (!parsed.success) return fromZod(parsed.error)
  const v = parsed.data
  try {
    const result = await withTenant(ctx.tenant.id, async (tx) => {
      const branch = await branchFor(tx, ctx, v.branchId)
      const cutoff = branch.businessDayCutoff.slice(0, 5)
      const start = new Date(Math.round(Date.now() / 300_000) * 300_000)
      const businessDate = businessDateOf(start, cutoff)
      const [svc] = await tx
        .select({ variant: serviceVariants, service: services })
        .from(serviceVariants)
        .innerJoin(services, eq(services.id, serviceVariants.serviceId))
        .where(eq(serviceVariants.id, v.variantId))
      if (!svc) throw new DomainError('Service not found', 'not_found')
      const hold = holdInterval(
        start,
        svc.variant.durationMin,
        svc.service.bufferBeforeMin,
        svc.service.bufferAfterMin,
      )
      const day = await loadDay(tx, branch.id, businessDate)
      const free = (s: (typeof day.staff)[number]) =>
        s.skills.includes(svc.service.id) && !s.busy.some((b) => overlaps(b, hold))
      const onShift = (s: (typeof day.staff)[number]) =>
        s.shifts.some((sh) => sh.start <= start && start < sh.end)
      const rotation = await rotationFor(tx, ctx.tenant.id, branch.id, businessDate)
      let therapist: (typeof day.staff)[number] | undefined
      if (v.staffId) {
        therapist = day.staff.find((s) => s.id === v.staffId)
        if (!therapist) throw new DomainError('Therapist not found', 'not_found')
        if (!free(therapist)) throw new DomainError(`${therapist.name} is not free right now`, 'slot_taken', {
            key: 'calendar.errors.notFree',
            params: { name: therapist.name },
          })
      } else {
        therapist =
          rotation
            .filter((e) => e.status !== 'break' && e.status !== 'off')
            .map((e) => day.staff.find((s) => s.id === e.staffId))
            .find((s) => s !== undefined && free(s)) ??
          day.staff.find((s) => onShift(s) && free(s)) ??
          day.staff.find(free)
      }
      if (!therapist) throw new DomainError('No therapist is free for this service right now', 'no_staff', {
          key: 'calendar.errors.noneFree',
        })
      const client =
        v.clientPhone && v.clientPhone.length > 0
          ? await findOrCreateClient(tx, ctx.tenant.id, {
              name: v.clientName || 'Walk-in client',
              phone: v.clientPhone,
              source: 'walk_in',
            })
          : null
      const booking = await createBooking(tx, {
        tenantId: ctx.tenant.id,
        branchId: branch.id,
        clientId: client?.id ?? null,
        source: 'walk_in',
        status: 'checked_in',
        notes: !client && v.clientName ? `Walk-in: ${v.clientName}` : null,
        createdBy: ctx.user.id,
        allowOffShift: true,
        items: [{ serviceVariantId: v.variantId, start, staffIds: [therapist.id] }],
      })
      await takeTurn(tx, branch.id, businessDate, therapist.id)
      return { booking, therapist: therapist.name }
    })
    await audit({
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: 'booking.walk_in',
      entity: 'booking',
      entityId: result.booking.id,
      data: { ref: result.booking.refCode, therapist: result.therapist },
    })
    revalidate(slug)
    return ok(
      { key: 'calendar.walkIns.started', params: { name: result.therapist } },
      { ref: result.booking.refCode },
    )
  } catch (e) {
    return handle(e)
  }
}
