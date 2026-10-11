'use server'
import {
  fixHtmlDesign,
  HTML_IMAGE_ID,
  HTML_IMAGE_URL,
  type HtmlImageAdjust,
  MAX_HTML_IMAGES,
} from '@spa/core'
import { platformDb, tenants, withTenant } from '@spa/db'
import {
  DomainError,
  getStudioTemplate,
  parseTemplateJson,
  sanitizeTemplatePages,
  saveStudioTemplate,
  snapshotSite,
  TEMPLATE_KEY,
  type TemplatePage,
  templateKeyFrom,
  updateStudioTemplate,
} from '@spa/services'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import {
  HTML_DESIGN,
  HTML_DESIGN_PLACEHOLDERS,
  htmlDesignPages,
  MAX_HTML_DESIGN_BYTES,
} from '@/components/site/blocks/html-design'
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

/**
 * Uploads an HTML design as a one-page template, shown on spa sites exactly as built (sandboxed frame,
 * `{{placeholders}}` filled with each spa's live details). With "replace" a template with the same key is
 * overwritten; spas already using it keep their own copy.
 */
export async function uploadHtmlTemplateAction(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  const { user } = await requirePlatformAdmin()
  const parsed = z
    .object({ name: z.string().trim().min(2).max(60), description: optionalText(300) })
    .safeParse(formObject(fd))
  if (!parsed.success) return fromZod(parsed.error)
  const file = fd.get('file')
  if (!(file instanceof File) || !file.size)
    return fail('Choose an HTML file', { file: 'Choose an .html file' })
  if (!/\.html?$/i.test(file.name) && file.type !== 'text/html')
    return fail('Only .html files can be uploaded', { file: 'Choose an .html file' })
  const key = templateKeyFrom(parsed.data.name)
  const raw = await file.text()
  if (!/<(?:!doctype|html|head|body|div|section|main)\b/i.test(raw))
    return fail('This file does not look like an HTML page', { file: 'Choose an .html file' })
  const images = parseImages(fd.get('images'))
  if (!images) return fail('The image adjustments could not be read. Reopen the file and try again.')
  const { html, fixes } = fixHtmlDesign(raw)
  const pages = htmlDesignPages(key, html, images)
  // Checked as page JSON (quotes and newlines escaped), the shape it is saved and edited in.
  if (file.size > MAX_HTML_DESIGN_BYTES || JSON.stringify(pages[0]!.data).length > MAX_HTML_DESIGN_BYTES) {
    const error = `The file is ${Math.ceil(file.size / 1024)} KB; the limit is about ${MAX_HTML_DESIGN_BYTES / 1024} KB. Link fonts and images by URL instead of embedding them.`
    return fail(error, { file: error })
  }
  const replace = fd.get('replace') === 'on'
  if (isTemplateKey(key) && !replace) {
    const error = `"${key}" is the built-in ${TEMPLATES[key].name}. Pick another name, or tick "Replace a template with the same key" to override it.`
    return fail(error, { name: error })
  }
  const active = fd.get('active') === 'on'
  const used = HTML_DESIGN_PLACEHOLDERS.filter((p) => html.includes(`{{${p}}}`))
  try {
    await saveStudioTemplate(
      platformDb(),
      {
        key,
        name: parsed.data.name,
        description: parsed.data.description,
        theme: {},
        pages,
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
    action: 'platform.site_template.html_uploaded',
    entity: 'site_template',
    entityId: key,
    data: { bytes: file.size, placeholders: used, fixes, adjustedImages: images.length },
  })
  revalidate()
  const fixed = fixes.length
    ? ` Fixed for phones: ${fixes.map((f) => (f === 'viewport' ? 'added the mobile viewport' : 'fluid image widths')).join(', ')}.`
    : ''
  return ok(
    `${active ? `${parsed.data.name} uploaded` : `${parsed.data.name} uploaded — hidden from spas until you switch it on`}${fixed}`,
  )
}

const ImageAdjust = z.object({
  id: z.string().regex(HTML_IMAGE_ID),
  src: z.string().max(300),
  fit: z.enum(['cover', 'contain']).optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
  x: z.number().min(0).max(100).optional(),
  y: z.number().min(0).max(100).optional(),
  replace: z.string().regex(HTML_IMAGE_URL).optional(),
})

/** The adjuster's hidden `images` field (JSON); null when it isn't valid. Missing = no adjustments. */
function parseImages(v: FormDataEntryValue | null): HtmlImageAdjust[] | null {
  if (v == null || v === '') return []
  if (typeof v !== 'string' || v.length > 200_000) return null
  try {
    const r = z.array(ImageAdjust).max(MAX_HTML_IMAGES).safeParse(JSON.parse(v))
    return r.success ? r.data : null
  } catch {
    return null
  }
}

/** "Adjust images" on an uploaded HTML template: saves focal points / fill-fit / replacements next to the file. */
export async function saveHtmlImagesAction(
  id: string,
  _p: ActionResult,
  fd: FormData,
): Promise<ActionResult> {
  const { user } = await requirePlatformAdmin()
  const images = parseImages(fd.get('images'))
  if (!images) return fail('The image adjustments could not be read. Reopen the panel and try again.')
  const db = platformDb()
  const row = await getStudioTemplate(db, { id: z.string().uuid().parse(id) })
  const page = (row?.pages as TemplatePage[] | undefined)?.[0]
  const node = (page?.data.content as { type: string; props: Record<string, unknown> }[] | undefined)?.[0]
  if (!row || !page || node?.type !== HTML_DESIGN) return fail('This is not an uploaded HTML design')
  const pages: TemplatePage[] = [
    { ...page, data: { ...page.data, content: [{ ...node, props: { ...node.props, images } }] } },
    ...(row.pages as TemplatePage[]).slice(1),
  ]
  if (JSON.stringify(pages[0]!.data).length > MAX_HTML_DESIGN_BYTES)
    return fail('Too many adjustments for this design (page size limit)')
  try {
    await updateStudioTemplate(db, row.id, { pages })
  } catch (e) {
    return domainFail(e)
  }
  await audit({
    actorUserId: user.id,
    action: 'platform.site_template.html_images',
    entity: 'site_template',
    entityId: row.key,
    data: { adjustedImages: images.length },
  })
  revalidate()
  return ok(`Images saved for ${row.name}`)
}
