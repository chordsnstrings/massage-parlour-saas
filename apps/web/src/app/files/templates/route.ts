import { fixHtmlDesign, htmlDesignStoredSize, MAX_HTML_UPLOAD_BYTES } from '@spa/core'
import { platformDb } from '@spa/db'
import {
  DomainError,
  MAX_TEMPLATE_BYTES,
  parseTemplateJson,
  prepareHtmlDesign,
  SITE_EDIT_MAX_PAGE_BYTES,
  saveStudioTemplate,
  templateHtmlAssetSink,
  templateKeyFrom,
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
import { designFileUrl } from '@/server/html-design-files'
import { readForm, sameOrigin, TooLarge } from '@/server/read-form'
import { getSession } from '@/server/session'

/**
 * POST /files/templates?kind=html|json (multipart) — the console's "Upload HTML" (R17/R24, files up to 5 MB) and
 * "Import JSON" (≤ 2 MB). A route handler instead of server actions: those cap request bodies at 1 MB (Next's
 * serverActions.bodySizeLimit, global — raising it would raise it for every action, anonymous spa-site ones too).
 * Not proxied (/files). Origin, Content-Length, session and super-admin + 2FA are checked before the body is read,
 * then the body is streamed through a byte counter. Replies in the ActionResult shape the console forms use.
 */
const reply = (status: number, result: ActionResult) =>
  Response.json(result, { status, headers: { 'cache-control': 'no-store' } })

const mb = (n: number) => `${(n / (1024 * 1024)).toFixed(1)} MB`
const MULTIPART = 256 * 1024
const LIMITS = { html: MAX_HTML_UPLOAD_BYTES + MULTIPART, json: MAX_TEMPLATE_BYTES + 64 * 1024 }

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
  const raw = await file.text()
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
  let prepared: Awaited<ReturnType<typeof prepareHtmlDesign>>
  try {
    prepared = await platformDb().transaction(async (db) => {
      const p = await prepareHtmlDesign({
        html: raw,
        images,
        sink: templateHtmlAssetSink(db, userId),
        fileUrl: designFileUrl,
      })
      const pages = htmlDesignPages(key, p.html, p.images, phoneFixes)
      if (JSON.stringify(pages[0]!.data).length > SITE_EDIT_MAX_PAGE_BYTES)
        throw new DomainError('Too many image adjustments for this design (page size limit)')
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
      return p
    })
  } catch (e) {
    if (e instanceof DomainError) return [422, fail(e.message, { file: e.message })]
    throw e
  }
  const fixes = phoneFixes ? fixHtmlDesign(prepared.html).fixes : []
  await audit({
    actorUserId: userId,
    action: 'platform.site_template.html_uploaded',
    entity: 'site_template',
    entityId: key,
    data: {
      bytes: file.size,
      storedBytes: htmlDesignStoredSize(prepared.html),
      movedAssets: prepared.moved.count,
      movedBytes: prepared.moved.bytes,
      phoneFixes,
      placeholders: HTML_DESIGN_PLACEHOLDERS.filter((p) => prepared.html.includes(`{{${p}}}`)),
      fixes,
      adjustedImages: images.length,
    },
  })
  revalidatePath('/platform/templates', 'layout')
  const moved = prepared.moved.count
    ? ` Moved ${prepared.moved.count} embedded image/font file${prepared.moved.count === 1 ? '' : 's'} (${mb(prepared.moved.bytes)}) to the platform's files.`
    : ''
  const fixed = fixes.length
    ? ` Fixed for phones: ${fixes.map((f) => (f === 'viewport' ? 'added the mobile viewport' : 'fluid image widths')).join(', ')}.`
    : ''
  return [
    200,
    ok(
      `${parsed.data.name} uploaded${active ? '' : ' — hidden from spas until you switch it on'}.${moved}${fixed}`,
      { movedAssets: prepared.moved.count },
    ),
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
    await saveStudioTemplate(
      platformDb(),
      {
        key: t.key,
        name: t.name,
        description: t.description,
        theme: t.theme,
        pages: t.pages,
        active,
        createdBy: userId,
      },
      { replace },
    )
  } catch (e) {
    if (e instanceof DomainError) return [422, fail(e.message)]
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
  const kind = new URL(req.url).searchParams.get('kind')
  if (kind !== 'html' && kind !== 'json') return reply(400, fail('Unknown upload'))
  const limit = LIMITS[kind]
  const size = Number(req.headers.get('content-length') ?? 0) || limit
  const tooLarge = () => {
    const error = kind === 'html' ? htmlTooLarge(size) : jsonTooLarge(size)
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
  const [status, result] = await (kind === 'html' ? uploadHtml : importJson)(form, session.user.id)
  return reply(status, result)
}
