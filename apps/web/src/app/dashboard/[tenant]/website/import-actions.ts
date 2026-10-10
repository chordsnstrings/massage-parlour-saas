'use server'
import {
  AiBudgetExceededError,
  AiDisabledError,
  AiOutputError,
  loadSpaContext,
  planSiteImport,
} from '@spa/ai'
import { platformDb, siteAiEditorStatus, type ThemeTokens, withTenant } from '@spa/db'
import {
  buildImportOps,
  crawlSiteForImport,
  DomainError,
  fetchImportImage,
  type ImportedSite,
  importImageRef,
  MAX_IMPORT_IMAGES,
  PAGE_SLUG,
  type ProcessedImage,
  resolveImportImages,
  runSiteEdit,
  type SiteEditDeps,
  type SiteEditResult,
  saveImportImages,
  serviceLine,
  usedImportImages,
  visitLines,
} from '@spa/services'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { siteEditSchema } from '@/components/site/ai-schema'
import { normalizeTheme } from '@/components/site/theme'
import { type ActionResult, fail, failDomain, fromZod, ok } from '@/lib/action'
import { appPath } from '@/lib/paths'
import { type MemberContext, studioGuard } from '@/server/access'
import { aiFixturesOn, fixtureClient } from '@/server/ai-fixture'
import { audit } from '@/server/audit'

/*
 * F32 Studio "Import from existing website" (super-admin tooling, EN UI): the server reads the spa's current public
 * site (robots.txt respected, SSRF-guarded: public addresses only, pinned DNS, redirects re-checked, time + size caps),
 * extracts its content and maps it onto existing blocks as a NEW DRAFT page through the site-edit ops layer — dry run
 * first (preview), then Apply (images downloaded into the spa's media library). Never publishes.
 * Optional AI mapping (site_editor agent via the gateway: budget + kill switch) for SITE_AI_EDITOR_EMAILS accounts.
 */

const deps = (): SiteEditDeps => ({
  schema: siteEditSchema(),
  normalizeTheme: (t) => normalizeTheme(t) as unknown as ThemeTokens,
})

/** Playwright only (never in deploy env): `host:port` pairs of the local fixture site exempt from the SSRF rules. */
const e2eAllow = () =>
  (process.env.SITE_IMPORT_E2E_ALLOW ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)

async function aiMappingAllowed(ctx: MemberContext) {
  if (!process.env.ARK_API_KEY && !aiFixturesOn()) return false
  // No plan gate: Website Studio AI runs on every plan (PLAN §18.8) — the SITE_AI_EDITOR_EMAILS allow-list, the AI
  // kill switch and the spa's AI budget limit it.
  return (await siteAiEditorStatus(platformDb(), ctx.user.id)) === 'ok'
}

const auditAs = (ctx: MemberContext, action: string, entityId: string | undefined, data: unknown) =>
  audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    impersonatorUserId: ctx.impersonating ? ctx.user.id : undefined,
    action,
    entity: entityId ? 'site_page' : 'site',
    entityId,
    data,
  })

const pageSlug = z
  .string()
  .trim()
  .min(1, 'Choose an address for the new page')
  .max(60)
  .regex(PAGE_SLUG, 'Use lowercase letters, numbers and dashes')
const target = {
  url: z.string().trim().min(3, 'Enter the address of the current website').max(500),
  slug: pageSlug,
  title: z.string().trim().min(1, 'Name the new page').max(80),
}
const previewSchema = z.object({ ...target, ai: z.boolean().default(false) })

/** What the preview shows (the extracted content in plain lines; no remote images are loaded in the console). */
function siteView(site: ImportedSite) {
  return {
    url: site.url,
    host: site.host,
    pages: site.pages.map((p) => p.url),
    name: site.name,
    headline: site.headline,
    description: site.description ?? site.lead,
    sections: site.sections.map((s) => s.heading),
    services: site.services.map(serviceLine),
    visit: visitLines(site),
    images: site.images.map((i) => ({ url: i.url, alt: i.alt })),
  }
}

const errorText = (r: Extract<SiteEditResult, { ok: false }>) => r.errors.slice(0, 3).join(' · ')

/** Fetch + extract + map + dry run. Nothing is stored. */
export async function importSitePreviewAction(slug: string, input: unknown): Promise<ActionResult> {
  const { ctx, error } = await studioGuard(slug, 'site.design')
  if (error) return fail(error)
  const parsed = previewSchema.safeParse(input)
  if (!parsed.success) return fromZod(parsed.error)
  const { url, title, ai } = parsed.data
  const page = parsed.data.slug
  let site: ImportedSite
  let skipped: { url: string; reason: string }[]
  try {
    ;({ site, skipped } = await crawlSiteForImport(url, { allow: e2eAllow() }))
  } catch (e) {
    await auditAs(ctx, 'site.import.previewed', undefined, {
      url: url.slice(0, 300),
      ok: false,
      error: e instanceof DomainError ? e.message : 'failed',
    })
    if (e instanceof DomainError) return failDomain(e)
    throw e
  }
  const standard = buildImportOps(site, { slug: page, title })
  let ops: Record<string, unknown>[] = standard
  let note = ''
  let usedAi = false
  if (ai) {
    if (!(await aiMappingAllowed(ctx)))
      note = 'AI mapping isn’t available for this account — used the standard layout.'
    else {
      try {
        const loaded = await withTenant(ctx.tenant.id, (tx) =>
          loadSpaContext(tx, ctx.tenant.id, 'content_agent'),
        )
        const plan = await planSiteImport({
          tenantId: ctx.tenant.id,
          about: `${loaded.name}, a massage & wellness spa in the UAE. Brand voice: ${loaded.voice}.`,
          site: { ...site, images: undefined },
          images: site.images.map((img, n) => ({ url: importImageRef(n), alt: img.alt })),
          schema: deps().schema,
          client: fixtureClient(slug),
        })
        if (plan.ops.length) {
          ops = [standard[0]!, ...plan.ops.map((op) => ({ ...op, page }))]
          usedAi = true
          note = plan.note
        } else note = 'The AI suggested nothing — used the standard layout.'
      } catch (e) {
        note =
          e instanceof AiBudgetExceededError
            ? 'The monthly AI budget for this spa is used up — used the standard layout.'
            : e instanceof AiDisabledError
              ? 'AI is switched off in the AI model settings — used the standard layout.'
              : e instanceof AiOutputError
                ? 'The AI reply could not be read — used the standard layout.'
                : 'The AI service is busy — used the standard layout.'
      }
    }
  }
  const dry = (o: Record<string, unknown>[]) =>
    withTenant(ctx.tenant.id, (tx) =>
      runSiteEdit(tx, { tenantId: ctx.tenant.id, userId: ctx.user.id, ops: o, dryRun: true }, deps()),
    )
  let result = await dry(ops)
  if (!result.ok && usedAi) {
    // AI ops that don't fit the blocks: fall back to the standard mapping rather than failing the import.
    note = `The AI layout didn't fit the blocks (${errorText(result)}) — used the standard layout.`
    ops = standard
    usedAi = false
    result = await dry(ops)
  }
  if (!result.ok) return fail(errorText(result))
  await auditAs(ctx, 'site.import.previewed', undefined, {
    url: site.url.slice(0, 300),
    host: site.host,
    pages: site.pages.length,
    ok: true,
    ai: usedAi,
  })
  return ok(undefined, {
    site: siteView(site),
    skipped: skipped.slice(0, 8),
    ops,
    images: site.images.map((i) => i.url),
    summary: result.summary,
    note,
    ai: usedAi,
    slug: page,
    title,
  })
}

const applySchema = z.object({
  ...target,
  ops: z
    .array(z.object({ op: z.string() }).passthrough())
    .min(1)
    .max(40),
  images: z.array(z.string().max(1500)).max(MAX_IMPORT_IMAGES).default([]),
  ai: z.boolean().default(false),
})

/** The previewed ops, applied: images into the media library, then the new page as a DRAFT (never published). */
export async function importSiteApplyAction(slug: string, input: unknown): Promise<ActionResult> {
  const { ctx, error } = await studioGuard(slug, 'site.design')
  if (error) return fail(error)
  const parsed = applySchema.safeParse(input)
  if (!parsed.success) return fromZod(parsed.error)
  const { ops, images, url, title } = parsed.data
  const page = parsed.data.slug
  // Only "add this one new page and fill it": the import can't edit other pages, the theme or renames.
  const [first, ...rest] = ops
  if (first?.op !== 'add_page' || first.slug !== page)
    return fail('This import could not be read. Preview it again.')
  if (
    rest.some(
      (o) =>
        o.page !== page ||
        !['add', 'preset', 'update'].includes(o.op) ||
        (o.op === 'update' && o.id !== 'root'),
    )
  )
    return fail('Only the new page can be filled by an import. Preview it again.')
  const fixedOps = [{ ...first, title: { en: title } }, ...rest]
  let host: string
  try {
    host = new URL(url.includes('://') ? url : `https://${url}`).hostname.replace(/^www\./, '')
  } catch {
    return fail('That address isn’t valid')
  }

  // Downloads first (outside the transaction): only images the ops use, same SSRF rules, ≤ 8 MB each.
  const wanted = usedImportImages(fixedOps).filter((n) => n < images.length)
  const downloaded: { n: number; image: ProcessedImage; alt: string }[] = []
  const failed: number[] = []
  const allow = e2eAllow()
  for (let i = 0; i < wanted.length; i += 4) {
    const batch = wanted.slice(i, i + 4)
    const got = await Promise.allSettled(batch.map((n) => fetchImportImage(images[n]!, { allow })))
    got.forEach((g, k) => {
      const n = batch[k]!
      if (g.status === 'fulfilled') downloaded.push({ n, image: g.value, alt: '' })
      else failed.push(n)
    })
  }

  let result: SiteEditResult
  try {
    result = await withTenant(ctx.tenant.id, async (tx) => {
      const urls = await saveImportImages(tx, {
        tenantId: ctx.tenant.id,
        userId: ctx.user.id,
        host,
        images: downloaded,
      })
      const r = await runSiteEdit(
        tx,
        {
          tenantId: ctx.tenant.id,
          userId: ctx.user.id,
          ops: resolveImportImages(fixedOps, urls),
          dryRun: false,
        },
        deps(),
      )
      // All or nothing: a refused page leaves no images behind either.
      if (!r.ok) throw new DomainError(errorText(r))
      return r
    })
  } catch (e) {
    if (e instanceof DomainError) return failDomain(e)
    throw e
  }
  if (!result.ok) return fail(errorText(result))
  const created = result.pages.find((p) => p.isNew)
  await auditAs(ctx, 'site.page.imported', created?.id, {
    url: url.slice(0, 300),
    host,
    slug: page,
    images: downloaded.length,
    imagesFailed: failed.length,
    ai: parsed.data.ai,
    summary: result.summary.slice(0, 20).map((s) => s.slice(0, 200)),
  })
  revalidatePath(`/dashboard/${slug}/website`, 'layout')
  return ok(
    failed.length
      ? `Imported as a draft page — ${failed.length} ${failed.length === 1 ? 'image' : 'images'} couldn’t be downloaded`
      : 'Imported as a draft page — not published',
    {
      pageId: created?.id ?? null,
      editorHref: created ? appPath(`/${slug}/website/editor/${created.id}`) : null,
    },
  )
}
