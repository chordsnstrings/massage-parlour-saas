// R23 "Write texts" (moved from the console's write-texts-actions in R28 P5, so the web and the worker run the same
// loop): the site_editor agent drafts the texts of a spa's pages in EN + AR from the spa's own data. Text props only
// (images, links, structure and styles stay), written to the DRAFTS: published versions are never touched and nothing
// publishes. The same editor locks apply (a page open in someone else's editor is skipped). R28 P4: an HTML-design
// page gets its website content written (data texts + page texts, EN + AR; its file never changes). R28 P5 (owner
// D5): a template apply / upgrade queues a run on `sites.text_run` (`queueSiteTexts`); `runQueuedSiteTexts` claims and
// runs it (web `after()`, worker `site-texts-queue`) with the gate re-checked: SITE_AI_EDITOR_EMAILS + 2FA.
import {
  crmAddress,
  crmDesignData,
  dubaiParts,
  type HtmlDesignContent,
  htmlContentLeftovers,
  htmlCrmContractOf,
  htmlDesignDocOf,
  listHtmlDesignTexts,
} from '@spa/core'
import {
  auditLog,
  platformDb,
  type SiteTextRun,
  siteAiEditorStatus,
  sites,
  type Tx,
  withTenant,
} from '@spa/db'
import {
  assertPagesUnlocked,
  getEditablePage,
  getSite,
  HTML_DESIGN_BLOCK,
  htmlDesignContentErrors,
  htmlDesignSource,
  keepTemplateUndo,
  labelVersion,
  listPages,
  lockSite,
  PageLockedError,
  pageLocksHeldByOthers,
  saveDraft,
  spaHtmlDocReader,
  switchWrote,
} from '@spa/services'
import {
  fillTextSlots,
  htmlTextSlots,
  type SiteEditSchema,
  type TextDraft,
  type TextScope,
  type TextSlot,
  textSlots,
} from '@spa/services/site-kit'
import { and, eq, sql } from 'drizzle-orm'
import { loadSiteFacts, planSiteTexts } from './agents/site-edit'
import { AiBudgetExceededError, AiDisabledError } from './gateway'
import type { ModelArkClient } from './modelark'

const MAX_PAGES = 12
const SLOTS_PER_CALL = 40
const MAX_CALLS = 24
const DEADLINE_MS = 150_000
const MAX_PAGE_BYTES = 512 * 1024
const RUN_AGAIN = 'not written — run again'
/** A queued run left `running` longer than this was cut off (a restart): the sweep queues it again. */
const STALE_MS = 15 * 60_000
/** A queued run the web didn't start within this goes to the worker's sweep. */
const SWEEP_AFTER_MS = 3 * 60_000
/** One run per spa at a time (this process; globalThis: the web's route and action bundles share it). */
const g = globalThis as unknown as { __spaSiteTextsRunning?: Set<string> }
g.__spaSiteTextsRunning ??= new Set<string>()
export const siteTextsRunning: Set<string> = g.__spaSiteTextsRunning

type Job = {
  id: string
  title: string
  slug: string
  slots: TextSlot[]
  /** HTML-design page: its design document (the save re-checks it). */
  html?: { docKey: string | null }
  /** Slot keys whose text still names another spa, city, phone or test copy (listed first). */
  leftovers: string[]
}
type DesignNode = { type?: unknown; props?: Record<string, unknown> }
export type SiteTextsResult = {
  pages: { id: string; slug: string; title: string; filled: number }[]
  skipped: { title: string; reason: string }[]
}
export type SiteTextsRun = {
  /** null: the spa has no site or no pages yet (nothing ran; `stop` says so). */
  siteId: string | null
  result: SiteTextsResult
  costUsd: number
  stop: string | null
  notes: boolean
}

export const NO_SITE_PAGES = 'Choose a template first: there are no pages to write yet.'

const chunks = <T>(list: T[], size: number) =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size))

/** The page's HtmlDesign block (R28 P4), if any. */
const htmlDesignNode = (data: unknown) => {
  const content = (data as { content?: unknown } | null)?.content
  return Array.isArray(content)
    ? (content as DesignNode[]).find((n) => n?.type === HTML_DESIGN_BLOCK && n.props)
    : undefined
}
/** R30: Draft fixes may also write a page's root title / description (an HTML design's fallback head). */
const withoutSeoRoot = (data: unknown) => {
  const d = data as { root?: { props?: Record<string, unknown> } } | null
  if (!d?.root?.props) return data
  const { title: _title, description: _description, ...props } = d.root.props
  return { ...d, root: { ...d.root, props } }
}
/** The page without its HtmlDesign website content (the only part Write texts changes there). */
const withoutHtmlContent = (data: unknown) => {
  const d = data as { content?: unknown } | null
  if (!Array.isArray(d?.content)) return data
  return {
    ...d,
    content: (d.content as DesignNode[]).map((n) => {
      if (n?.type !== HTML_DESIGN_BLOCK || !n.props) return n
      const { content: _content, ...props } = n.props
      return { ...n, props }
    }),
  }
}
/** An HTML-design page's design source + document key (null source: missing). */
async function designOf(tx: Tx, tenantId: string, data: unknown) {
  const node = htmlDesignNode(data)
  if (!node?.props) return null
  const doc = htmlDesignDocOf(node.props)
  return {
    node,
    source: await htmlDesignSource(node.props, spaHtmlDocReader(tx, tenantId)),
    docKey: doc ? `${doc.file}:${doc.sha256}` : null,
    sha256: doc?.sha256 ?? null,
  }
}

function dubaiStamp(now = new Date()) {
  const p = dubaiParts(now)
  return `${p.date} ${String(Math.floor(p.minutes / 60)).padStart(2, '0')}:${String(p.minutes % 60).padStart(2, '0')}`
}

/**
 * Drafts the texts of the spa's pages (all, or `pageIds`) and saves them as drafts. Block pages need `schema` (web:
 * `siteEditSchema()`; without it, or with `htmlOnly`, only HTML-design pages run). `onlyDefaults` leaves what the
 * spa already wrote; `designSha` skips a page whose draft uses another design file; `keepUndo` keeps a template switch's
 * undo available (no "Before Write texts" label over the switch's own draft, `keepTemplateUndo` after the save).
 * R30: `scope: 'seo'` (Draft fixes after the search check) writes only the search fields (site-kit `TextScope`).
 * Never audits or revalidates (the callers do).
 */
export async function runSiteTexts(opts: {
  tenantId: string
  slug: string
  userId: string
  notes?: string
  pageIds?: string[]
  htmlOnly?: boolean
  onlyDefaults?: boolean
  keepUndo?: boolean
  designSha?: string
  scope?: TextScope
  schema?: SiteEditSchema
  /** Block pages' design check (web: designSignature); default JSON.stringify. */
  signature?: (data: unknown) => string
  client?: ModelArkClient
}): Promise<SiteTextsRun> {
  const { tenantId, notes } = opts
  const signature = opts.signature ?? ((d: unknown) => JSON.stringify(d))
  const loaded = await withTenant(tenantId, async (tx) => {
    const site = await getSite(tx, tenantId)
    const all = site ? await listPages(tx, tenantId) : []
    const pages = (opts.pageIds ? all.filter((p) => opts.pageIds!.includes(p.id)) : all).slice(0, MAX_PAGES)
    const drafts = []
    for (const p of pages) {
      const page = await getEditablePage(tx, tenantId, p.id)
      if (page) drafts.push({ page: p, data: page.data, design: await designOf(tx, tenantId, page.data) })
    }
    return {
      site,
      drafts,
      siteMap: all.slice(0, MAX_PAGES).map((p) => ({ slug: p.slug, title: p.title.en || p.slug })),
      locks: await pageLocksHeldByOthers(
        tx,
        tenantId,
        opts.userId,
        pages.map((p) => p.id),
      ),
      facts: await loadSiteFacts(tx, tenantId),
    }
  })
  const result: SiteTextsResult = { pages: [], skipped: [] }
  if (!loaded.site || !loaded.drafts.length)
    return { siteId: null, result, costUsd: 0, stop: NO_SITE_PAGES, notes: Boolean(notes) }

  const jobs: Job[] = []
  const city = crmAddress(loaded.facts.branches[0]?.address ?? '').city
  for (const { page, data, design } of loaded.drafts) {
    const title = page.slug === '' ? 'Home' : page.title.en || `/${page.slug}`
    // Block pages need the block schema (the Studio's Write texts); D5 runs HTML-design pages only.
    if (!design && (opts.htmlOnly || !opts.schema)) continue
    const lock = loaded.locks.get(page.id)
    if (lock) {
      result.skipped.push({ title, reason: `open in ${lock.holderName}'s editor` })
      continue
    }
    if (opts.designSha && design?.sha256 !== opts.designSha) {
      result.skipped.push({ title, reason: 'the draft uses another design' })
      continue
    }
    const html = design?.source ?? undefined
    const leftovers = new Set<string>()
    if (design && html !== undefined) {
      // R28 P4: texts that still name another spa, city, phone or test copy go first — ahead of the page's slot cap —
      // and are named in the prompt.
      const block = String(design.node.props?.id ?? '')
      for (const l of htmlContentLeftovers(
        crmDesignData(htmlCrmContractOf(html)),
        design.node.props?.content as HtmlDesignContent | undefined,
        {
          spaName: loaded.facts.name,
          city,
          arabic: true,
          page: { texts: listHtmlDesignTexts(html), images: [] },
        },
      ))
        if (l.reason !== 'stale' && l.reason !== 'arabic')
          leftovers.add(`${block}/${l.path.startsWith('text:') ? l.path : `content:${l.path}`}`)
    }
    const slots = design
      ? html === undefined
        ? []
        : htmlTextSlots(data, html, { first: leftovers, onlyDefaults: opts.onlyDefaults, scope: opts.scope })
      : textSlots(data, opts.schema!, { first: leftovers, scope: opts.scope })
    if (!slots.length) result.skipped.push({ title, reason: 'no texts to write' })
    else
      jobs.push({
        id: page.id,
        title,
        slug: page.slug,
        slots,
        ...(design ? { html: { docKey: design.docKey } } : {}),
        leftovers: slots.filter((s) => leftovers.has(s.key)).map((s) => s.key),
      })
  }
  const label = `Before Write texts ${dubaiStamp()}`
  const deadline = Date.now() + DEADLINE_MS
  // Bounds calls already running at the deadline too (runChat → ModelArk fetch).
  const signal = AbortSignal.timeout(DEADLINE_MS)
  let calls = 0
  let costUsd = 0
  let stop: string | null = null

  /**
   * Writes one page's drafts in its own transaction (locks re-checked; an edit made during the run wins). Never
   * throws: a page that can't be saved is reported, and the other pages (and the audit) go on.
   */
  const save = async (job: Job, drafts: TextDraft[]) => {
    try {
      const outcome = await withTenant(tenantId, async (tx): Promise<number | string> => {
        await lockSite(tx, tenantId)
        await assertPagesUnlocked(tx, { tenantId, pageIds: [job.id], userId: opts.userId })
        const current = await getEditablePage(tx, tenantId, job.id)
        if (!current) return 'page was deleted'
        let html: string | undefined
        if (job.html) {
          const design = await designOf(tx, tenantId, current.data)
          if (!design || design.source === null || design.docKey !== job.html.docKey)
            return 'the design changed meanwhile — nothing written'
          html = design.source
        }
        const out = fillTextSlots(current.data, job.slots, drafts, { html, scope: opts.scope })
        if (!out.filled) return 'edited meanwhile — nothing written'
        const shape = (d: unknown) =>
          signature(withoutHtmlContent(opts.scope === 'seo' ? withoutSeoRoot(d) : d))
        if (
          shape(out.data) !== shape(current.data) ||
          JSON.stringify(out.data).length > MAX_PAGE_BYTES ||
          (job.html && (await htmlDesignContentErrors(tx, tenantId, out.data)).length)
        )
          return 'the texts did not fit this page'
        // R28 P5: what a template switch / upgrade just wrote is saved over without a label (its undo stays).
        const undo = opts.keepUndo ? (await getSite(tx, tenantId))?.templateUndo : null
        const wrote = !!current.version && switchWrote(undo, job.id, current.version)
        // A hand-written working draft stays restorable from the editor's Versions.
        if (!wrote && current.version?.status === 'draft' && !current.version.label)
          await labelVersion(tx, tenantId, current.version.id, label)
        const written = await saveDraft(tx, { tenantId, pageId: job.id, data: out.data, userId: opts.userId })
        if (wrote && current.version) await keepTemplateUndo(tx, tenantId, job.id, current.version, written)
        return out.filled
      })
      if (typeof outcome === 'string') result.skipped.push({ title: job.title, reason: outcome })
      else result.pages.push({ id: job.id, slug: job.slug, title: job.title, filled: outcome })
    } catch (e) {
      if (e instanceof PageLockedError)
        result.skipped.push({ title: job.title, reason: `open in ${e.lock.holderName}'s editor` })
      else {
        console.error('write texts save failed', e)
        result.skipped.push({ title: job.title, reason: 'could not be saved — run again' })
      }
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
            siteMap: loaded.siteMap,
            slots,
            ...(job.html
              ? { htmlDesign: true, leftovers: job.leftovers.filter((k) => slots.some((s) => s.key === k)) }
              : {}),
            ...(opts.scope === 'seo' ? { seo: true } : {}),
            client: opts.client,
            signal,
          })
          drafts.push(...r.texts)
          costUsd += r.costUsd
        } catch (e) {
          if (e instanceof AiBudgetExceededError) stop = 'The monthly AI budget for this spa is used up.'
          else if (e instanceof AiDisabledError)
            stop = 'AI site editing is switched off in the AI model settings.'
          // Out of time (the deadline aborted the call): "run again", like the pages not started.
          else if (!signal.aborted) {
            console.error('write texts failed', e)
            failed = true
          }
          break
        }
      }
      if (drafts.length) await save(job, drafts)
      else
        result.skipped.push({
          title: job.title,
          reason: failed ? 'the AI reply could not be read — run again' : RUN_AGAIN,
        })
    }
  }
  // Both workers finish before the caller audits (and before the per-spa slot frees up).
  for (const r of await Promise.allSettled([worker(), worker()]))
    if (r.status === 'rejected') console.error('write texts failed', r.reason)
  // Two pages run at a time: report them in menu order.
  const order = new Map(jobs.map((j, i) => [j.id, i]))
  result.pages.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
  return { siteId: loaded.site.id, result, costUsd, stop, notes: Boolean(notes) }
}

/** "Skipped: Home (reason), …" (console English) or ''. */
export const siteTextsSkipped = (result: SiteTextsResult) =>
  result.skipped.length
    ? ` Skipped: ${result.skipped.map((s) => `${s.title} (${s.reason})`).join(', ')}.`
    : ''

const finish = (tenantId: string, patch: Partial<SiteTextRun>) =>
  platformDb()
    .update(sites)
    .set({ textRun: sql`${sites.textRun} || ${JSON.stringify(patch)}::jsonb` })
    .where(and(eq(sites.tenantId, tenantId), sql`${sites.textRun}->>'state' = 'running'`))

/**
 * Claims the spa's queued Write texts run (one claim wins, also across processes) and runs it on its pages:
 * HTML-design pages only, never over what the spa wrote, undo kept, the design it was queued for. The gate is checked
 * again for the super-admin who queued it (SITE_AI_EDITOR_EMAILS + 2FA) and ModelArk must be set up (or `client`).
 * Audited like the console's Write texts; returns the finished run, or null when nothing was queued.
 */
export async function runQueuedSiteTexts(
  tenantId: string,
  opts: { client?: ModelArkClient } = {},
): Promise<SiteTextRun | null> {
  if (siteTextsRunning.has(tenantId)) return null
  const startedAt = new Date().toISOString()
  const [claimed] = await platformDb()
    .update(sites)
    .set({
      textRun: sql`${sites.textRun} || ${JSON.stringify({ state: 'running', startedAt })}::jsonb`,
    })
    .where(and(eq(sites.tenantId, tenantId), sql`${sites.textRun}->>'state' = 'queued'`))
    .returning({ id: sites.id, run: sites.textRun })
  const run = claimed?.run
  if (!claimed || !run) return null
  siteTextsRunning.add(tenantId)
  const done = async (patch: Partial<SiteTextRun>) => {
    const end = { ...patch, finishedAt: new Date().toISOString() }
    await finish(tenantId, end)
    return { ...run, ...end } as SiteTextRun
  }
  try {
    if ((await siteAiEditorStatus(platformDb(), run.actorUserId)) !== 'ok')
      return await done({ state: 'skipped', summary: 'needs SITE_AI_EDITOR_EMAILS + 2FA' })
    if (!process.env.ARK_API_KEY && !opts.client)
      return await done({ state: 'skipped', summary: 'AI writing isn’t set up' })
    const [tenant] = await platformDb()
      .execute<{ slug: string }>(sql`select slug from tenants where id = ${tenantId}`)
      .then((r) => r.rows)
    const out = await runSiteTexts({
      tenantId,
      slug: tenant?.slug ?? '',
      userId: run.actorUserId,
      pageIds: run.pageIds,
      htmlOnly: true,
      onlyDefaults: true,
      keepUndo: true,
      designSha: run.designSha,
      scope: run.scope,
      client: opts.client,
    })
    await platformDb()
      .insert(auditLog)
      .values({
        tenantId,
        actorUserId: run.actorUserId,
        action: 'site.ai_texts_written',
        entity: 'site',
        entityId: claimed.id,
        ip: null,
        data: {
          via: run.via,
          pages: out.result.pages.map((p) => ({ id: p.id, slug: p.slug, filled: p.filled })),
          skipped: out.result.skipped,
          costUsd: out.costUsd,
        },
      })
    const n = out.result.pages.length
    const skipped = siteTextsSkipped(out.result)
    if (!n)
      return await done({
        state: 'failed',
        summary: `${out.stop ?? 'No texts were written.'}${skipped}`.trim().slice(0, 600),
      })
    return await done({
      state: 'done',
      summary: `Drafted texts for ${n} ${n === 1 ? 'page' : 'pages'} in English and Arabic (${out.result.pages
        .map((p) => `${p.title} ${p.filled}`)
        .join(', ')}).${skipped}${out.stop ? ` ${out.stop}` : ''} Nothing is published.`.slice(0, 600),
    })
  } catch (e) {
    console.error('queued write texts failed', e)
    return await done({ state: 'failed', summary: 'could not run — use Write texts' }).catch(() => null)
  } finally {
    siteTextsRunning.delete(tenantId)
  }
}

/**
 * Worker (`site-texts-queue`): runs queued Write texts the web didn't start (queued over 3 minutes ago) and queues
 * again runs cut off while running (started over 15 minutes ago); at most `limit` a tick, one after another.
 */
export async function sweepSiteTexts(opts: { limit?: number } = {}): Promise<number> {
  const db = platformDb()
  const stale = new Date(Date.now() - STALE_MS).toISOString()
  await db
    .update(sites)
    .set({ textRun: sql`${sites.textRun} || ${JSON.stringify({ state: 'queued' })}::jsonb` })
    .where(
      sql`${sites.textRun}->>'state' = 'running' and (${sites.textRun}->>'startedAt')::timestamptz < ${stale}::timestamptz`,
    )
  const before = new Date(Date.now() - SWEEP_AFTER_MS).toISOString()
  const due = await db
    .select({ tenantId: sites.tenantId })
    .from(sites)
    .where(
      sql`${sites.textRun}->>'state' = 'queued' and (${sites.textRun}->>'at')::timestamptz < ${before}::timestamptz`,
    )
    .orderBy(sql`${sites.textRun}->>'at'`)
    .limit(opts.limit ?? 3)
  let ran = 0
  for (const d of due) if (await runQueuedSiteTexts(d.tenantId)) ran++
  return ran
}
