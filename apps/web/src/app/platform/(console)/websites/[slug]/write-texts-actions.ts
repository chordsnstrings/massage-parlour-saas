'use server'
import { AiBudgetExceededError, AiDisabledError, loadSiteFacts, planSiteTexts } from '@spa/ai'
import { dubaiParts } from '@spa/core'
import { withTenant } from '@spa/db'
import {
  assertPagesUnlocked,
  getEditablePage,
  getSite,
  labelVersion,
  listPages,
  lockSite,
  PageLockedError,
  pageLocksHeldByOthers,
  saveDraft,
} from '@spa/services'
import { fillTextSlots, type TextDraft, type TextSlot, textSlots } from '@spa/services/site-kit'
import { z } from 'zod'
import { siteEditSchema } from '@/components/site/ai-schema'
import { designSignature } from '@/components/site/content'
import { type ActionResult, fail, fromZod, ok } from '@/lib/action'
import type { MemberContext } from '@/server/access'
import { fixtureClient } from '@/server/ai-fixture'
import { audit } from '@/server/audit'
import { aiEditReady, siteAiGuard } from '@/server/site-ai-gate'
import { revalidateStudio } from '@/server/studio'

/*
 * R23 "Write texts" (console spa website page): the site_editor agent drafts the texts of every page in EN + AR from
 * the spa's own data. Text props only (images, links, structure and styles stay), written to the DRAFTS: published
 * versions are never touched and nothing publishes. Same gate as Studio Ask AI / Claude MCP (SITE_AI_EDITOR_EMAILS
 * super-admins with 2FA) and the same editor locks (a page open in someone else's editor is skipped).
 */

const MAX_PAGES = 12
const SLOTS_PER_CALL = 40
const MAX_CALLS = 24
const DEADLINE_MS = 150_000
const MAX_PAGE_BYTES = 512 * 1024
const RUN_AGAIN = 'not written — run again'
/** One run per spa at a time (this server process). */
const running = new Set<string>()

const inputSchema = z.object({ notes: z.string().trim().max(400).optional() })

type Job = { id: string; title: string; slug: string; slots: TextSlot[] }
export type WriteTextsResult = {
  pages: { id: string; slug: string; title: string; filled: number }[]
  skipped: { title: string; reason: string }[]
}

const chunks = <T>(list: T[], size: number) =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size))

function dubaiStamp(now = new Date()) {
  const p = dubaiParts(now)
  return `${p.date} ${String(Math.floor(p.minutes / 60)).padStart(2, '0')}:${String(p.minutes % 60).padStart(2, '0')}`
}

export async function writeTextsAction(slug: string, input: unknown): Promise<ActionResult> {
  const { ctx, error } = await siteAiGuard(slug)
  if (error) return fail(error)
  if (!aiEditReady()) return fail('AI writing isn’t set up yet.')
  const parsed = inputSchema.safeParse(input ?? {})
  if (!parsed.success) return fromZod(parsed.error, { english: true })
  const tenantId = ctx.tenant.id
  if (running.has(tenantId)) return fail('Write texts is already running for this spa.')
  running.add(tenantId)
  try {
    return await run(ctx, slug, parsed.data.notes || undefined)
  } finally {
    running.delete(tenantId)
  }
}

async function run(ctx: MemberContext, slug: string, notes: string | undefined): Promise<ActionResult> {
  const tenantId = ctx.tenant.id
  const schema = siteEditSchema()
  const loaded = await withTenant(tenantId, async (tx) => {
    const site = await getSite(tx, tenantId)
    const pages = site ? (await listPages(tx, tenantId)).slice(0, MAX_PAGES) : []
    const drafts = []
    for (const p of pages) {
      const page = await getEditablePage(tx, tenantId, p.id)
      if (page) drafts.push({ page: p, data: page.data })
    }
    return {
      site,
      drafts,
      locks: await pageLocksHeldByOthers(
        tx,
        tenantId,
        ctx.user.id,
        pages.map((p) => p.id),
      ),
      facts: await loadSiteFacts(tx, tenantId),
    }
  })
  if (!loaded.site || !loaded.drafts.length)
    return fail('Choose a template first: there are no pages to write yet.')

  const result: WriteTextsResult = { pages: [], skipped: [] }
  const jobs: Job[] = []
  for (const { page, data } of loaded.drafts) {
    const title = page.slug === '' ? 'Home' : page.title.en || `/${page.slug}`
    const lock = loaded.locks.get(page.id)
    if (lock) {
      result.skipped.push({ title, reason: `open in ${lock.holderName}'s editor` })
      continue
    }
    const slots = textSlots(data, schema)
    if (!slots.length) result.skipped.push({ title, reason: 'no texts to write' })
    else jobs.push({ id: page.id, title, slug: page.slug, slots })
  }
  const siteMap = loaded.drafts.map(({ page }) => ({ slug: page.slug, title: page.title.en || page.slug }))
  const label = `Before Write texts ${dubaiStamp()}`
  const deadline = Date.now() + DEADLINE_MS
  let calls = 0
  let costUsd = 0
  let stop: string | null = null

  /** Writes one page's drafts in its own transaction (locks re-checked; an edit made during the run wins). */
  const save = async (job: Job, drafts: TextDraft[]) => {
    try {
      const reason = await withTenant(tenantId, async (tx) => {
        await lockSite(tx, tenantId)
        await assertPagesUnlocked(tx, { tenantId, pageIds: [job.id], userId: ctx.user.id })
        const current = await getEditablePage(tx, tenantId, job.id)
        if (!current) return 'page was deleted'
        const out = fillTextSlots(current.data, job.slots, drafts)
        if (!out.filled) return 'edited meanwhile — nothing written'
        if (
          designSignature(out.data) !== designSignature(current.data) ||
          JSON.stringify(out.data).length > MAX_PAGE_BYTES
        )
          return 'the texts did not fit this page'
        // A hand-written working draft stays restorable from the editor's Versions.
        if (current.version?.status === 'draft' && !current.version.label)
          await labelVersion(tx, tenantId, current.version.id, label)
        await saveDraft(tx, { tenantId, pageId: job.id, data: out.data, userId: ctx.user.id })
        result.pages.push({ id: job.id, slug: job.slug, title: job.title, filled: out.filled })
        return null
      })
      if (reason) result.skipped.push({ title: job.title, reason })
    } catch (e) {
      if (!(e instanceof PageLockedError)) throw e
      result.skipped.push({ title: job.title, reason: `open in ${e.lock.holderName}'s editor` })
    }
  }

  const queue = [...jobs]
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const drafts: TextDraft[] = []
      let failed = false
      for (const slots of chunks(job.slots, SLOTS_PER_CALL)) {
        if (stop || Date.now() > deadline || calls >= MAX_CALLS) break
        calls++
        try {
          const r = await planSiteTexts({
            tenantId,
            facts: loaded.facts,
            notes,
            page: { slug: job.slug, title: job.title },
            siteMap,
            slots,
            client: fixtureClient(slug),
          })
          drafts.push(...r.texts)
          costUsd += r.costUsd
        } catch (e) {
          if (e instanceof AiBudgetExceededError) stop = 'The monthly AI budget for this spa is used up.'
          else if (e instanceof AiDisabledError)
            stop = 'AI site editing is switched off in the AI model settings.'
          else console.error('write texts failed', e)
          failed = true
          break
        }
      }
      if (drafts.length) await save(job, drafts)
      else
        result.skipped.push({
          title: job.title,
          reason: failed && !stop ? 'the AI reply could not be read — run again' : RUN_AGAIN,
        })
    }
  }
  await Promise.all([worker(), worker()])
  // Two pages run at a time: report them in menu order.
  const order = new Map(jobs.map((j, i) => [j.id, i]))
  result.pages.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))

  await audit({
    tenantId,
    actorUserId: ctx.user.id,
    impersonatorUserId: ctx.impersonating ? ctx.user.id : undefined,
    action: 'site.ai_texts_written',
    entity: 'site',
    entityId: loaded.site.id,
    data: {
      via: 'studio_write_texts',
      pages: result.pages.map((p) => ({ id: p.id, slug: p.slug, filled: p.filled })),
      skipped: result.skipped,
      notes: Boolean(notes),
      costUsd,
    },
  })
  if (result.pages.length) revalidateStudio(slug)

  const skipped = result.skipped.length
    ? ` Skipped: ${result.skipped.map((s) => `${s.title} (${s.reason})`).join(', ')}.`
    : ''
  if (!result.pages.length) return fail(stop ?? `No texts were written.${skipped}`)
  const n = result.pages.length
  return ok(
    `Drafted texts for ${n} ${n === 1 ? 'page' : 'pages'} in English and Arabic (${result.pages
      .map((p) => `${p.title} ${p.filled}`)
      .join(
        ', ',
      )}).${skipped}${stop ? ` ${stop}` : ''} Nothing is published — read each page, adjust, then Publish.`,
    result,
  )
}
