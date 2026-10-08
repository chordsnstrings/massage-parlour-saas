'use server'
import type { MessageKey } from '@spa/core/i18n'
import { type IntakeField, intakeTemplates, type Tx, withTenant } from '@spa/db'
import { desc, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { type IntakeTemplateInput, RECOMMENDED_INTAKE } from '@/components/clients/shared'
import { getT } from '@/i18n/server'
import { type ActionResult, fail, formObject, fromZod, ok } from '@/lib/action'
import { guard } from '@/server/access'
import { audit } from '@/server/audit'

const fieldSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{0,39}$/, 'settings.intake.errors.key'),
  label: z.object({
    en: z.string().trim().min(1, 'settings.intake.errors.labelEn').max(300),
    ar: z.string().trim().max(300).optional(),
  }),
  type: z.enum(['text', 'textarea', 'yesno', 'select']),
  options: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  required: z.boolean().optional(),
})

const templateSchema = z.object({
  name: z.string().trim().min(2, 'settings.intake.errors.name').max(120),
  fields: z
    .string()
    .transform((s, c) => {
      try {
        return JSON.parse(s) as unknown
      } catch {
        c.addIssue({ code: 'custom', message: 'settings.intake.errors.invalid' })
        return z.NEVER
      }
    })
    .pipe(
      z
        .array(fieldSchema)
        .min(1, 'settings.intake.errors.min')
        .max(40)
        .superRefine((fields, c) => {
          const seen = new Set<string>()
          for (const f of fields) {
            if (seen.has(f.key))
              c.addIssue({ code: 'custom', message: 'settings.intake.errors.duplicate', params: { key: f.key } })
            seen.add(f.key)
            if (f.type === 'select' && !f.options?.length)
              c.addIssue({
                code: 'custom',
                message: 'settings.intake.errors.options',
                params: { label: f.label.en },
              })
          }
        }),
    ),
  waiverEn: z.string().trim().min(20, 'settings.intake.errors.waiver').max(6000),
  waiverAr: z.string().trim().max(6000).optional(),
})

/**
 * Saving creates a new version row and retires the previous one, so every signed
 * submission keeps pointing at the exact questions it answered.
 */
async function saveVersion(tx: Tx, tenantId: string, input: IntakeTemplateInput) {
  const [current] = await tx
    .select({ id: intakeTemplates.id, version: intakeTemplates.version })
    .from(intakeTemplates)
    .orderBy(desc(intakeTemplates.version))
    .limit(1)
  await tx.update(intakeTemplates).set({ active: false }).where(eq(intakeTemplates.active, true))
  const version = (current?.version ?? 0) + 1
  const fields: IntakeField[] = input.fields.map((f) => ({
    key: f.key,
    label: f.label.ar ? { en: f.label.en, ar: f.label.ar } : { en: f.label.en },
    type: f.type,
    ...(f.type === 'select' ? { options: f.options ?? [] } : {}),
    ...(f.required ? { required: true } : {}),
  }))
  const [row] = await tx
    .insert(intakeTemplates)
    .values({ tenantId, name: input.name, fields, waiver: input.waiver, version, active: true })
    .returning({ id: intakeTemplates.id })
  return { id: row!.id, version }
}

export async function saveIntakeTemplateAction(
  slug: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'settings.manage')
  if (error) return fail(error)
  const parsed = templateSchema.safeParse(formObject(formData))
  const t = await getT()
  if (!parsed.success) {
    const fieldIssue = parsed.error.issues.find((i) => i.path[0] === 'fields')
    if (fieldIssue) {
      // Question-list errors may carry the offending key/label: the field error is rendered here, server side.
      const params = (fieldIssue as { params?: Record<string, string> }).params
      const ref = { key: fieldIssue.message as MessageKey, params }
      return t.has(fieldIssue.message) ? fail(ref, { fields: t(ref.key, params) }) : fail(fieldIssue.message)
    }
    return fromZod(parsed.error)
  }
  const { name, fields, waiverEn, waiverAr } = parsed.data
  const saved = await withTenant(ctx.tenant.id, (tx) =>
    saveVersion(tx, ctx.tenant.id, {
      name,
      fields,
      waiver: waiverAr ? { en: waiverEn, ar: waiverAr } : { en: waiverEn },
    }),
  )
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: 'intake_template.saved',
    entity: 'intake_template',
    entityId: saved.id,
    data: { version: saved.version },
  })
  revalidatePath(`/dashboard/${slug}/settings/intake`)
  revalidatePath(`/dashboard/${slug}/clients`, 'layout')
  return ok({ key: 'settings.intake.saved', params: { version: saved.version } })
}

export async function applyRecommendedIntakeAction(slug: string): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'settings.manage')
  if (error) return fail(error)
  const saved = await withTenant(ctx.tenant.id, (tx) => saveVersion(tx, ctx.tenant.id, RECOMMENDED_INTAKE))
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: 'intake_template.saved',
    entity: 'intake_template',
    entityId: saved.id,
    data: { version: saved.version, recommended: true },
  })
  revalidatePath(`/dashboard/${slug}/settings/intake`)
  revalidatePath(`/dashboard/${slug}/clients`, 'layout')
  return ok({ key: 'settings.intake.recommendedSaved', params: { version: saved.version } })
}
