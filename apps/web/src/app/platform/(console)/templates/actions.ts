'use server'
import { htmlDesignBakedFixes } from '@spa/core'
import { platformDb, tenants, withTenant } from '@spa/db'
import {
  DomainError,
  getStudioTemplate,
  htmlDesignSource,
  SITE_EDIT_MAX_PAGE_BYTES,
  sanitizeTemplatePages,
  saveStudioTemplate,
  snapshotSite,
  spaDesignsIntoTemplate,
  TEMPLATE_KEY,
  type TemplatePage,
  templateKeyFrom,
  updateStudioTemplate,
} from '@spa/services'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { HTML_DESIGN } from '@/components/site/html-design-values'
import { isTemplateKey, TEMPLATES } from '@/components/site/templates'
import { type ActionResult, fail, formObject, fromZod, ok } from '@/lib/action'
import { requirePlatformAdmin } from '@/server/access'
import { audit } from '@/server/audit'
import { spaDocReader, templateDocReader } from '@/server/html-design-files'
import { templateProblem, templateSamples } from './data'
import { parseImages } from './parse-images'

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
    // The spa's pages are tenant data: read them inside its own tenant transaction. R24: its HTML designs are copied
    // into template files (a template never depends on a spa's files).
    const snap = await withTenant(tenant.id, async (tx) => {
      const s = await snapshotSite(tx, tenant.id)
      const read = spaDocReader(tx, tenant.id)
      const pages = []
      for (const p of s.pages)
        pages.push({
          ...p,
          data: await spaDesignsIntoTemplate(p.data, { read, db: platformDb(), userId: user.id }),
        })
      return { ...s, pages }
    })
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
  if (JSON.stringify(pages[0]!.data).length > SITE_EDIT_MAX_PAGE_BYTES)
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

/**
 * R24 "Phone fixes" switch of an uploaded HTML design: off = shown exactly like the file (the default for new
 * uploads); on = the platform adds a phone viewport and keeps images and wide elements inside phone screens. Spas
 * already using the template keep their copy until it is applied again.
 */
export async function setHtmlPhoneFixesAction(id: string, on: boolean): Promise<ActionResult> {
  const { user } = await requirePlatformAdmin()
  if (!z.uuid().safeParse(id).success) return fail('Template not found')
  const db = platformDb()
  const row = await getStudioTemplate(db, { id })
  const page = (row?.pages as TemplatePage[] | undefined)?.[0]
  const node = (page?.data.content as { type: string; props: Record<string, unknown> }[] | undefined)?.[0]
  if (!row || !page || node?.type !== HTML_DESIGN) return fail('This is not an uploaded HTML design')
  const legacy = htmlDesignBakedFixes(node.props)
  const pages: TemplatePage[] = [
    {
      ...page,
      data: {
        ...page.data,
        content: [
          { ...node, props: { ...node.props, phoneFixes: on, ...(legacy ? { bakedFixes: true } : {}) } },
        ],
      },
    },
    ...(row.pages as TemplatePage[]).slice(1),
  ]
  try {
    await updateStudioTemplate(db, row.id, { pages })
  } catch (e) {
    return domainFail(e)
  }
  await audit({
    actorUserId: user.id,
    action: 'platform.site_template.html_phone_fixes',
    entity: 'site_template',
    entityId: row.key,
    data: { phoneFixes: on },
  })
  revalidate()
  return ok(
    `Phone fixes ${on ? 'on' : 'off'} for ${row.name}. Spas already using it keep their copy — re-apply the template to update them.${
      !on && legacy
        ? ' This design was uploaded before 11 Oct 2026 with the old phone fixes saved into it: upload the original file again (tick “Replace”) to show it exactly.'
        : ''
    }`,
  )
}

/**
 * R24: the design of an uploaded HTML template, for the console's image adjuster (loaded when its sheet opens: a
 * design may be 5 MB, too much to ship with the templates list). Super-admins only.
 */
export async function loadHtmlDesignAction(id: string): Promise<{ html: string } | { error: string }> {
  await requirePlatformAdmin()
  if (!z.uuid().safeParse(id).success) return { error: 'Template not found' }
  const row = await getStudioTemplate(platformDb(), { id })
  const node = (
    (row?.pages as TemplatePage[] | undefined)?.[0]?.data.content as
      | { type: string; props: Record<string, unknown> }[]
      | undefined
  )?.[0]
  if (!row || node?.type !== HTML_DESIGN) return { error: 'This is not an uploaded HTML design' }
  const html = await htmlDesignSource(node.props, templateDocReader())
  return html === null ? { error: 'The design file is missing — upload it again' } : { html }
}
