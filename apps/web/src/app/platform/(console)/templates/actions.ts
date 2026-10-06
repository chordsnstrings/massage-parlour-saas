'use server'
import { platformDb, tenants, withTenant } from '@spa/db'
import {
  DomainError,
  parseTemplateJson,
  sanitizeTemplatePages,
  saveStudioTemplate,
  snapshotSite,
  TEMPLATE_KEY,
  templateKeyFrom,
  updateStudioTemplate,
} from '@spa/services'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { type ActionResult, fail, formObject, fromZod, ok } from '@/lib/action'
import { requirePlatformAdmin } from '@/server/access'
import { audit } from '@/server/audit'

const revalidate = () => revalidatePath('/platform/templates', 'layout')
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || null)
const bool = z.preprocess((v) => v === 'on' || v === 'true', z.boolean())

function domainFail(e: unknown): ActionResult {
  if (e instanceof DomainError) return fail(e.message)
  throw e
}

/** Template studio: copies a spa's theme + live pages into a reusable, sanitised template. */
export async function saveSiteAsTemplateAction(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  const { user } = await requirePlatformAdmin()
  const parsed = z
    .object({
      tenantId: z.uuid('Choose a spa'),
      name: z.string().trim().min(2, 'Give the template a name').max(80),
      key: optionalText(40).refine(
        (k) => !k || TEMPLATE_KEY.test(k),
        'Lowercase letters, numbers and dashes',
      ),
      description: optionalText(300),
      active: bool,
    })
    .safeParse(formObject(fd))
  if (!parsed.success) return fromZod(parsed.error)
  const d = parsed.data
  const [tenant] = await platformDb()
    .select({ id: tenants.id, name: tenants.name })
    .from(tenants)
    .where(eq(tenants.id, d.tenantId))
  if (!tenant) return fail('Choose a spa', { tenantId: 'Choose a spa' })
  const key = d.key ?? templateKeyFrom(d.name)
  try {
    // The spa's pages are tenant data: read them inside its own tenant transaction.
    const snap = await withTenant(tenant.id, (tx) => snapshotSite(tx, tenant.id))
    await saveStudioTemplate(platformDb(), {
      key,
      name: d.name,
      description: d.description,
      theme: snap.theme,
      pages: sanitizeTemplatePages(snap.pages, { key, tenantName: tenant.name }),
      active: d.active,
      createdBy: user.id,
    })
  } catch (e) {
    return domainFail(e)
  }
  await audit({
    tenantId: tenant.id,
    actorUserId: user.id,
    action: 'platform.site_template.created_from_site',
    entity: 'site_template',
    entityId: key,
  })
  revalidate()
  return ok(`${d.name} saved`)
}

export async function updateTemplateAction(
  id: string,
  _p: ActionResult,
  fd: FormData,
): Promise<ActionResult> {
  const { user } = await requirePlatformAdmin()
  if (!z.uuid().safeParse(id).success) return fail('Template not found')
  const parsed = z
    .object({
      name: z.string().trim().min(2, 'Give the template a name').max(80),
      description: optionalText(300),
      sort: z.coerce.number().int().min(0).max(999),
      active: bool,
    })
    .safeParse(formObject(fd))
  if (!parsed.success) return fromZod(parsed.error)
  try {
    await updateStudioTemplate(platformDb(), id, parsed.data)
  } catch (e) {
    return domainFail(e)
  }
  await audit({
    actorUserId: user.id,
    action: 'platform.site_template.updated',
    entity: 'site_template',
    entityId: id,
    data: parsed.data,
  })
  revalidate()
  return ok('Template saved')
}

/** Imports an exported template file; with "replace" an existing template with the same key is overwritten. */
export async function importTemplateAction(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  const { user } = await requirePlatformAdmin()
  const file = fd.get('file')
  if (!(file instanceof File) || !file.size)
    return fail('Choose a template file', { file: 'Choose a .json file' })
  const result = parseTemplateJson(await file.text())
  if (!result.ok) return fail(result.error, { file: result.error })
  const t = result.template
  try {
    await saveStudioTemplate(
      platformDb(),
      {
        key: t.key,
        name: t.name,
        description: t.description,
        theme: t.theme,
        pages: t.pages,
        createdBy: user.id,
      },
      { replace: fd.get('replace') === 'on' },
    )
  } catch (e) {
    return domainFail(e)
  }
  await audit({
    actorUserId: user.id,
    action: 'platform.site_template.imported',
    entity: 'site_template',
    entityId: t.key,
  })
  revalidate()
  return ok(`${t.name} imported`)
}
