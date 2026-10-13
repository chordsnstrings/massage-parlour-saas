// R28 P5 (owner D4): a new version of an uploaded HTML template rolled out to the spas still on an older one. The
// rollout is the sign-off: each spa's live pages move to the new file at once (their own published rows; their edits
// carried by core `carryHtmlContent`, a spa's own v1 look pinned as its content), their drafts carried after them, and
// one undo per spa for all of them (`templateUndo.live`, which sets `template_hold`). Finder: platform role
// (cross-tenant reads only); the upgrade: inside the spa's own tenant transaction, all of its pages or none.
import {
  carryHtmlContent,
  crmContractVersion,
  crmDesignData,
  type HtmlContentCarry,
  type HtmlContentCarryDrop,
  type HtmlDesignDoc,
  type HtmlImageAdjust,
  htmlContentErrors,
  htmlContentFrom,
  htmlContentParts,
  htmlContentSlots,
  htmlCrmContractOf,
  htmlDesignDocOf,
  htmlDesignOwnPins,
  htmlDesignPhoneFixes,
  isOwnDesign,
} from '@spa/core'
import { type Db, pageVersions, sites, type TemplateHold, type TemplateUndo, type Tx } from '@spa/db'
import { and, eq, sql } from 'drizzle-orm'
import { sniffImageType } from './media'
import { HTML_DESIGN_BLOCK, htmlDesignContentErrors } from './site-edit'
import {
  type HtmlDocReader,
  htmlDesignAsset,
  htmlDesignSource,
  spaHtmlDocReader,
  templateHtmlDocReader,
  tenantHtmlAssetSink,
} from './site-html-assets'
import { mergeHtmlImageAdjustments, repointHtmlImageAdjustments } from './site-kit/html-images'
import { assertPagesUnlocked, PageLockedError } from './site-locks'
import { getStudioTemplate, type StudioTemplateRow, templateDocOf } from './site-templates'
import {
  getSite,
  insertVersion,
  latestVersion,
  lockSite,
  type PageData,
  type PageVersionRow,
  type PreparePageData,
  preparedPages,
  queueSiteTexts,
  type SiteRow,
  type SiteTemplate,
  skipSiteTexts,
} from './sites'

export type RolloutPage = {
  pageId: string
  liveVersionId: string
  sha256: string
  /** The live HtmlDesign block's website content. */
  content: unknown
  /** The live block's picture adjustments and Phone fixes switch (kept where the new version sets none). */
  images: HtmlImageAdjust[]
  phoneFixes: boolean
  /** The old design was made for this spa (its own look; Write texts is skipped there). */
  own: boolean
  /** The page's newest version is a draft. */
  hasDraft: boolean
}
/** One spa to upgrade: every visible page still live on an older version (switched together, one undo). */
export type RolloutSpa = {
  tenantId: string
  slug: string
  name: string
  pages: RolloutPage[]
  /** Some page's old design was made for this spa. */
  own: boolean
  /** Some page has a draft waiting. */
  hasDraft: boolean
}
export type RolloutSkip = {
  tenantId: string
  slug: string
  name: string
  /** changed: its live file differs (patched, localised or another design); not-live: never published; held: undone. */
  reason: 'changed' | 'not-live' | 'held'
}

type Row = {
  tenant_id: string
  slug: string
  name: string
  template_hold: TemplateHold | null
  page_id: string | null
  version_id: string | null
  sha: string | null
  content: unknown
  images: unknown
  phone_fixes: unknown
  has_draft: boolean | null
}

const textArray = (list: string[]) => sql`${`{${list.join(',')}}`}::text[]`
const SHA = /^[0-9a-f]{64}$/

/** Live HtmlDesign blocks of the spas' visible pages (the lateral newest-published pattern of exactHtmlDesignAt). */
const LIVE_DESIGNS = sql`
  left join lateral (
    select sp.id as page_id, v.id as version_id, n.node->'props'->'doc'->>'sha256' as sha,
      n.node->'props'->'content' as content, n.node->'props'->'images' as images,
      n.node->'props'->'phoneFixes' as phone_fixes,
      (select pv2.status = 'draft' from page_versions pv2 where pv2.page_id = sp.id
        order by pv2.created_at desc limit 1) as has_draft
    from site_pages sp
    join lateral (
      select pv.id, pv.data from page_versions pv
      where pv.page_id = sp.id and pv.status = 'published'
      order by pv.created_at desc limit 1
    ) v on true
    join lateral (
      select e as node from jsonb_array_elements(
        case when jsonb_typeof(v.data->'content') = 'array' then v.data->'content' else '[]'::jsonb end
      ) e
      where e->>'type' = 'HtmlDesign' limit 1
    ) n on true
    where sp.site_id = s.id and sp.visible
  ) d on true`

/** The template's design documents by sha (the live one and its history), read once each. */
function templateDocs(row: StudioTemplateRow | null): Map<string, HtmlDesignDoc> {
  const docs = new Map<string, HtmlDesignDoc>()
  const current = row ? templateDocOf(row.pages) : null
  if (current) docs.set(current.sha256, current)
  for (const h of row?.history ?? [])
    if (!docs.has(h.sha256)) docs.set(h.sha256, { file: h.file, sha256: h.sha256, bytes: h.bytes, chars: 0 })
  return docs
}

/**
 * The spas whose LIVE design is an older version of the template (`fromShas`), one entry per spa with every page still
 * on an old version, ready to upgrade; the spas skipped and why (a live file that differs is never overwritten); and
 * how many spas are already on `toSha` alone. A spa counts when its site uses the template (`template_key`) or a
 * live file is one of the old versions.
 */
export async function spasOnTemplateVersions(
  db: Db,
  input: { key: string; fromShas: string[]; toSha: string; version: number },
): Promise<{ spas: RolloutSpa[]; skipped: RolloutSkip[]; current: number }> {
  const from = input.fromShas.filter((s) => SHA.test(s))
  const { rows } = await db.execute<Row>(sql`
    select t.id as tenant_id, t.slug, t.name, s.template_hold, d.page_id, d.version_id, d.sha, d.content,
      d.images, d.phone_fixes, d.has_draft
    from tenants t
    join sites s on s.tenant_id = t.id
    ${LIVE_DESIGNS}
    where t.status <> 'cancelled'
      and (s.template_key = ${input.key} or d.sha = any(${textArray(from)}))
    order by t.name, t.id, d.page_id`)
  const spas: RolloutSpa[] = []
  const skipped: RolloutSkip[] = []
  let current = 0
  const skip = (r: Row, reason: RolloutSkip['reason']) =>
    skipped.push({ tenantId: r.tenant_id, slug: r.slug, name: r.name, reason })
  // `own`: the old design's data (one read per old file) made for this spa.
  const docs = templateDocs(await getStudioTemplate(db, { key: input.key }))
  const read = templateHtmlDocReader(db)
  const oldData = new Map<string, Promise<Record<string, unknown> | null>>()
  const dataOf = (sha: string) => {
    let hit = oldData.get(sha)
    if (!hit) {
      const doc = docs.get(sha)
      hit = doc
        ? read(doc).then((html) => (html ? crmDesignData(htmlCrmContractOf(html)) : null))
        : Promise.resolve(null)
      oldData.set(sha, hit)
    }
    return hit
  }
  const byTenant = new Map<string, Row[]>()
  for (const r of rows) byTenant.set(r.tenant_id, [...(byTenant.get(r.tenant_id) ?? []), r])
  for (const list of byTenant.values()) {
    const first = list[0]!
    const live = list.filter((r) => r.page_id && r.version_id && r.sha)
    const old = live.filter((r) => from.includes(r.sha!))
    if (!live.length) skip(first, 'not-live')
    else if (!old.length) {
      // Nothing left on an older version: on the new one, or (only) on files of its own.
      if (live.some((r) => r.sha === input.toSha)) current++
      else skip(first, 'changed')
    } else if (first.template_hold?.key === input.key && Number(first.template_hold.version) >= input.version)
      skip(first, 'held')
    else {
      const pages: RolloutPage[] = []
      for (const r of old)
        pages.push({
          pageId: r.page_id!,
          liveVersionId: r.version_id!,
          sha256: r.sha!,
          content: r.content ?? undefined,
          images: Array.isArray(r.images) ? (r.images as HtmlImageAdjust[]) : [],
          phoneFixes: htmlDesignPhoneFixes({ phoneFixes: r.phone_fixes ?? undefined }),
          own: isOwnDesign(await dataOf(r.sha!), r.name),
          hasDraft: r.has_draft === true,
        })
      spas.push({
        tenantId: first.tenant_id,
        slug: first.slug,
        name: first.name,
        pages,
        own: pages.some((p) => p.own),
        hasDraft: pages.some((p) => p.hasDraft),
      })
    }
  }
  return { spas, skipped, current }
}

/**
 * Per studio HTML template key: how many spas' live designs are on its current file and on its older versions (the
 * console list; holds are not subtracted — the roll-out sheet lists each spa).
 */
export async function templateRolloutCounts(
  db: Db,
  rows: Pick<StudioTemplateRow, 'key' | 'pages' | 'history'>[],
): Promise<Map<string, { current: number; older: number }>> {
  const out = new Map<string, { current: number; older: number }>()
  const shas = new Set<string>()
  for (const r of rows) {
    const doc = templateDocOf(r.pages)
    if (!doc) continue
    shas.add(doc.sha256)
    for (const h of r.history ?? []) shas.add(h.sha256)
  }
  const list = [...shas].filter((s) => SHA.test(s))
  if (!list.length) return out
  const { rows: counts } = await db.execute<{ sha: string; n: number }>(sql`
    select d.sha, count(distinct t.id)::int as n
    from tenants t
    join sites s on s.tenant_id = t.id
    ${LIVE_DESIGNS}
    where t.status <> 'cancelled' and d.sha = any(${textArray(list)})
    group by d.sha`)
  const bySha = new Map(counts.map((c) => [c.sha, Number(c.n)]))
  for (const r of rows) {
    const doc = templateDocOf(r.pages)
    if (!doc) continue
    out.set(r.key, {
      current: bySha.get(doc.sha256) ?? 0,
      older: (r.history ?? [])
        .filter((h) => h.sha256 !== doc.sha256)
        .reduce((n, h) => n + (bySha.get(h.sha256) ?? 0), 0),
    })
  }
  return out
}

/* ------------------------------------------------------------------ The upgrade (one spa, its own transaction) */

export type PageUpgrade = {
  pageId: string
  /** carried: the draft was on the old file too and moved with it; kept: on another design, kept as it was. */
  draft: 'carried' | 'kept' | 'none'
  carried: HtmlContentCarry['carried']
  dropped: HtmlContentCarryDrop[]
  pins: number
}
export type DesignUpgradeSkip = {
  status: 'skipped'
  reason: 'locked' | 'not-on-version' | 'already' | 'invalid'
  detail?: string
}
export type DesignUpgrade =
  | {
      status: 'switched'
      /** Every page switched (all of the spa's pages on an older version, or none). */
      pages: PageUpgrade[]
      /** Totals over `pages`. */
      carried: HtmlContentCarry['carried']
      dropped: HtmlContentCarryDrop[]
      pins: number
      /** The spa's copy of the new design file. */
      designSha: string
    }
  | DesignUpgradeSkip

type Node = { type?: unknown; props?: Record<string, unknown> }
const htmlNode = (data: unknown): Node | undefined => {
  const content = (data as { content?: unknown } | null)?.content
  return Array.isArray(content)
    ? (content as Node[]).find((n) => n?.type === HTML_DESIGN_BLOCK && n.props)
    : undefined
}
const withNode = (data: PageData, from: Node, to: Node): PageData => ({
  ...data,
  content: (data.content as Node[]).map((n) => (n === from ? to : n)),
})

/** A `data:image/*` URI's bytes (null when it is not one). */
function dataUrlBytes(url: string): Buffer | null {
  const m = /^data:image\/[\w.+-]+(;[\w=.+-]+)*?(;base64)?,/i.exec(url)
  if (!m) return null
  const body = url.slice(m[0].length)
  try {
    return m[2] ? Buffer.from(body, 'base64') : Buffer.from(decodeURIComponent(body), 'utf8')
  } catch {
    return null
  }
}

/**
 * A block's website content on the new file: carried (core `carryHtmlContent`), then the spa's own v1 look pinned
 * (`htmlDesignOwnPins`; embedded pictures stored as this spa's files).
 */
async function carriedContent(
  tx: Tx,
  input: {
    tenantId: string
    userId: string
    tenantName: string
    oldProps: Record<string, unknown>
    newHtml: string
    newData: Record<string, unknown> | null
    read: HtmlDocReader
  },
) {
  const oldHtml = await htmlDesignSource(input.oldProps, input.read)
  const oldData = oldHtml ? crmDesignData(htmlCrmContractOf(oldHtml)) : null
  const carry = carryHtmlContent(input.oldProps.content, input.newData, input.newHtml, oldHtml ?? undefined)
  const pins = htmlDesignOwnPins(oldData, input.newData, input.tenantName, carry.content)
  const parts = htmlContentParts(carry.content)
  for (const v of pins.values) if (!(v.path in parts.values)) parts.values[v.path] = v.value
  const sink = tenantHtmlAssetSink(tx, input.tenantId, input.userId)
  let stored = 0
  for (const f of pins.files) {
    if (f.path in parts.values) continue
    const bytes = dataUrlBytes(f.dataUrl)
    const type = bytes ? sniffImageType(new Uint8Array(bytes)) : null
    if (!bytes || !type) continue
    const id = await sink(htmlDesignAsset(bytes, type))
    parts.values[f.path] = { img: `/files/${id}` }
    stored++
  }
  return {
    content: htmlContentFrom(parts),
    carry,
    pins: pins.values.length + stored,
    own: isOwnDesign(oldData, input.tenantName),
  }
}

/** An adjustment compared by value (key order ignored). */
const adjustKey = (a: HtmlImageAdjust) =>
  JSON.stringify(Object.entries(a as Record<string, unknown>).sort(([x], [y]) => (x < y ? -1 : 1)))

/**
 * A block's props on the new file: block id, its other props and the spa's content kept. Phone fixes and picture
 * adjustments the spa only inherited from the old version (`fromProps`, equal to it) follow the new version; the
 * spa's own (different from the old version, or no old version known) are kept: Phone fixes on, adjustments for every
 * picture still in the new file (re-pointed by `src`) that the new version sets none for.
 */
export const upgradedProps = (
  oldProps: Record<string, unknown>,
  prepared: Node,
  content: unknown,
  newHtml: string,
  fromProps?: Record<string, unknown> | null,
) => {
  const { content: _old, ...rest } = oldProps
  const p = prepared.props ?? {}
  const inherited = new Set(
    fromProps && Array.isArray(fromProps.images)
      ? (fromProps.images as HtmlImageAdjust[]).map(adjustKey)
      : [],
  )
  const own = (Array.isArray(oldProps.images) ? (oldProps.images as HtmlImageAdjust[]) : []).filter(
    (a) => !inherited.has(adjustKey(a)),
  )
  const ownPhoneFixes =
    !fromProps || htmlDesignPhoneFixes(oldProps) !== htmlDesignPhoneFixes(fromProps)
      ? htmlDesignPhoneFixes(oldProps)
      : false
  const template = Array.isArray(p.images) ? (p.images as HtmlImageAdjust[]) : []
  return {
    ...rest,
    html: typeof p.html === 'string' ? p.html : '',
    doc: p.doc,
    images: mergeHtmlImageAdjustments(template, repointHtmlImageAdjustments(own, newHtml)),
    phoneFixes: p.phoneFixes === true || ownPhoneFixes,
    ...(content ? { content } : {}),
  }
}

type Target = {
  pageId: string
  live: PageVersionRow
  latest: PageVersionRow
  oldNode: Node & { props: Record<string, unknown> }
  sha: string
}

/** Rolls the savepoint back: a page whose content would not fit leaves the whole spa as it was. */
class UpgradeSkipped extends Error {
  constructor(readonly result: DesignUpgradeSkip) {
    super(result.reason)
  }
}

type UpgradeInput = {
  template: SiteTemplate
  /** The old version's block props (Phone fixes / adjustments a spa only inherited follow the new version); null = unknown. */
  fromProps?: Record<string, unknown> | null
  /** The spa's pages to switch (every one still live on an old version is switched, or none). */
  pageIds: string[]
  fromShas: string[]
  toSha: string
  version: number
  userId: string
  tenantName: string
  prepare: PreparePageData
  texts: { actorUserId: string } | { skip: string }
}

/**
 * Moves one spa's LIVE pages from an old version of an HTML template (`fromShas`) to the new one (owner D4), all in
 * the caller's tenant transaction: per page a new published row with the new file and the spa's content carried
 * (never `publishPage`: draft themes and pending renames stay unpublished) and its draft carried and moved after it;
 * then ONE `templateUndo.live` holding every page, and (contract v2) ONE queued Write texts run for all of them
 * (owner D5; drafts only) unless the old design was the spa's own or `texts.skip` says why not. A page open in
 * someone else's editor, or one whose carried content would not pass the draft checks, leaves the whole spa as it
 * was (skipped, nothing written); pages already on the new file or on another file are left alone.
 */
export async function upgradeHtmlDesignLive(
  tx: Tx,
  tenantId: string,
  input: UpgradeInput,
): Promise<DesignUpgrade> {
  await lockSite(tx, tenantId)
  const pageIds = [...new Set(input.pageIds)]
  try {
    await assertPagesUnlocked(tx, { tenantId, pageIds, userId: input.userId })
  } catch (e) {
    if (e instanceof PageLockedError)
      return { status: 'skipped', reason: 'locked', detail: `open in ${e.lock.holderName}'s editor` }
    throw e
  }
  const site = await getSite(tx, tenantId)
  if (!site) return { status: 'skipped', reason: 'not-on-version' }
  const targets: Target[] = []
  let already = false
  for (const pageId of pageIds) {
    const live = await latestVersion(tx, tenantId, pageId, 'published')
    const latest = await latestVersion(tx, tenantId, pageId)
    const oldNode = htmlNode(live?.data)
    const sha = htmlDesignDocOf(oldNode?.props)?.sha256
    if (!live || !latest || !oldNode?.props || !sha) continue
    if (sha === input.toSha) already = true
    if (input.fromShas.includes(sha))
      targets.push({ pageId, live, latest, oldNode: oldNode as Target['oldNode'], sha })
  }
  if (!targets.length) return { status: 'skipped', reason: already ? 'already' : 'not-on-version' }
  try {
    return await tx.transaction((sp) => switchPages(sp, tenantId, site, targets, input))
  } catch (e) {
    if (e instanceof UpgradeSkipped) return e.result
    throw e
  }
}

async function switchPages(
  tx: Tx,
  tenantId: string,
  site: SiteRow,
  targets: Target[],
  input: UpgradeInput,
): Promise<DesignUpgrade> {
  const read = spaHtmlDocReader(tx, tenantId)
  const pages: PageUpgrade[] = []
  const undoPages: TemplateUndo['pages'] = []
  const ownPages = new Set<string>()
  let designSha = ''
  let v2 = false
  for (const t of targets) {
    // The new file, copied into the spa's own files (as an apply does).
    const prepared = await preparedPages(input.template, input.prepare)
    const newNode = prepared.pages.map((p) => htmlNode(p.data)).find(Boolean)
    const newDoc = htmlDesignDocOf(newNode?.props)
    const newHtml = newNode?.props ? await htmlDesignSource(newNode.props, read) : null
    if (!newNode || !newDoc || newHtml === null)
      throw new UpgradeSkipped({
        status: 'skipped',
        reason: 'invalid',
        detail: 'the new design file is missing',
      })
    designSha = newDoc.sha256
    const newData = crmDesignData(htmlCrmContractOf(newHtml))
    v2 ||= crmContractVersion(newData) === 2
    const slots = htmlContentSlots(newData)
    const carryInto = async (props: Record<string, unknown>) => {
      const c = await carriedContent(tx, {
        tenantId,
        userId: input.userId,
        tenantName: input.tenantName,
        oldProps: props,
        newHtml,
        newData,
        read,
      })
      return { ...c, props: upgradedProps(props, newNode, c.content, newHtml, input.fromProps) }
    }

    const up = await carryInto(t.oldNode.props)
    if (up.own) ownPages.add(t.pageId)
    const liveData = withNode(t.live.data as PageData, t.oldNode, { ...t.oldNode, props: up.props })
    const problems = [
      ...htmlContentErrors(up.content ?? { v: 1 }, slots),
      ...(await htmlDesignContentErrors(tx, tenantId, liveData)),
    ]
    if (problems.length)
      throw new UpgradeSkipped({ status: 'skipped', reason: 'invalid', detail: problems[0] })
    const published = await insertVersion(tx, {
      tenantId,
      pageId: t.pageId,
      data: liveData,
      status: 'published',
      userId: input.userId,
    })

    // The working draft: on the old file too → carried; else kept as it is. Either way moved after the new live row.
    let draft: PageUpgrade['draft'] = 'none'
    let draftRow: { id: string; createdAt: Date } | null = null
    const latest = t.latest
    if (latest.status === 'draft') {
      const dNode = htmlNode(latest.data)
      const dSha = htmlDesignDocOf(dNode?.props)?.sha256
      let data = latest.data as PageData
      draft = 'kept'
      if (dNode?.props && dSha && input.fromShas.includes(dSha)) {
        const d = await carryInto(dNode.props)
        const next = withNode(data, dNode, { ...dNode, props: d.props })
        if (
          !htmlContentErrors(d.content ?? { v: 1 }, slots).length &&
          !(await htmlDesignContentErrors(tx, tenantId, next)).length
        ) {
          data = next
          draft = 'carried'
        }
      }
      draftRow = await insertVersion(tx, {
        tenantId,
        pageId: t.pageId,
        data,
        status: 'draft',
        userId: latest.createdBy,
      })
      if (!latest.label)
        await tx
          .delete(pageVersions)
          .where(and(eq(pageVersions.tenantId, tenantId), eq(pageVersions.id, latest.id)))
    }
    undoPages.push({
      pageId: t.pageId,
      created: false,
      draft: latest.status === 'draft' ? (latest.data as PageData) : null,
      versionId: published.id,
      savedAt: published.createdAt.toISOString(),
      publishedBefore: t.live.id,
      ...(draftRow ? { draftVersionId: draftRow.id, draftSavedAt: draftRow.createdAt.toISOString() } : {}),
    })
    pages.push({
      pageId: t.pageId,
      draft,
      carried: up.carry.carried,
      dropped: up.carry.dropped,
      pins: up.pins,
    })
  }

  // One undo for every page the switch wrote (Undo puts them all back together).
  const undo: TemplateUndo = {
    templateKey: site.templateKey,
    theme: site.theme,
    appliedTheme: site.theme,
    at: new Date().toISOString(),
    live: { version: input.version, fromSha: targets[0]!.sha, toSha: input.toSha },
    pages: undoPages,
  }
  await tx
    .update(sites)
    .set({ templateKey: input.template.key, templateUndo: undo })
    .where(eq(sites.id, site.id))

  // Owner D5: one Write texts run for the pages on a contract v2 design (drafts only), never on the spa's own design.
  if (v2) {
    const all = pages.map((p) => p.pageId)
    const runFor = all.filter((id) => !ownPages.has(id))
    const run = { via: 'template_upgrade' as const, designSha }
    if ('actorUserId' in input.texts && runFor.length)
      await queueSiteTexts(tx, tenantId, { ...run, pageIds: runFor, actorUserId: input.texts.actorUserId })
    else
      await skipSiteTexts(tx, tenantId, {
        ...run,
        pageIds: all,
        actorUserId: 'actorUserId' in input.texts ? input.texts.actorUserId : input.userId,
        summary: !runFor.length
          ? 'made for this spa'
          : 'skip' in input.texts
            ? input.texts.skip
            : 'not queued',
      })
  }

  const sum = (k: keyof HtmlContentCarry['carried']) => pages.reduce((n, p) => n + p.carried[k], 0)
  return {
    status: 'switched',
    pages,
    carried: {
      values: sum('values'),
      texts: sum('texts'),
      pictures: sum('pictures'),
      converted: sum('converted'),
    },
    dropped: pages.flatMap((p) => p.dropped),
    pins: pages.reduce((n, p) => n + p.pins, 0),
    designSha,
  }
}
