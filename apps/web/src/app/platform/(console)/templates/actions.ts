'use server'
import { carryHtmlContent, crmDesignData, htmlCrmContractOf, htmlDesignBakedFixes } from '@spa/core'
import { platformDb, tenants, withTenant } from '@spa/db'
import {
  type DesignUpgrade,
  DomainError,
  discardPendingTemplateVersion,
  getStudioTemplate,
  htmlDesignSource,
  type RolloutSkip,
  SITE_EDIT_MAX_PAGE_BYTES,
  sanitizeTemplatePages,
  saveStudioTemplate,
  signOffTemplateVersion,
  snapshotSite,
  spaDesignsIntoTemplate,
  spasOnTemplateVersions,
  studioToSiteTemplate,
  TEMPLATE_KEY,
  type TemplatePage,
  templateDocOf,
  templateKeyFrom,
  templateShas,
  updateStudioTemplate,
  upgradeHtmlDesignLive,
} from '@spa/services'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { HTML_DESIGN } from '@/components/site/html-design-values'
import { isTemplateKey, TEMPLATES } from '@/components/site/templates'
import { type ActionResult, fail, formObject, fromZod, ok } from '@/lib/action'
import { requirePlatformAdmin } from '@/server/access'
import { audit } from '@/server/audit'
import { spaDocReader, templateDocReader, templateIntoSpa } from '@/server/html-design-files'
import { runQueuedTextsAfter, siteTextsGate } from '@/server/site-texts-queue'
import { revalidateStudio } from '@/server/studio'
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

/* ------------------------------------------------------------------ R28 P5: template versions (owner D4 + D5) */

/** Spas a click upgrades at most (each in its own transaction); "Run again for the rest". */
const ROLLOUT_BATCH = 25

export type RolloutPlan = {
  version: number
  /** The version waits for its sign-off (Roll out = sign-off). */
  pending: boolean
  /** The version's design sha: the Roll out form sends it back (refused when it changed meanwhile). */
  sha256: string
  spas: { name: string; slug: string; own: boolean; kept: number; notKept: number; hasDraft: boolean }[]
  skipped: { name: string; slug: string; reason: string }[]
  /** More spas than one click upgrades. */
  more: boolean
  /** Why Write texts would be skipped for this super-admin (null: it runs). */
  textsSkip: string | null
}

const skipReason = (reason: RolloutSkip['reason'], version: number) =>
  reason === 'held'
    ? `kept on version ${Math.max(1, version - 1)} (its upgrade was undone)`
    : reason === 'changed'
      ? 'its live design file was changed — never overwritten'
      : 'not published yet'

const upgradeSkipReason = (u: Extract<DesignUpgrade, { status: 'skipped' }>) =>
  u.reason === 'locked'
    ? (u.detail ?? 'open in the Studio editor')
    : u.reason === 'already'
      ? 'already on this version'
      : u.reason === 'not-on-version'
        ? 'no longer on an older version'
        : `its website content did not fit the new version${u.detail ? ` (${u.detail})` : ''}`

/** The version a Roll out moves spas to: the pending one, else the current one (spas still on older versions). */
async function rolloutTarget(id: string) {
  if (!z.uuid().safeParse(id).success) return null
  const row = await getStudioTemplate(platformDb(), { id })
  const current = row ? templateDocOf(row.pages) : null
  if (!row || !current) return null
  const pending = row.pending
  return pending
    ? {
        row,
        pending: true,
        version: pending.version,
        toSha: pending.sha256,
        toDoc: { file: pending.file, sha256: pending.sha256, bytes: pending.bytes, chars: 0 },
        fromShas: templateShas(row),
      }
    : {
        row,
        pending: false,
        version: row.version,
        toSha: current.sha256,
        toDoc: current,
        fromShas: templateShas(row).filter((s) => s !== current.sha256),
      }
}

/**
 * The Roll out sheet: each spa the click would switch (made for it, edits kept / not kept by a carry dry run, a
 * draft waiting) and the spas left as they are, with why.
 */
export async function rolloutPlanAction(id: string): Promise<RolloutPlan | { error: string }> {
  const { user } = await requirePlatformAdmin()
  const t = await rolloutTarget(id)
  if (!t) return { error: 'This is not an uploaded HTML design' }
  const found = await spasOnTemplateVersions(platformDb(), {
    key: t.row.key,
    fromShas: t.fromShas,
    toSha: t.toSha,
    version: t.version,
  })
  const read = templateDocReader()
  const newHtml = (await read(t.toDoc)) ?? ''
  const newData = crmDesignData(htmlCrmContractOf(newHtml))
  const docs = new Map(
    [templateDocOf(t.row.pages), ...(t.row.history ?? [])].flatMap((d) =>
      d ? [[d.sha256, { file: d.file, sha256: d.sha256, bytes: d.bytes, chars: 0 }] as const] : [],
    ),
  )
  const oldHtml = new Map<string, string | null>()
  const spas: RolloutPlan['spas'] = []
  for (const s of found.spas.slice(0, ROLLOUT_BATCH)) {
    if (!oldHtml.has(s.sha256)) {
      const doc = docs.get(s.sha256)
      oldHtml.set(s.sha256, doc ? await read(doc) : null)
    }
    const c = carryHtmlContent(s.content, newData, newHtml, oldHtml.get(s.sha256) ?? undefined)
    spas.push({
      name: s.name,
      slug: s.slug,
      own: s.own,
      kept: c.carried.values + c.carried.texts + c.carried.pictures,
      notKept: c.dropped.length,
      hasDraft: s.hasDraft,
    })
  }
  const gate = await siteTextsGate(user.id)
  return {
    version: t.version,
    pending: t.pending,
    sha256: t.toSha,
    spas,
    skipped: found.skipped.map((s) => ({
      name: s.name,
      slug: s.slug,
      reason: skipReason(s.reason, t.version),
    })),
    more: found.spas.length > ROLLOUT_BATCH,
    textsSkip: gate.ok ? null : gate.reason,
  }
}

/** Drops a version waiting for its sign-off (nothing else changes). */
export async function discardTemplateVersionAction(id: string): Promise<ActionResult> {
  const { user } = await requirePlatformAdmin()
  const t = await rolloutTarget(id)
  if (!t?.pending) return fail('There is no version waiting for sign-off')
  try {
    await discardPendingTemplateVersion(platformDb(), t.row.id)
  } catch (e) {
    return domainFail(e)
  }
  await audit({
    actorUserId: user.id,
    action: 'platform.site_template.version_discarded',
    entity: 'site_template',
    entityId: t.row.key,
    data: { version: t.version, sha256: t.toSha },
  })
  revalidate()
  return ok(`Version ${t.version} discarded`)
}

/**
 * Roll out = sign-off (owner D4): a pending version becomes the template's (new spas get it from now on), then each
 * spa still live on an older version is switched at once — its own published row with its edits carried, its draft
 * moved after it, one undo on its page. Owner D5: each switched spa's Write texts is queued (drafts only; skipped on a
 * design made for that spa or without SITE_AI_EDITOR_EMAILS + 2FA) and runs after the response.
 */
export async function rolloutTemplateVersionAction(
  id: string,
  _prev: ActionResult,
  fd: FormData,
): Promise<ActionResult> {
  const { user } = await requirePlatformAdmin()
  const sha = z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .safeParse(fd.get('sha256'))
  let t = await rolloutTarget(id)
  if (!t || !sha.success) return fail('This is not an uploaded HTML design')
  if (t.toSha !== sha.data)
    return fail('This version changed meanwhile — reload the page and check it again.')
  if (t.pending) {
    try {
      const signed = await signOffTemplateVersion(platformDb(), t.row.id, sha.data, user.id)
      t = { ...t, row: signed.row, fromShas: signed.fromShas, toSha: signed.toSha, version: signed.version }
    } catch (e) {
      return domainFail(e)
    }
    await audit({
      actorUserId: user.id,
      action: 'platform.site_template.version_signed_off',
      entity: 'site_template',
      entityId: t.row.key,
      data: { version: t.version, toSha: t.toSha, fromShas: t.fromShas },
    })
  }
  const target = t
  const found = await spasOnTemplateVersions(platformDb(), {
    key: target.row.key,
    fromShas: target.fromShas,
    toSha: target.toSha,
    version: target.version,
  })
  const template = studioToSiteTemplate(target.row)
  const gate = await siteTextsGate(user.id)
  const switched: { tenantId: string; slug: string; name: string; carried: number; dropped: number }[] = []
  const skipped: { name: string; reason: string }[] = found.skipped.map((s) => ({
    name: s.name,
    reason: skipReason(s.reason, target.version),
  }))
  for (const s of found.spas.slice(0, ROLLOUT_BATCH)) {
    let up: DesignUpgrade
    try {
      up = await withTenant(s.tenantId, (tx) =>
        upgradeHtmlDesignLive(tx, s.tenantId, {
          template,
          pageId: s.pageId,
          fromShas: target.fromShas,
          toSha: target.toSha,
          version: target.version,
          userId: user.id,
          tenantName: s.name,
          prepare: templateIntoSpa(tx, s.tenantId, user.id),
          texts: gate.ok ? { actorUserId: user.id } : { skip: gate.reason },
        }),
      )
    } catch (e) {
      console.error('[site.template_upgraded]', s.slug, e)
      skipped.push({ name: s.name, reason: 'could not be switched — try again' })
      continue
    }
    if (up.status === 'skipped') {
      skipped.push({ name: s.name, reason: upgradeSkipReason(up) })
      continue
    }
    await audit({
      tenantId: s.tenantId,
      actorUserId: user.id,
      action: 'site.template_upgraded',
      entity: 'site',
      data: {
        template: target.row.key,
        version: target.version,
        fromSha: s.sha256,
        toSha: target.toSha,
        carried: up.carried,
        dropped: up.dropped.slice(0, 20),
        pins: up.pins,
        draft: up.draft,
      },
    })
    revalidateStudio(s.slug)
    switched.push({
      tenantId: s.tenantId,
      slug: s.slug,
      name: s.name,
      carried: up.carried.values + up.carried.texts + up.carried.pictures,
      dropped: up.dropped.length,
    })
  }
  const more = found.spas.length > ROLLOUT_BATCH
  await audit({
    actorUserId: user.id,
    action: 'platform.site_template.version_rolled_out',
    entity: 'site_template',
    entityId: target.row.key,
    data: { version: target.version, switched: switched.map((s) => s.slug), skipped },
  })
  revalidate()
  runQueuedTextsAfter(switched)
  const n = switched.length
  const notes = skipped.length
    ? ` Not switched: ${skipped.map((s) => `${s.name} (${s.reason})`).join(', ')}.`
    : ''
  return ok(
    `Version ${target.version} is live for ${n} ${n === 1 ? 'spa' : 'spas'}.${notes}${more ? ' Run again for the rest.' : ''}`,
    {
      version: target.version,
      switched: switched.map(({ name, slug, carried, dropped }) => ({ name, slug, carried, dropped })),
      skipped,
      more,
    },
  )
}
