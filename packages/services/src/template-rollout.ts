// R28 P5 (owner D4): a new version of an uploaded HTML template rolled out to the spas still on an older one. The
// rollout is the sign-off: each spa's live page moves to the new file at once (its own published row; its edits
// carried by core `carryHtmlContent`, a spa's own v1 look pinned as its content), its draft carried after it, and
// one undo per spa (`templateUndo.live`, which sets `template_hold`). Finder: platform role (cross-tenant reads only);
// the upgrade: inside the spa's own tenant transaction.
import {
  carryHtmlContent,
  crmContractVersion,
  crmDesignData,
  type HtmlContentCarry,
  type HtmlContentCarryDrop,
  type HtmlDesignDoc,
  htmlContentErrors,
  htmlContentFrom,
  htmlContentParts,
  htmlContentSlots,
  htmlCrmContractOf,
  htmlDesignDocOf,
  htmlDesignOwnPins,
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
import { assertPagesUnlocked, PageLockedError } from './site-locks'
import { getStudioTemplate, type StudioTemplateRow, templateDocOf } from './site-templates'
import {
  getSite,
  insertVersion,
  latestVersion,
  lockSite,
  type PageData,
  type PreparePageData,
  preparedPages,
  queueSiteTexts,
  type SiteTemplate,
  skipSiteTexts,
} from './sites'

export type RolloutSpa = {
  tenantId: string
  slug: string
  name: string
  pageId: string
  liveVersionId: string
  sha256: string
  /** The live HtmlDesign block's website content. */
  content: unknown
  /** The old design was made for this spa (its own look; Write texts is skipped there). */
  own: boolean
  /** The page's newest version is a draft. */
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
  has_draft: boolean | null
}

const textArray = (list: string[]) => sql`${`{${list.join(',')}}`}::text[]`
const SHA = /^[0-9a-f]{64}$/

/** Live HtmlDesign blocks of the spas' visible pages (the lateral newest-published pattern of exactHtmlDesignAt). */
const LIVE_DESIGNS = sql`
  left join lateral (
    select sp.id as page_id, v.id as version_id, n.node->'props'->'doc'->>'sha256' as sha,
      n.node->'props'->'content' as content,
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
 * The spas whose LIVE design is an older version of the template (`fromShas`), ready to upgrade; the ones skipped and
 * why (a spa whose live file differs is never overwritten); and how many are already on `toSha`. A spa counts when
 * its site uses the template (`template_key`) or its live file is one of the old versions.
 */
export async function spasOnTemplateVersions(
  db: Db,
  input: { key: string; fromShas: string[]; toSha: string; version: number },
): Promise<{ spas: RolloutSpa[]; skipped: RolloutSkip[]; current: number }> {
  const from = input.fromShas.filter((s) => SHA.test(s))
  const { rows } = await db.execute<Row>(sql`
    select t.id as tenant_id, t.slug, t.name, s.template_hold, d.page_id, d.version_id, d.sha, d.content,
      d.has_draft
    from tenants t
    join sites s on s.tenant_id = t.id
    ${LIVE_DESIGNS}
    where t.status <> 'cancelled'
      and (s.template_key = ${input.key} or d.sha = any(${textArray(from)}))
    order by t.name, t.id, d.page_id`)
  const spas: RolloutSpa[] = []
  const skipped: RolloutSkip[] = []
  const seen = new Set<string>()
  let current = 0
  const skip = (r: Row, reason: RolloutSkip['reason']) => {
    const key = `${r.tenant_id}:${reason}`
    if (seen.has(key)) return
    seen.add(key)
    skipped.push({ tenantId: r.tenant_id, slug: r.slug, name: r.name, reason })
  }
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
    const live = list.filter((r) => r.page_id && r.version_id && r.sha)
    if (!live.length) {
      skip(list[0]!, 'not-live')
      continue
    }
    for (const r of live) {
      const sha = r.sha!
      if (sha === input.toSha) current++
      else if (!from.includes(sha)) skip(r, 'changed')
      else if (r.template_hold?.key === input.key && Number(r.template_hold.version) >= input.version)
        skip(r, 'held')
      else
        spas.push({
          tenantId: r.tenant_id,
          slug: r.slug,
          name: r.name,
          pageId: r.page_id!,
          liveVersionId: r.version_id!,
          sha256: sha,
          content: r.content ?? undefined,
          own: isOwnDesign(await dataOf(sha), r.name),
          hasDraft: r.has_draft === true,
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

export type DesignUpgrade =
  | {
      status: 'switched'
      pageId: string
      /** carried: the draft was on the old file too and moved with it; kept: on another design, kept as it was. */
      draft: 'carried' | 'kept' | 'none'
      carried: HtmlContentCarry['carried']
      dropped: HtmlContentCarryDrop[]
      pins: number
      /** The spa's copy of the new design file. */
      designSha: string
    }
  | { status: 'skipped'; reason: 'locked' | 'not-on-version' | 'already' | 'invalid'; detail?: string }

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

/** A block's props on the new file (block id, its other props and the spa's content kept). */
const upgradedProps = (oldProps: Record<string, unknown>, prepared: Node, content: unknown) => {
  const { content: _old, ...rest } = oldProps
  const p = prepared.props ?? {}
  return {
    ...rest,
    html: typeof p.html === 'string' ? p.html : '',
    doc: p.doc,
    images: Array.isArray(p.images) ? p.images : [],
    phoneFixes: p.phoneFixes === true,
    ...(content ? { content } : {}),
  }
}

/**
 * Moves one spa's LIVE page from an old version of an HTML template (`fromShas`) to the new one (owner D4): a new
 * published row with the new file and the spa's content carried (never `publishPage`: draft themes and pending
 * renames stay unpublished), its draft carried and moved after it, and `templateUndo.live` for its one-click undo.
 * A page open in someone else's editor, already on the new file, on another file, or whose carried content would not
 * pass the draft checks is skipped (nothing written). With a contract v2 design, Write texts is queued for the page
 * (owner D5; drafts only) unless the old design was the spa's own or `texts.skip` says why not.
 */
export async function upgradeHtmlDesignLive(
  tx: Tx,
  tenantId: string,
  input: {
    template: SiteTemplate
    pageId: string
    fromShas: string[]
    toSha: string
    version: number
    userId: string
    tenantName: string
    prepare: PreparePageData
    texts: { actorUserId: string } | { skip: string }
  },
): Promise<DesignUpgrade> {
  await lockSite(tx, tenantId)
  try {
    await assertPagesUnlocked(tx, { tenantId, pageIds: [input.pageId], userId: input.userId })
  } catch (e) {
    if (e instanceof PageLockedError)
      return { status: 'skipped', reason: 'locked', detail: `open in ${e.lock.holderName}'s editor` }
    throw e
  }
  const site = await getSite(tx, tenantId)
  const live = await latestVersion(tx, tenantId, input.pageId, 'published')
  const latest = await latestVersion(tx, tenantId, input.pageId)
  const oldNode = htmlNode(live?.data)
  const sha = htmlDesignDocOf(oldNode?.props)?.sha256
  if (!site || !live || !latest || !oldNode?.props || !sha)
    return { status: 'skipped', reason: 'not-on-version' }
  if (!input.fromShas.includes(sha))
    return { status: 'skipped', reason: sha === input.toSha ? 'already' : 'not-on-version' }

  // The new file, copied into the spa's own files (as an apply does).
  const prepared = await preparedPages(input.template, input.prepare)
  const newNode = prepared.pages.map((p) => htmlNode(p.data)).find(Boolean)
  const newDoc = htmlDesignDocOf(newNode?.props)
  const read = spaHtmlDocReader(tx, tenantId)
  const newHtml = newNode?.props ? await htmlDesignSource(newNode.props, read) : null
  if (!newNode || !newDoc || newHtml === null)
    return { status: 'skipped', reason: 'invalid', detail: 'the new design file is missing' }
  const newData = crmDesignData(htmlCrmContractOf(newHtml))
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
    return { ...c, props: upgradedProps(props, newNode, c.content) }
  }

  const up = await carryInto(oldNode.props)
  const liveData = withNode(live.data as PageData, oldNode, { ...oldNode, props: up.props })
  const problems = [
    ...htmlContentErrors(up.content ?? { v: 1 }, slots),
    ...(await htmlDesignContentErrors(tx, tenantId, liveData)),
  ]
  if (problems.length) return { status: 'skipped', reason: 'invalid', detail: problems[0] }
  const published = await insertVersion(tx, {
    tenantId,
    pageId: input.pageId,
    data: liveData,
    status: 'published',
    userId: input.userId,
  })

  // The working draft: on the old file too → carried; else kept as it is. Either way moved after the new live row.
  let draft: 'carried' | 'kept' | 'none' = 'none'
  let draftRow: { id: string; createdAt: Date } | null = null
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
      pageId: input.pageId,
      data,
      status: 'draft',
      userId: latest.createdBy,
    })
    if (!latest.label)
      await tx
        .delete(pageVersions)
        .where(and(eq(pageVersions.tenantId, tenantId), eq(pageVersions.id, latest.id)))
  }

  const undo: TemplateUndo = {
    templateKey: site.templateKey,
    theme: site.theme,
    appliedTheme: site.theme,
    at: new Date().toISOString(),
    live: { version: input.version, fromSha: sha, toSha: input.toSha },
    pages: [
      {
        pageId: input.pageId,
        created: false,
        draft: latest.status === 'draft' ? (latest.data as PageData) : null,
        versionId: published.id,
        savedAt: published.createdAt.toISOString(),
        publishedBefore: live.id,
        ...(draftRow ? { draftVersionId: draftRow.id, draftSavedAt: draftRow.createdAt.toISOString() } : {}),
      },
    ],
  }
  await tx
    .update(sites)
    .set({ templateKey: input.template.key, templateUndo: undo })
    .where(eq(sites.id, site.id))

  // Owner D5: Write texts for the page on a contract v2 design (drafts only), never on the spa's own design.
  if (crmContractVersion(newData) === 2) {
    const run = {
      via: 'template_upgrade' as const,
      pageIds: [input.pageId],
      designSha: newDoc.sha256,
    }
    if ('actorUserId' in input.texts && !up.own)
      await queueSiteTexts(tx, tenantId, { ...run, actorUserId: input.texts.actorUserId })
    else
      await skipSiteTexts(tx, tenantId, {
        ...run,
        actorUserId: 'actorUserId' in input.texts ? input.texts.actorUserId : input.userId,
        summary: up.own ? 'made for this spa' : 'skip' in input.texts ? input.texts.skip : 'not queued',
      })
  }

  return {
    status: 'switched',
    pageId: input.pageId,
    draft,
    carried: up.carry.carried,
    dropped: up.carry.dropped,
    pins: up.pins,
    designSha: newDoc.sha256,
  }
}
