'use server'
import { toUaeE164 } from '@spa/core'
import {
  bookings,
  clients,
  intakeSubmissions,
  intakeTemplates,
  staff,
  treatmentNotes,
  withTenant,
} from '@spa/db'
import { DomainError, eraseClient, pgCode } from '@spa/services'
import { and, desc, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { z } from 'zod'
import { isSignaturePath, parseTags } from '@/components/clients/shared'
import { type ActionResult, fail, failDomain, formObject, fromZod, ok } from '@/lib/action'
import { can, guard } from '@/server/access'
import { audit } from '@/server/audit'
import { ownStaffId } from '../calendar/data'

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || null)
const optionalId = z
  .union([z.uuid(), z.literal('')])
  .optional()
  .transform((v) => v || null)
const phoneField = z
  .string()
  .trim()
  .max(30)
  .optional()
  .transform((v, c) => {
    if (!v) return null
    const e164 = toUaeE164(v)
    if (!e164) {
      c.addIssue({ code: 'custom', message: 'clients.error.phone' })
      return z.NEVER
    }
    return e164
  })
const birthday = z
  .union([z.iso.date('clients.error.date'), z.literal('')])
  .optional()
  .transform((v) => v || null)

const detailsSchema = z.object({
  name: z.string().trim().min(2, 'clients.error.name').max(120),
  phone: phoneField,
  email: z
    .union([z.email('validation.email'), z.literal('')])
    .optional()
    .transform((v) => v?.toLowerCase() || null),
  gender: z
    .enum(['female', 'male', 'other', ''])
    .optional()
    .transform((v) => v || null),
  language: z.enum(['en', 'ar']).default('en'),
  birthday,
  nationality: optional(60),
  tags: z
    .string()
    .max(500)
    .optional()
    .transform((v) => parseTags(v)),
  notes: optional(4000),
})

const dupPhone = () => fail('clients.result.dupPhone', { phone: 'clients.error.dupPhone' })
const clientsPath = (slug: string) => `/dashboard/${slug}/clients`

export async function createClientAction(
  slug: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'clients.manage')
  if (error) return fail(error)
  const parsed = detailsSchema.safeParse(formObject(formData))
  if (!parsed.success) return fromZod(parsed.error)
  const { phone, ...rest } = parsed.data
  try {
    const [row] = await withTenant(ctx.tenant.id, (tx) =>
      tx
        .insert(clients)
        .values({ tenantId: ctx.tenant.id, ...rest, phoneE164: phone, source: 'manual' })
        .returning({ id: clients.id }),
    )
    await audit({
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: 'client.created',
      entity: 'client',
      entityId: row!.id,
    })
    revalidatePath(clientsPath(slug))
    return ok('clients.result.added', { id: row!.id })
  } catch (e) {
    if (pgCode(e) === '23505') return dupPhone()
    throw e
  }
}

export async function updateClientAction(
  slug: string,
  clientId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'clients.manage')
  if (error) return fail(error)
  const parsed = detailsSchema.safeParse(formObject(formData))
  if (!parsed.success) return fromZod(parsed.error)
  const { phone, ...rest } = parsed.data
  // Members who can't see numbers can't change them either (the field isn't shown to them).
  const set = can(ctx, 'clients.phone') ? { ...rest, phoneE164: phone } : rest
  try {
    const [row] = await withTenant(ctx.tenant.id, (tx) =>
      tx
        .update(clients)
        .set({ ...set, updatedAt: new Date() })
        .where(eq(clients.id, clientId))
        .returning({ id: clients.id }),
    )
    if (!row) return fail('clients.result.notFound')
  } catch (e) {
    if (pgCode(e) === '23505') return dupPhone()
    throw e
  }
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: 'client.updated',
    entity: 'client',
    entityId: clientId,
  })
  revalidatePath(clientsPath(slug))
  revalidatePath(`${clientsPath(slug)}/${clientId}`)
  return ok('clients.result.updated')
}

const prefsSchema = z.object({
  pressure: optional(30),
  oils: optional(200),
  allergies: optional(300),
  focus: optional(300),
  therapistGender: z
    .enum(['female', 'male', 'any', ''])
    .optional()
    .transform((v) => (v && v !== 'any' ? v : null)),
  preferredStaffId: optionalId,
})

export async function updatePreferencesAction(
  slug: string,
  clientId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'clients.manage')
  if (error) return fail(error)
  const parsed = prefsSchema.safeParse(formObject(formData))
  if (!parsed.success) return fromZod(parsed.error)
  const preferences = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== null)) as Record<
    string,
    string
  >
  const result = await withTenant(ctx.tenant.id, async (tx) => {
    if (preferences.preferredStaffId) {
      const [s] = await tx
        .select({ id: staff.id })
        .from(staff)
        .where(eq(staff.id, preferences.preferredStaffId))
      if (!s) return 'clients.result.therapistNotFound'
    }
    const [row] = await tx
      .update(clients)
      .set({ preferences, updatedAt: new Date() })
      .where(eq(clients.id, clientId))
      .returning({ id: clients.id })
    return row ? null : 'clients.result.notFound'
  })
  if (result) return fail(result)
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: 'client.preferences_updated',
    entity: 'client',
    entityId: clientId,
  })
  revalidatePath(`${clientsPath(slug)}/${clientId}`)
  return ok('clients.result.prefsSaved')
}

const blocklistSchema = z
  .object({ blocklisted: z.enum(['true', 'false']), reason: optional(500) })
  .superRefine((v, c) => {
    if (v.blocklisted === 'true' && !v.reason)
      c.addIssue({ code: 'custom', path: ['reason'], message: 'clients.error.reason' })
  })

export async function setBlocklistAction(
  slug: string,
  clientId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'clients.manage')
  if (error) return fail(error)
  const parsed = blocklistSchema.safeParse(formObject(formData))
  if (!parsed.success) return fromZod(parsed.error)
  const blocklisted = parsed.data.blocklisted === 'true'
  const [row] = await withTenant(ctx.tenant.id, (tx) =>
    tx
      .update(clients)
      .set({ blocklisted, blocklistReason: blocklisted ? parsed.data.reason : null, updatedAt: new Date() })
      .where(eq(clients.id, clientId))
      .returning({ id: clients.id }),
  )
  if (!row) return fail('clients.result.notFound')
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: blocklisted ? 'client.blocklisted' : 'client.unblocked',
    entity: 'client',
    entityId: clientId,
    data: blocklisted ? { reason: parsed.data.reason } : undefined,
  })
  revalidatePath(clientsPath(slug))
  revalidatePath(`${clientsPath(slug)}/${clientId}`)
  return ok(blocklisted ? 'clients.result.blocklisted' : 'clients.result.unblocked')
}

const noteSchema = z.object({
  text: z.string().trim().min(2, 'clients.error.note').max(4000),
  bookingId: optionalId,
})

/** Treatment notes: any member who can see the calendar (therapists included) may add one. */
export async function addTreatmentNoteAction(
  slug: string,
  clientId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'calendar.view')
  if (error) return fail(error)
  const parsed = noteSchema.safeParse(formObject(formData))
  if (!parsed.success) return fromZod(parsed.error)
  const result = await withTenant(ctx.tenant.id, async (tx) => {
    const [client] = await tx.select({ id: clients.id }).from(clients).where(eq(clients.id, clientId))
    if (!client) return { error: 'clients.result.notFound' as const }
    if (parsed.data.bookingId) {
      const [b] = await tx
        .select({ id: bookings.id })
        .from(bookings)
        .where(and(eq(bookings.id, parsed.data.bookingId), eq(bookings.clientId, clientId)))
      if (!b) return { error: 'clients.result.visitNotFound' as const }
    }
    const [note] = await tx
      .insert(treatmentNotes)
      .values({
        tenantId: ctx.tenant.id,
        clientId,
        bookingId: parsed.data.bookingId,
        staffId: await ownStaffId(tx, ctx),
        text: parsed.data.text,
        createdBy: ctx.user.id,
      })
      .returning({ id: treatmentNotes.id })
    return { error: null, id: note!.id }
  })
  if (result.error) return fail(result.error)
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: 'client.treatment_note_added',
    entity: 'treatment_note',
    entityId: result.id,
  })
  revalidatePath(`${clientsPath(slug)}/${clientId}`)
  return ok('clients.result.noteAdded')
}

/** Saves a signed intake against the active template (answers, waiver snapshot, signature, version, ip). */
export async function submitIntakeAction(
  slug: string,
  clientId: string,
  lang: 'en' | 'ar',
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'clients.manage')
  if (error) return fail(error)
  const raw = formObject(formData)
  const signature = typeof raw.signature === 'string' ? raw.signature.trim() : ''
  const agreed = raw.agree === 'on'
  const h = await headers()
  const ip = h.get('cf-connecting-ip') ?? h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const ar = lang === 'ar'
  try {
    const id = await withTenant(ctx.tenant.id, async (tx) => {
      const [client] = await tx.select({ id: clients.id }).from(clients).where(eq(clients.id, clientId))
      if (!client) throw new DomainError('Client not found.', 'not_found')
      const [template] = await tx
        .select()
        .from(intakeTemplates)
        .where(eq(intakeTemplates.active, true))
        .orderBy(desc(intakeTemplates.version))
        .limit(1)
      if (!template) throw new DomainError('Set up an intake form in Settings first.', 'not_found')
      const answers: Record<string, string> = {}
      const fieldErrors: Record<string, string> = {}
      for (const f of template.fields) {
        const v =
          typeof raw[`q_${f.key}`] === 'string' ? (raw[`q_${f.key}`] as string).trim().slice(0, 2000) : ''
        if (f.type === 'yesno' && v && v !== 'yes' && v !== 'no')
          fieldErrors[`q_${f.key}`] = 'Choose yes or no'
        else if (f.type === 'select' && v && !(f.options ?? []).includes(v))
          fieldErrors[`q_${f.key}`] = 'Choose an option'
        else if (f.required && !v) fieldErrors[`q_${f.key}`] = ar ? 'هذا الحقل مطلوب' : 'Required'
        if (v) answers[f.key] = v
      }
      if (!agreed) fieldErrors.agree = ar ? 'يرجى الموافقة على الإقرار' : 'Please accept the waiver'
      if (!isSignaturePath(signature)) fieldErrors.signature = ar ? 'يرجى التوقيع' : 'Please sign in the box'
      if (Object.keys(fieldErrors).length) throw new FieldErrors(fieldErrors)
      const waiverText = (ar ? template.waiver.ar : undefined) || template.waiver.en
      const [row] = await tx
        .insert(intakeSubmissions)
        .values({
          tenantId: ctx.tenant.id,
          clientId,
          templateId: template.id,
          templateVersion: template.version,
          answers: { ...answers, _lang: lang },
          waiverText,
          signature,
          ip,
        })
        .returning({ id: intakeSubmissions.id })
      return row!.id
    })
    await audit({
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: 'client.intake_signed',
      entity: 'intake_submission',
      entityId: id,
    })
    revalidatePath(`${clientsPath(slug)}/${clientId}`)
    return ok(ar ? 'تم الحفظ' : 'Intake signed', { id })
  } catch (e) {
    if (e instanceof FieldErrors)
      return fail(ar ? 'يرجى مراجعة الحقول المحددة' : 'Please check the highlighted fields.', e.fields)
    if (e instanceof DomainError) return failDomain(e)
    throw e
  }
}

/**
 * G12: erase one client's personal data on request (owner only; a super-admin acting on the spa may too).
 * Sales, ledger and bookings stay for accounting, pointing at the anonymised client (services/data-deletion.ts).
 */
export async function eraseClientAction(
  slug: string,
  clientId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'clients.manage')
  if (error) return fail(error)
  if (ctx.member?.roleKey !== 'owner' && !ctx.impersonating) return fail('errors.forbidden')
  if (!z.uuid().safeParse(clientId).success) return fail('clients.result.notFound')
  if (formData.get('confirm') !== 'on')
    return fail('errors.checkFields', { confirm: 'clients.erase.confirmRequired' })
  try {
    const { removed, alreadyErased } = await withTenant(ctx.tenant.id, (tx) => eraseClient(tx, clientId))
    await audit({
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      impersonatorUserId: ctx.impersonating ? ctx.user.id : undefined,
      action: 'client.erased',
      entity: 'client',
      entityId: clientId,
      data: { removed, alreadyErased },
    })
  } catch (e) {
    if (e instanceof DomainError) return failDomain(e)
    throw e
  }
  revalidatePath(clientsPath(slug))
  revalidatePath(`${clientsPath(slug)}/${clientId}`)
  return ok('clients.result.erased')
}

class FieldErrors extends Error {
  constructor(readonly fields: Record<string, string>) {
    super('invalid')
  }
}
