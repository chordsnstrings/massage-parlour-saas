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
import { isTemplateKey, TEMPLATES } from '@/components/site/templates'
import { type ActionResult, fail, formObject, fromZod, ok } from '@/lib/action'
import { requirePlatformAdmin } from '@/server/access'
import { audit } from '@/server/audit'
import { templateProblem, templateSamples } from './data'

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
  if (isTemplateKey(key))
    return fail(`"${key}" is the built-in ${TEMPLATES[key].name}. Choose another key.`, {
      key: 'Choose another key',
    })
  try {
    // The spa's pages are tenant data: read them inside its own tenant transaction.
    const snap = await withTenant(tenant.id, (tx) => snapshotSite(tx, tenant.id))
    const pages = sanitizeTemplatePages(snap.pages, {
      key,
      tenantName: tenant.name,
      samples: templateSamples(),
    })
    const problem = templateProblem(pages, { requireProps: false })
    if (problem) return fail(`This site can't be used as a template yet. ${problem}`)
    await saveStudioTemplate(platformDb(), {
      key,
      name: d.name,
      description: d.description,
      theme: snap.theme,
      pages,
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
  return ok(d.active ? `${d.name} saved` : `${d.name} saved — hidden from spas until you switch it on`)
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
  const problem = templateProblem(t.pages, { requireProps: true })
  if (problem) return fail(problem, { file: problem })
  const replace = fd.get('replace') === 'on'
  // A studio row with a built-in key replaces that built-in for every spa: only when explicitly asked.
  if (isTemplateKey(t.key) && !replace) {
    const error = `"${t.key}" is the built-in ${TEMPLATES[t.key].name}. Tick "Replace a template with the same key" to override it, or change the key in the file.`
    return fail(error, { file: error })
  }
  const active = fd.get('active') === 'on'
  try {
    await saveStudioTemplate(
      platformDb(),
      {
        key: t.key,
        name: t.name,
        description: t.description,
        theme: t.theme,
        pages: t.pages,
        active,
        createdBy: user.id,
      },
      { replace },
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
  return ok(active ? `${t.name} imported` : `${t.name} imported — hidden from spas until you switch it on`)
}
