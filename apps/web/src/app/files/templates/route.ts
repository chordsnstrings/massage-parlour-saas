import {
  decodeHtmlBytes,
  fixHtmlDesign,
  type HtmlDesignReport,
  htmlCrmContractOf,
  htmlDesignEmbedHosts,
  htmlDesignEmbedWarning,
  htmlDesignReport,
  htmlDesignReportLine,
  MAX_HTML_UPLOAD_BYTES,
} from '@spa/core'
import { type PendingTemplateVersion, platformDb } from '@spa/db'
import {
  DomainError,
  getStudioTemplate,
  htmlDesignDocFor,
  MAX_TEMPLATE_BYTES,
  MAX_TEMPLATE_FILE_BYTES,
  parseTemplateJson,
  pushTemplateVersion,
  SITE_EDIT_MAX_PAGE_BYTES,
  saveStudioTemplate,
  setPendingTemplateVersion,
  storeTemplateHtmlDoc,
  templateDesignsIntoFiles,
  templateDocOf,
  templateKeyFrom,
  templateVersionEntry,
} from '@spa/services'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { templateProblem } from '@/app/platform/(console)/templates/data'
import { parseImages } from '@/app/platform/(console)/templates/parse-images'
import { htmlTooLarge, jsonTooLarge } from '@/app/platform/(console)/templates/upload-limits'
import { HTML_DESIGN_PLACEHOLDERS, htmlDesignPages } from '@/components/site/html-design-values'
import { isTemplateKey, TEMPLATES } from '@/components/site/templates'
import { type ActionResult, fail, formObject, fromZod, ok } from '@/lib/action'
import { isPlatformAdmin } from '@/server/access'
import { audit } from '@/server/audit'
import { readForm, sameOrigin, TooLarge } from '@/server/read-form'
import { getSession } from '@/server/session'

/**
 * POST /files/templates?kind=html|json|version (multipart) — the console's "Upload HTML" (R17/R24, files up to 5 MB),
 * "Import JSON" (≤ 11 MB: an export inlines its designs) and an HTML template's "Upload new version" (R28 P5:
 * `&id={templateId}`, waits for its sign-off — the Roll out). A route handler instead of server actions: those cap request bodies at 1 MB (Next's
 * serverActions.bodySizeLimit, global — raising it would raise it for every action, anonymous spa-site ones too).
 * Not proxied (/files). Origin, Content-Length, session and super-admin + 2FA are checked before the body is read,
 * then the body is streamed through a byte counter. Replies in the ActionResult shape the console forms use.
 */
const reply = (status: number, result: ActionResult) =>
  Response.json(result, { status, headers: { 'cache-control': 'no-store' } })

/** Rolls the upload transaction back when the page JSON (image adjustments) is over the draft cap. */
class PageTooLarge extends Error {}
const MULTIPART = 256 * 1024
const LIMITS = {
  html: MAX_HTML_UPLOAD_BYTES + MULTIPART,
  version: MAX_HTML_UPLOAD_BYTES + MULTIPART,
  json: MAX_TEMPLATE_FILE_BYTES + 64 * 1024,
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** R28 P5: the design report as audited (codes only). */
const reportAudit = (r: HtmlDesignReport) => ({
  contract: r.contract,
  slots: r.slots,
  texts: r.texts,
  warnings: r.warnings.map((w) => w.code),
})

/** The chosen file decoded as a design, or the refusal (same checks for an upload and a new version). */
async function htmlFileOf(
  form: FormData,
): Promise<{ raw: string; encoding: string; size: number } | [number, ActionResult]> {
  const file = form.get('file')
  if (!(file instanceof File) || !file.size)
    return [422, fail('Choose an HTML file', { file: 'Choose an .html file' })]
  if (!/\.html?$/i.test(file.name) && file.type !== 'text/html')
    return [422, fail('Only .html files can be uploaded', { file: 'Choose an .html file' })]
  if (file.size > MAX_HTML_UPLOAD_BYTES) {
    const error = htmlTooLarge(file.size)
    return [413, fail(error, { file: error })]
  }
  const { html: raw, encoding } = decodeHtmlBytes(new Uint8Array(await file.arrayBuffer()))
  if (!/<(?:!doctype|html|head|body|div|section|main)\b/i.test(raw))
    return [422, fail('This file does not look like an HTML page', { file: 'Choose an .html file' })]
  return { raw, encoding, size: file.size }
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || null)

async function uploadHtml(form: FormData, userId: string): Promise<[number, ActionResult]> {
  const parsed = z
    .object({ name: z.string().trim().min(2).max(60), description: optionalText(300) })
    .safeParse(formObject(form))
  if (!parsed.success) return [422, fromZod(parsed.error)]
  const file = form.get('file')
  if (!(file instanceof File) || !file.size)
    return [422, fail('Choose an HTML file', { file: 'Choose an .html file' })]
  if (!/\.html?$/i.test(file.name) && file.type !== 'text/html')
    return [422, fail('Only .html files can be uploaded', { file: 'Choose an .html file' })]
  if (file.size > MAX_HTML_UPLOAD_BYTES) {
    const error = htmlTooLarge(file.size)
    return [413, fail(error, { file: error })]
  }
  const key = templateKeyFrom(parsed.data.name)
  // R24 review: read the bytes the way a browser opening the file would (BOM, <meta charset>, else UTF-8 / windows-1252),
  // never blindly as UTF-8 — a windows-1252 file would otherwise lose every accented letter for good.
  const { html: raw, encoding } = decodeHtmlBytes(new Uint8Array(await file.arrayBuffer()))
  if (!/<(?:!doctype|html|head|body|div|section|main)\b/i.test(raw))
    return [422, fail('This file does not look like an HTML page', { file: 'Choose an .html file' })]
  const images = parseImages(form.get('images'))
  if (!images) return [422, fail('The image adjustments could not be read. Reopen the file and try again.')]
  const replace = form.get('replace') === 'on'
  if (isTemplateKey(key) && !replace) {
    const error = `"${key}" is the built-in ${TEMPLATES[key].name}. Pick another name, or tick "Replace a template with the same key" to override it.`
    return [422, fail(error, { name: error })]
  }
  const active = form.get('active') === 'on'
  // R24: exact unless the uploader asks for the phone fixes.
  const phoneFixes = form.get('phoneFixes') === 'on'
  let bytes = 0
  try {
    // R24 review: the design is stored byte for byte as one template file; the page JSON only references it.
    bytes = await platformDb().transaction(async (db) => {
      const doc = await storeTemplateHtmlDoc(db, { html: raw, userId })
      const pages = htmlDesignPages(key, doc, images, phoneFixes)
      if (JSON.stringify(pages[0]!.data).length > SITE_EDIT_MAX_PAGE_BYTES) throw new PageTooLarge()
      // R28 P5: replacing an HTML template's file makes the replaced one an older version (spas on it can be rolled
      // out to this one).
      const before = replace ? await getStudioTemplate(db, { key }) : null
      const entry = before ? templateVersionEntry(before) : null
      await saveStudioTemplate(
        db,
        {
          key,
          name: parsed.data.name,
          description: parsed.data.description,
          theme: {},
          pages,
          active,
          createdBy: userId,
        },
        { replace },
      )
      if (entry) await pushTemplateVersion(db, key, entry)
      return doc.bytes
    })
  } catch (e) {
    if (e instanceof PageTooLarge) {
      const error = 'Too many image adjustments for this design (page size limit)'
      return [422, fail(error, { file: error })]
    }
    if (e instanceof DomainError) return [422, fail(e.message, { file: e.message })]
    throw e
  }
  const fixes = phoneFixes ? fixHtmlDesign(raw).fixes : []
  const embeds = htmlDesignEmbedHosts(raw)
  const crm = htmlCrmContractOf(raw)?.mode ?? null
  const report = htmlDesignReport(raw)
  await audit({
    actorUserId: userId,
    action: 'platform.site_template.html_uploaded',
    entity: 'site_template',
    entityId: key,
    data: {
      bytes: file.size,
      storedBytes: bytes,
      encoding,
      phoneFixes,
      placeholders: HTML_DESIGN_PLACEHOLDERS.filter((p) => raw.includes(`{{${p}}}`)),
      fixes,
      embeds,
      crm,
      adjustedImages: images.length,
      report: reportAudit(report),
    },
  })
  revalidatePath('/platform/templates', 'layout')
  const fixed = fixes.length
    ? ` Fixed for phones: ${fixes.map((f) => (f === 'viewport' ? 'added the mobile viewport' : 'fluid image widths')).join(', ')}.`
    : ''
  const warning = htmlDesignEmbedWarning(embeds)
  // R26: a design with the CRM data contract gets each spa's live CRM data (docs/design/html-crm-contract.md).
  const live = crm
    ? ' CRM data contract found: services, prices, hours, phones, address and staff (opt-in) come live from each spa’s CRM.'
    : /CRM_DATA/.test(raw)
      ? ' window.CRM_DATA is not a plain JSON literal, so the design keeps its own data.'
      : ''
  return [
    200,
    ok(
      `${parsed.data.name} uploaded${active ? '' : ' — hidden from spas until you switch it on'}. Stored exactly as the file${encoding === 'utf-8' ? '' : ` (read as ${encoding})`}.${fixed}${live}${warning ? ` ${warning}` : ''} ${htmlDesignReportLine(report)}.`,
      { embeds, crm, report },
    ),
  ]
}

/**
 * R28 P5 (owner D4): a new version of an uploaded HTML template, stored as its pending version — invisible to spas
 * and to apply until the super-admin signs it off with Roll out (which moves the spas on older versions to it).
 */
async function uploadVersion(form: FormData, userId: string, id: string): Promise<[number, ActionResult]> {
  const row = UUID.test(id) ? await getStudioTemplate(platformDb(), { id }) : null
  const current = row ? templateDocOf(row.pages) : null
  if (!row || !current) return [404, fail('Only an uploaded HTML template gets new versions.')]
  const read = await htmlFileOf(form)
  if (Array.isArray(read)) return read
  const { raw, size } = read
  if (htmlDesignDocFor(raw).sha256 === current.sha256)
    return [422, fail('This is the current version.', { file: 'This is the current version.' })]
  const images = parseImages(form.get('images'))
  if (!images) return [422, fail('The image adjustments could not be read. Reopen the file and try again.')]
  const phoneFixes = form.get('phoneFixes') === 'on'
  const report = htmlDesignReport(raw)
  const version = row.version + 1
  let pending: PendingTemplateVersion
  try {
    pending = await platformDb().transaction(async (db) => {
      const doc = await storeTemplateHtmlDoc(db, { html: raw, userId })
      const pages = htmlDesignPages(row.key, doc, images, phoneFixes)
      if (JSON.stringify(pages[0]!.data).length > SITE_EDIT_MAX_PAGE_BYTES) throw new PageTooLarge()
      const p: PendingTemplateVersion = {
        version,
        sha256: doc.sha256,
        file: doc.file,
        bytes: doc.bytes,
        at: new Date().toISOString(),
        by: userId,
        pages,
        report: report as unknown as Record<string, unknown>,
      }
      await setPendingTemplateVersion(db, row.id, p)
      return p
    })
  } catch (e) {
    if (e instanceof PageTooLarge) {
      const error = 'Too many image adjustments for this design (page size limit)'
      return [422, fail(error, { file: error })]
    }
    if (e instanceof DomainError) return [422, fail(e.message, { file: e.message })]
    throw e
  }
  await audit({
    actorUserId: userId,
    action: 'platform.site_template.version_uploaded',
    entity: 'site_template',
    entityId: row.key,
    data: {
      fromSha: current.sha256,
      toSha: pending.sha256,
      version,
      bytes: size,
      phoneFixes,
      report: reportAudit(report),
    },
  })
  revalidatePath('/platform/templates', 'layout')
  return [
    200,
    ok(`Version ${version} uploaded — waiting for your sign-off. ${htmlDesignReportLine(report)}.`, {
      report,
      version,
    }),
  ]
}

/** Imports an exported template file; with "replace" an existing template with the same key is overwritten. */
async function importJson(form: FormData, userId: string): Promise<[number, ActionResult]> {
  const file = form.get('file')
  if (!(file instanceof File) || !file.size)
    return [422, fail('Choose a template file', { file: 'Choose a .json file' })]
  const result = parseTemplateJson(await file.text())
  if (!result.ok) return [422, fail(result.error, { file: result.error })]
  const t = result.template
  const problem = templateProblem(t.pages, { requireProps: true })
  if (problem) return [422, fail(problem, { file: problem })]
  const replace = form.get('replace') === 'on'
  // A studio row with a built-in key replaces that built-in for every spa: only when explicitly asked.
  if (isTemplateKey(t.key) && !replace) {
    const error = `"${t.key}" is the built-in ${TEMPLATES[t.key].name}. Tick "Replace a template with the same key" to override it, or change the key in the file.`
    return [422, fail(error, { file: error })]
  }
  const active = form.get('active') === 'on'
  try {
    await platformDb().transaction(async (db) => {
      // R24 review: inline designs (an export inlines them) become template files again, checked like an upload.
      const pages = []
      for (const p of t.pages)
        pages.push({ ...p, data: await templateDesignsIntoFiles(p.data, { db, userId }) })
      if (JSON.stringify(pages).length > MAX_TEMPLATE_BYTES)
        throw new DomainError(
          `The template is too large once its HTML designs are files (${MAX_TEMPLATE_BYTES / (1024 * 1024)} MB max).`,
        )
      await saveStudioTemplate(
        db,
        {
          key: t.key,
          name: t.name,
          description: t.description,
          theme: t.theme,
          pages,
          active,
          createdBy: userId,
        },
        { replace },
      )
    })
  } catch (e) {
    if (e instanceof DomainError) return [422, fail(e.message, { file: e.message })]
    throw e
  }
  await audit({
    actorUserId: userId,
    action: 'platform.site_template.imported',
    entity: 'site_template',
    entityId: t.key,
  })
  revalidatePath('/platform/templates', 'layout')
  return [
    200,
    ok(active ? `${t.name} imported` : `${t.name} imported — hidden from spas until you switch it on`),
  ]
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return reply(403, fail('Forbidden'))
  const q = new URL(req.url).searchParams
  const kind = q.get('kind')
  if (kind !== 'html' && kind !== 'json' && kind !== 'version') return reply(400, fail('Unknown upload'))
  const limit = LIMITS[kind]
  const size = Number(req.headers.get('content-length') ?? 0) || limit
  const tooLarge = () => {
    const error = kind === 'json' ? jsonTooLarge(size) : htmlTooLarge(size)
    return fail(error, { file: error })
  }
  if (size > limit && req.headers.get('content-length')) return reply(413, tooLarge())
  const session = await getSession()
  if (!session) return reply(401, fail('Your session ended. Sign in again.'))
  if (!(await isPlatformAdmin(session.user.id)))
    return reply(403, fail('Only super-admins with two-factor sign-in can upload templates.'))
  let form: FormData
  try {
    form = await readForm(req, limit)
  } catch (e) {
    if (e instanceof TooLarge) return reply(413, tooLarge())
    return reply(400, fail('Upload failed. Try again.'))
  }
  const [status, result] =
    kind === 'version'
      ? await uploadVersion(form, session.user.id, q.get('id') ?? '')
      : await (kind === 'html' ? uploadHtml : importJson)(form, session.user.id)
  return reply(status, result)
}
