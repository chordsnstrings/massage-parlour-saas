'use server'
import { businessDocuments, staff, staffDocuments, storedFiles, type Tx, withTenant } from '@spa/db'
import { BUSINESS_DOCUMENT_TYPES, deleteFile, fileIdOf, fileLink, STAFF_DOCUMENT_TYPES } from '@spa/services'
import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { type ActionResult, fail, formObject, fromZod, ok } from '@/lib/action'
import { guard } from '@/server/access'
import { audit } from '@/server/audit'

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date')
  .optional()
  .or(z.literal('').transform(() => undefined))
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || null)

const STAFF_TYPES = STAFF_DOCUMENT_TYPES.map((t) => t.key) as string[]
const BUSINESS_TYPES = BUSINESS_DOCUMENT_TYPES.map((t) => t.key) as string[]

const documentSchema = z
  .object({
    id: z
      .uuid()
      .optional()
      .or(z.literal('').transform(() => undefined)),
    scope: z.enum(['staff', 'business']),
    staffId: z
      .uuid()
      .optional()
      .or(z.literal('').transform(() => undefined)),
    type: z.string().trim().min(1, 'Choose the document type').max(80),
    number: text(60),
    issuedOn: date,
    expiresOn: date,
    notes: text(500),
    fileId: z
      .uuid()
      .optional()
      .or(z.literal('').transform(() => undefined)),
    removeFile: z.preprocess((v) => v === 'on', z.boolean()),
  })
  .superRefine((d, issue) => {
    if (d.scope === 'staff' && !d.staffId)
      issue.addIssue({ code: 'custom', path: ['staffId'], message: 'Choose the staff member' })
    const known = d.scope === 'staff' ? STAFF_TYPES : BUSINESS_TYPES
    // Older rows may carry a free-text type; new ones pick from the list.
    if (!d.id && !known.includes(d.type))
      issue.addIssue({ code: 'custom', path: ['type'], message: 'Choose the document type' })
    if (d.issuedOn && d.expiresOn && d.expiresOn < d.issuedOn)
      issue.addIssue({ code: 'custom', path: ['expiresOn'], message: 'Expiry is before the issue date' })
  })

/** The uploaded scan must be this tenant's (RLS) and uploaded as a document. */
async function ownedScan(tx: Tx, fileId: string) {
  const [file] = await tx
    .select({ id: storedFiles.id, purpose: storedFiles.purpose })
    .from(storedFiles)
    .where(eq(storedFiles.id, fileId))
  return file && (file.purpose === 'staff_document' || file.purpose === 'business_document') ? file : null
}

export async function saveDocumentAction(
  slug: string,
  _p: ActionResult,
  fd: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'staff.manage')
  if (error) return fail(error)
  const parsed = documentSchema.safeParse(formObject(fd))
  if (!parsed.success) return fromZod(parsed.error)
  const d = parsed.data
  const tenantId = ctx.tenant.id

  const result = await withTenant(tenantId, async (tx) => {
    if (d.scope === 'staff') {
      const [person] = await tx.select({ id: staff.id }).from(staff).where(eq(staff.id, d.staffId!))
      if (!person) return { error: 'That staff member no longer exists.' }
    }
    if (d.fileId && !(await ownedScan(tx, d.fileId))) return { error: 'Upload the file again.' }

    const table = d.scope === 'staff' ? staffDocuments : businessDocuments
    const [existing] = d.id
      ? await tx.select({ id: table.id, fileUrl: table.fileUrl }).from(table).where(eq(table.id, d.id))
      : [undefined]
    if (d.id && !existing) return { error: 'That document was removed.' }

    const fileUrl = d.fileId ? fileLink(d.fileId) : d.removeFile ? null : (existing?.fileUrl ?? null)
    const values = {
      type: d.type,
      number: d.number,
      issuedOn: d.issuedOn ?? null,
      expiresOn: d.expiresOn ?? null,
      notes: d.notes,
      fileUrl,
    }
    let id = d.id
    if (d.scope === 'staff') {
      if (id)
        await tx
          .update(staffDocuments)
          .set({ ...values, staffId: d.staffId! })
          .where(eq(staffDocuments.id, id))
      else
        id = (
          await tx
            .insert(staffDocuments)
            .values({ ...values, tenantId, staffId: d.staffId! })
            .returning({ id: staffDocuments.id })
        )[0]!.id
    } else if (id) await tx.update(businessDocuments).set(values).where(eq(businessDocuments.id, id))
    else
      id = (
        await tx
          .insert(businessDocuments)
          .values({ ...values, tenantId })
          .returning({ id: businessDocuments.id })
      )[0]!.id

    // A replaced or removed scan is deleted with it.
    const oldFile = fileIdOf(existing?.fileUrl)
    if (oldFile && existing?.fileUrl !== fileUrl) await deleteFile(tx, oldFile)
    return { id: id!, created: !d.id }
  })
  if ('error' in result) return fail(result.error ?? 'Something went wrong.')

  await audit({
    tenantId,
    actorUserId: ctx.user.id,
    impersonatorUserId: ctx.impersonating ? ctx.user.id : undefined,
    action: result.created ? 'document.created' : 'document.updated',
    entity: `${d.scope}_document`,
    entityId: result.id,
    data: { type: d.type, expiresOn: d.expiresOn ?? null, staffId: d.staffId ?? null },
  })
  revalidatePath(`/dashboard/${slug}/documents`)
  return ok(result.created ? 'Document added' : 'Document updated')
}

export async function deleteDocumentAction(
  slug: string,
  scope: 'staff' | 'business',
  id: string,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'staff.manage')
  if (error) return fail(error)
  const parsed = z.object({ scope: z.enum(['staff', 'business']), id: z.uuid() }).safeParse({ scope, id })
  if (!parsed.success) return fail('Unknown document')
  const removed = await withTenant(ctx.tenant.id, async (tx) => {
    const table = parsed.data.scope === 'staff' ? staffDocuments : businessDocuments
    const [row] = await tx
      .delete(table)
      .where(and(eq(table.id, parsed.data.id), eq(table.tenantId, ctx.tenant.id)))
      .returning({ type: table.type, fileUrl: table.fileUrl })
    const fileId = fileIdOf(row?.fileUrl)
    if (fileId) await deleteFile(tx, fileId)
    return row
  })
  if (!removed) return fail('That document was already removed.')
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    impersonatorUserId: ctx.impersonating ? ctx.user.id : undefined,
    action: 'document.deleted',
    entity: `${parsed.data.scope}_document`,
    entityId: parsed.data.id,
    data: { type: removed.type },
  })
  revalidatePath(`/dashboard/${slug}/documents`)
  return ok('Document deleted')
}
