'use server'
import { runSiteTexts, type SiteTextsResult, siteTextsRunning, siteTextsSkipped } from '@spa/ai'
import { seoFixable } from '@spa/core'
import { withTenant } from '@spa/db'
import { getSite, latestSeoCheck, listPages } from '@spa/services'
import { z } from 'zod'
import { siteEditSchema } from '@/components/site/ai-schema'
import { designSignature } from '@/components/site/content'
import { type ActionResult, fail, fromZod, ok } from '@/lib/action'
import { fixtureClient } from '@/server/ai-fixture'
import { audit } from '@/server/audit'
import { aiEditReady, siteAiGuard } from '@/server/site-ai-gate'
import { revalidateStudio } from '@/server/studio'

/*
 * R23 "Write texts" (console spa website page): the site_editor agent drafts the texts of every page in EN + AR from
 * the spa's own data. Text props only (images, links, structure and styles stay), written to the DRAFTS: published
 * versions are never touched and nothing publishes. Same gate as Studio Ask AI / Claude MCP (SITE_AI_EDITOR_EMAILS
 * super-admins with 2FA) and the same editor locks (a page open in someone else's editor is skipped). R28 P4: an
 * HTML-design page gets its website content written (data texts + page texts, EN + AR; its file never changes).
 * R28 P5: the loop lives in @spa/ai (`runSiteTexts`), shared with the queued run after a template apply / upgrade.
 * R30 "Draft fixes" (SEO check card): `scope: 'seo'` — only the search fields of the pages the latest search check
 * found a title or description problem on (site-kit `TextScope`); same gate, drafts only.
 */

/** A queued run (owner D5) started less than this ago is still running. */
const RUNNING_MS = 15 * 60_000

const inputSchema = z.object({
  notes: z.string().trim().max(400).optional(),
  scope: z.literal('seo').optional(),
})

export type WriteTextsResult = SiteTextsResult

export async function writeTextsAction(slug: string, input: unknown): Promise<ActionResult> {
  const { ctx, error } = await siteAiGuard(slug)
  if (error) return fail(error)
  if (!aiEditReady()) return fail('AI writing isn’t set up yet.')
  const parsed = inputSchema.safeParse(input ?? {})
  if (!parsed.success) return fromZod(parsed.error, { english: true })
  const tenantId = ctx.tenant.id
  const seo = parsed.data.scope === 'seo'
  const { queued, check, pages } = await withTenant(tenantId, async (tx) => {
    const site = await getSite(tx, tenantId)
    const check = seo && site ? await latestSeoCheck(tx, site.id) : null
    return { queued: site?.textRun, check, pages: check ? await listPages(tx, tenantId) : [] }
  })
  let pageIds: string[] | undefined
  if (seo) {
    if (!check) return fail('Run a search check first.')
    const paths = new Set(check.findings.filter((f) => seoFixable(f.code)).map((f) => f.path))
    pageIds = pages.filter((p) => paths.has(p.slug ? `/${p.slug}` : '/')).map((p) => p.id)
    if (!pageIds.length) return fail('The last search check found no page titles or descriptions to fix.')
  }
  const busy =
    queued?.state === 'running' && Date.now() - Date.parse(queued.startedAt ?? queued.at) < RUNNING_MS
  if (busy || siteTextsRunning.has(tenantId)) return fail('Write texts is already running for this spa.')
  siteTextsRunning.add(tenantId)
  try {
    const notes = parsed.data.notes || undefined
    const run = await runSiteTexts({
      tenantId,
      slug,
      userId: ctx.user.id,
      notes,
      ...(seo ? { scope: 'seo' as const, pageIds } : {}),
      schema: siteEditSchema(),
      signature: designSignature,
      client: fixtureClient(slug),
    })
    if (!run.siteId) return fail(run.stop ?? 'Choose a template first: there are no pages to write yet.')
    const { result, stop, costUsd } = run
    await audit({
      tenantId,
      actorUserId: ctx.user.id,
      impersonatorUserId: ctx.impersonating ? ctx.user.id : undefined,
      action: 'site.ai_texts_written',
      entity: 'site',
      entityId: run.siteId,
      data: {
        via: seo ? 'studio_seo_fixes' : 'studio_write_texts',
        pages: result.pages.map((p) => ({ id: p.id, slug: p.slug, filled: p.filled })),
        skipped: result.skipped,
        notes: Boolean(notes),
        costUsd,
      },
    })
    if (result.pages.length) revalidateStudio(slug)
    const skipped = siteTextsSkipped(result)
    if (!result.pages.length) return fail(stop ?? `No texts were written.${skipped}`)
    const n = result.pages.length
    if (seo)
      return ok(
        `Search fixes drafted for ${n} ${n === 1 ? 'page' : 'pages'} in English and Arabic (${result.pages
          .map((p) => `${p.title} ${p.filled}`)
          .join(
            ', ',
          )}).${skipped}${stop ? ` ${stop}` : ''} The drafts are ready to review — check each page, then Publish.`,
        result,
      )
    return ok(
      `Drafted texts for ${n} ${n === 1 ? 'page' : 'pages'} in English and Arabic (${result.pages
        .map((p) => `${p.title} ${p.filled}`)
        .join(
          ', ',
        )}).${skipped}${stop ? ` ${stop}` : ''} Nothing is published — read each page, adjust, then Publish.`,
      result,
    )
  } finally {
    siteTextsRunning.delete(tenantId)
  }
}
