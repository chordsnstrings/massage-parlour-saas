// R28 P5 (owner D4): a new HTML template version rolled out live — finder, upgrade, live undo + hold, D5 queue.
import { createHash } from 'node:crypto'
import { htmlContentParts, listHtmlDesignTexts } from '@spa/core'
import {
  closeAllDbs,
  pageVersions,
  sites,
  siteTemplates,
  storedFiles,
  tenants,
  user,
  withTenant,
} from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { and, desc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  acquirePageLock,
  addPage,
  ensureSite,
  getEditablePage,
  getSite,
  htmlDesignContentErrors,
  keepTemplateUndo,
  labelVersion,
  listPages,
  materializeTemplatePageData,
  type PageData,
  publishPage,
  releasePageLock,
  renamePage,
  type SiteTemplate,
  saveDraft,
  saveStudioTemplate,
  setPendingTemplateVersion,
  signOffTemplateVersion,
  spasOnTemplateVersions,
  storeSpaHtmlDoc,
  storeTemplateHtmlDoc,
  studioToSiteTemplate,
  switchTemplate,
  switchWrote,
  type TemplatePage,
  templateShas,
  templateUndoChanges,
  undoTemplateSwitch,
  updateDraftTheme,
  upgradedProps,
  upgradeHtmlDesignLive,
} from '../src'

const { platform, app } = testDbs()
const tx = <T>(tenant: string, fn: Parameters<typeof withTenant<T>>[1]) => withTenant(tenant, fn, app)

// Real PNG magic (sniffImageType) for the own-look logo pin.
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 7),
])
const LOGO = `data:image/png;base64,${PNG.toString('base64')}`
// v1 embeds this light logo; v2 links the same bytes as a hosted design file (BE RELAX v2.2): no pin for it.
const LIGHT = Buffer.concat([PNG, Buffer.alloc(8, 9)])
const HOSTED_LIGHT = `https://spamanagement.co/designs/seaside/${createHash('sha256').update(LIGHT).digest('hex').slice(0, 16)}.png`
const POOL = 'https://cdn.test/pool.jpg'

const doc = (title: string, body: string, data: unknown) =>
  `<!doctype html><html><head><title>${title}</title></head><body>${body}<img src="${POOL}" alt="Pool"><script>window.CRM_DATA = ${JSON.stringify(data)};</script></body></html>`
const common = {
  contact: { whatsapp_number: '', whatsapp_message: 'Hello', phones: [] },
  services: [],
  staff: [],
}
const V1 = doc('Seaside', '<nav><a href="#t">Treatments</a></nav><h1>Arrive slowly</h1>', {
  spa: {
    name: 'Seaside Test Spa',
    short_name: 'Seaside',
    area_label: '',
    logo_on_dark: LOGO,
    logo_on_light: `data:image/png;base64,${LIGHT.toString('base64')}`,
    timezone: 'Asia/Dubai',
  },
  journey: [{ id: 'welcome', title: 'Slow down.', body: 'Calm by the sea', tags: [] }],
  ...common,
})
const V2 = doc(
  '{{spa_name}}',
  '<nav><a href="#t" data-crm-text="ui.nav.treatments">Treatments</a></nav><h1>Arrive slowly</h1>',
  {
    contract: {
      version: 2,
      locales: ['en', 'ar'],
      fields: {},
      l10n: { ar: { 'ui.nav.treatments': 'العلاجات' } },
    },
    spa: {
      name: 'Your Spa',
      short_name: 'Your Spa',
      area_label: '',
      logo_on_dark: 'https://spamanagement.co/designs/seaside/0000000000000000.png', // hosted, other bytes: still pinned
      logo_on_light: HOSTED_LIGHT,
      timezone: 'Asia/Dubai',
    },
    journey: [{ id: 'welcome', title: 'Slow down.', body: 'Calm by the sea', tags: [], clip: null }],
    ...common,
    ui: { nav: { treatments: 'Treatments' } },
  },
)
const KEY = 'seaside'
const htmlPages = (d: unknown): TemplatePage[] => [
  {
    slug: '',
    title: { en: 'Home' },
    data: {
      root: { props: { htmlDesign: true } },
      content: [{ type: 'HtmlDesign', props: { id: `${KEY}-html-design`, html: '', doc: d, images: [] } }],
    },
  },
]
type Node = { type: string; props: Record<string, unknown> }
const node = (data: unknown) =>
  ((data as { content: Node[] }).content.find((n) => n.type === 'HtmlDesign') as Node).props
const shaOf = (data: unknown) => (node(data).doc as { sha256: string }).sha256
const withContent = (data: PageData, content: unknown): PageData => ({
  ...data,
  content: (data.content as Node[]).map((n) =>
    n.type === 'HtmlDesign' ? { ...n, props: { ...n.props, content } } : n,
  ),
})

const ids: Record<string, string> = {}
let v1Template: SiteTemplate
let signed: Awaited<ReturnType<typeof signOffTemplateVersion>>
const USER = 'rollout-admin'
const OTHER = 'rollout-editor'

const prepare =
  (tenantId: string, db: Parameters<typeof materializeTemplatePageData>[0]) => (data: PageData) =>
    materializeTemplatePageData(db, { tenantId, data, platform }).then((r) => r.data)
const homeOf = (tenantId: string) =>
  tx(tenantId, async (db) => (await listPages(db, tenantId)).find((p) => p.slug === '')!)
const versions = (tenantId: string, pageId: string) =>
  platform
    .select()
    .from(pageVersions)
    .where(and(eq(pageVersions.tenantId, tenantId), eq(pageVersions.pageId, pageId)))
    .orderBy(desc(pageVersions.createdAt))
const upgrade = (
  tenantId: string,
  name: string,
  opts: { as?: string; within?: string; pageIds?: string[] } = {},
) =>
  tx(opts.within ?? tenantId, async (db) =>
    upgradeHtmlDesignLive(db, tenantId, {
      template: studioToSiteTemplate(signed.row),
      pageIds: opts.pageIds ?? [(await homeIn(db, tenantId))?.id ?? ids[`${tenantId}:home`]!],
      fromShas: signed.fromShas,
      toSha: signed.toSha,
      version: signed.version,
      userId: opts.as ?? USER,
      tenantName: name,
      prepare: prepare(tenantId, db),
      texts: { actorUserId: USER },
    }),
  )
const homeIn = async (db: Parameters<typeof listPages>[0], tenantId: string) =>
  (await listPages(db, tenantId)).find((p) => p.slug === '')

/** Applies the v1 template (a site of its own first, so the switch keeps an undo) and publishes its home page. */
async function onV1(slug: string, name: string, opts: { publish?: boolean; content?: unknown } = {}) {
  const [t] = await platform.insert(tenants).values({ slug, name }).returning()
  const id = t!.id
  await tx(id, async (db) => {
    await ensureSite(db, id, {
      key: 'zen',
      name: 'Zen',
      theme: { accent: '#111111' },
      pages: [{ slug: 'about', title: { en: 'About' }, data: { root: { props: {} }, content: [] } }],
    })
    await switchTemplate(db, id, v1Template, { replaceContent: true, prepare: prepare(id, db) })
    const home = (await homeIn(db, id))!
    ids[`${id}:home`] = home.id
    const draft = (await getEditablePage(db, id, home.id))!.data
    if (opts.content)
      await saveDraft(db, { tenantId: id, pageId: home.id, data: withContent(draft, opts.content) })
    if (opts.publish !== false) await publishPage(db, { tenantId: id, pageId: home.id })
  })
  return id
}

beforeAll(async () => {
  await resetTestDatabase()
  for (const [id, name] of [
    [USER, 'Rollout Admin'],
    [OTHER, 'Sara'],
  ])
    await platform.insert(user).values({ id, name, email: `${id}@e2e.test`, emailVerified: true })
  const v1Doc = await storeTemplateHtmlDoc(platform, { html: V1 })
  const row = await saveStudioTemplate(platform, {
    key: KEY,
    name: 'Seaside',
    theme: {},
    pages: htmlPages(v1Doc),
    active: true,
  })
  v1Template = studioToSiteTemplate(row)
  const texts = listHtmlDesignTexts(V1)
  const nav = texts.find((x) => x.text === 'Treatments')!
  // The design's own spa, with edits: a data value, a page text (bound in v2 → converted) and a picture.
  ids.own = await onV1('seaside', 'Seaside Test Spa', {
    content: {
      v: 1,
      values: [{ path: 'journey[welcome].title', value: { t: { en: 'Rest here' } } }],
      texts: [{ id: nav.id, src: nav.src, t: { en: 'Rituals' } }],
      pictures: [{ id: 'img-0', src: POOL, img: 'https://cdn.test/pool-2.jpg' }],
    },
  })
  ids.other = await onV1('lotus', 'Lotus Spa')
  ids.cancelled = await onV1('gone', 'Gone Spa')
  await platform.update(tenants).set({ status: 'cancelled' }).where(eq(tenants.id, ids.cancelled))
  ids.draftOnly = await onV1('drafty', 'Drafty Spa', { publish: false })
  ids.held = await onV1('held', 'Held Spa')
  await platform
    .update(sites)
    .set({ templateHold: { key: KEY, version: 2, at: new Date().toISOString(), by: USER } })
    .where(eq(sites.tenantId, ids.held))
  // A spa whose live file was patched (another sha): never overwritten.
  ids.patched = await onV1('patched', 'Patched Spa')
  await tx(ids.patched, async (db) => {
    const home = (await homeIn(db, ids.patched!))!
    const live = (await getEditablePage(db, ids.patched!, home.id))!.data
    const d = await storeSpaHtmlDoc(db, { tenantId: ids.patched!, html: V1.replace('Arrive', 'Come') })
    const props = node(live)
    await publishPage(db, {
      tenantId: ids.patched!,
      pageId: home.id,
      data: {
        ...live,
        content: (live.content as Node[]).map((n) =>
          n.type === 'HtmlDesign' ? { ...n, props: { ...props, doc: d } } : n,
        ),
      },
    })
  })
  // Version 2 uploaded, then signed off (the Roll out).
  const v2Doc = await storeTemplateHtmlDoc(platform, { html: V2 })
  await setPendingTemplateVersion(platform, row.id, {
    version: 2,
    sha256: v2Doc.sha256,
    file: v2Doc.file,
    bytes: v2Doc.bytes,
    at: new Date().toISOString(),
    by: USER,
    pages: htmlPages(v2Doc) as unknown as Record<string, unknown>[],
    report: {},
  })
  await expect(signOffTemplateVersion(platform, row.id, 'f'.repeat(64), USER)).rejects.toThrow(
    /changed meanwhile/,
  )
  signed = await signOffTemplateVersion(platform, row.id, v2Doc.sha256, USER)
})
afterAll(() => closeAllDbs())

describe('template versions (R28 P5)', () => {
  it('sign-off: the pending version becomes the template, the old one goes to history', async () => {
    const [row] = await platform.select().from(siteTemplates).where(eq(siteTemplates.key, KEY))
    expect(row!.version).toBe(2)
    expect(row!.pending).toBeNull()
    expect(row!.history.map((h) => h.version)).toEqual([1])
    expect(templateShas(row!)).toEqual([signed.toSha, row!.history[0]!.sha256])
    expect(signed.fromShas).toEqual([row!.history[0]!.sha256])
  })

  it('finder: only live old shas; patched → changed, draft-only → not-live, cancelled and held left out', async () => {
    const found = await spasOnTemplateVersions(platform, {
      key: KEY,
      fromShas: signed.fromShas,
      toSha: signed.toSha,
      version: 2,
    })
    expect(found.spas.map((s) => [s.slug, s.own, s.hasDraft])).toEqual([
      ['lotus', false, false],
      ['seaside', true, false],
    ])
    expect(Object.fromEntries(found.skipped.map((s) => [s.slug, s.reason]))).toEqual({
      drafty: 'not-live',
      held: 'held',
      patched: 'changed',
    })
    expect(found.current).toBe(0)
  })
})

describe('live upgrade (owner D4)', () => {
  it('the own spa: a new published row with its edits carried, its look pinned, draft theme + rename pending', async () => {
    const home = await homeOf(ids.own!)
    await tx(ids.own!, async (db) => {
      await updateDraftTheme(db, ids.own!, { accent: '#222222' })
      await renamePage(db, { tenantId: ids.own!, pageId: home.id, title: { en: 'Start' } })
      // A working draft on the old file too: carried and moved after the new live row.
      const cur = (await getEditablePage(db, ids.own!, home.id))!.data
      await saveDraft(db, {
        tenantId: ids.own!,
        pageId: home.id,
        data: withContent(cur, {
          v: 1,
          values: [{ path: 'journey[welcome].title', value: { t: { en: 'Draft title' } } }],
        }),
      })
    })
    const before = await versions(ids.own!, home.id)
    const live1 = before.find((v) => v.status === 'published')!
    const draft1 = before[0]!
    const up = await upgrade(ids.own!, 'Seaside Test Spa')
    expect(up).toMatchObject({
      status: 'switched',
      pages: [{ pageId: home.id, draft: 'carried' }],
      designSha: signed.toSha,
    })
    if (up.status !== 'switched') return
    expect(up.carried).toMatchObject({ values: 1, converted: 1, pictures: 1 })
    expect(up.pins).toBeGreaterThanOrEqual(2)

    const after = await versions(ids.own!, home.id)
    const live2 = after.find((v) => v.status === 'published')!
    expect(live2.id).not.toBe(live1.id)
    expect(after.some((v) => v.id === live1.id)).toBe(true) // history kept
    expect(after.some((v) => v.id === draft1.id)).toBe(false) // the unlabelled draft moved
    expect(after[0]!.status).toBe('draft')
    expect(shaOf(after[0]!.data)).toBe(signed.toSha)
    expect(shaOf(live2.data)).toBe(signed.toSha)
    const values = htmlContentParts(node(live2.data).content).values
    expect(values['journey[welcome].title']).toEqual({ t: { en: 'Rest here' } })
    expect(values['ui.nav.treatments']).toEqual({ t: { en: 'Rituals' } })
    expect(values['spa.short_name']).toEqual({ t: { en: 'Seaside' } })
    expect((values['spa.logo_on_dark'] as { img: string }).img).toMatch(/^\/files\/[0-9a-f-]{36}$/)
    expect(values['spa.logo_on_light']).toBeUndefined() // the new version hosts the same picture
    expect(htmlContentParts(node(after[0]!.data).content).values['journey[welcome].title']).toEqual({
      t: { en: 'Draft title' },
    })
    expect(node(live2.data).id).toBe(`${KEY}-html-design`)

    const site = await tx(ids.own!, (db) => getSite(db, ids.own!))
    expect(site!.theme).toEqual({ accent: '#111111' })
    expect(site!.themeDraft).toEqual({ accent: '#222222' })
    expect(site!.templateKey).toBe(KEY)
    expect(site!.templateUndo?.live).toEqual({ version: 2, fromSha: signed.fromShas[0], toSha: signed.toSha })
    // Owner D5 never runs on the spa's own design.
    expect(site!.textRun).toMatchObject({ state: 'skipped', summary: 'made for this spa' })
    const page = (await homeOf(ids.own!))!
    expect(page.pending?.title?.en).toBe('Start')
    expect(await tx(ids.own!, (db) => templateUndoChanges(db, ids.own!))).toEqual([])
  })

  it('a second run → already; another spa queues Write texts; a labelled draft stays in history', async () => {
    expect(await upgrade(ids.own!, 'Seaside Test Spa')).toEqual({ status: 'skipped', reason: 'already' })
    const home = await homeOf(ids.other!)
    const labelled = await tx(ids.other!, async (db) => {
      const cur = (await getEditablePage(db, ids.other!, home.id))!.data
      const d = await saveDraft(db, { tenantId: ids.other!, pageId: home.id, data: cur })
      await labelVersion(db, ids.other!, d.id, 'Before the summer')
      return d.id
    })
    // Open in someone else's editor: skipped, nothing written.
    await tx(ids.other!, (db) =>
      acquirePageLock(db, { tenantId: ids.other!, pageId: home.id, userId: OTHER, holderName: 'Sara' }),
    )
    const count = (await versions(ids.other!, home.id)).length
    expect(await upgrade(ids.other!, 'Lotus Spa')).toEqual({
      status: 'skipped',
      reason: 'locked',
      detail: "open in Sara's editor",
    })
    expect((await versions(ids.other!, home.id)).length).toBe(count)
    await tx(ids.other!, (db) =>
      releasePageLock(db, { tenantId: ids.other!, pageId: home.id, userId: OTHER }),
    )
    expect(await upgrade(ids.other!, 'Lotus Spa')).toMatchObject({
      status: 'switched',
      pages: [{ draft: 'carried' }],
    })
    const after = await versions(ids.other!, home.id)
    expect(after.find((v) => v.id === labelled)?.label).toBe('Before the summer')
    expect(after[0]!.label).toBeNull()
    const site = await tx(ids.other!, (db) => getSite(db, ids.other!))
    expect(site!.textRun).toMatchObject({
      state: 'queued',
      via: 'template_upgrade',
      actorUserId: USER,
      pageIds: [home.id],
      designSha: signed.toSha,
    })
  })

  it('RLS: an upgrade inside another spa’s transaction sees nothing and writes nothing', async () => {
    const home = await homeOf(ids.held!)
    const count = (await versions(ids.held!, home.id)).length
    const r = await upgrade(ids.held!, 'Held Spa', { within: ids.patched! })
    expect(r).toEqual({ status: 'skipped', reason: 'not-on-version' })
    expect((await versions(ids.held!, home.id)).length).toBe(count)
  })
})

describe('live undo (+ hold) and Write texts saves', () => {
  it('a Write texts save over the carried draft keeps undo (keepTemplateUndo); undo re-publishes v1, hold set', async () => {
    const home = await homeOf(ids.own!)
    const draftBefore = await tx(ids.own!, async (db) => {
      const site = await getSite(db, ids.own!)
      const cur = (await getEditablePage(db, ids.own!, home.id))!
      expect(switchWrote(site!.templateUndo, home.id, cur.version!)).toBe(true)
      const written = await saveDraft(db, {
        tenantId: ids.own!,
        pageId: home.id,
        data: withContent(cur.data, {
          ...(node(cur.data).content as object),
          texts: [],
        }),
      })
      await keepTemplateUndo(db, ids.own!, home.id, cur.version!, written)
      return site!.templateUndo!.pages[0]!.draft
    })
    expect(await tx(ids.own!, (db) => templateUndoChanges(db, ids.own!))).toEqual([])
    const v1Live = (await versions(ids.own!, home.id)).filter((v) => v.status === 'published')[1]!
    await tx(ids.own!, (db) => undoTemplateSwitch(db, ids.own!, USER))
    const after = await versions(ids.own!, home.id)
    const live = after.find((v) => v.status === 'published')!
    expect(live.data).toEqual(v1Live.data)
    expect(shaOf(live.data)).toBe(signed.fromShas[0])
    expect(after[0]!.status).toBe('draft')
    expect(after[0]!.data).toEqual(draftBefore)
    const site = await tx(ids.own!, (db) => getSite(db, ids.own!))
    expect(site!.templateUndo).toBeNull()
    expect(site!.templateHold).toMatchObject({ key: KEY, version: 2, by: USER })
    const found = await spasOnTemplateVersions(platform, {
      key: KEY,
      fromShas: signed.fromShas,
      toSha: signed.toSha,
      version: 2,
    })
    expect(found.skipped.find((s) => s.slug === 'seaside')?.reason).toBe('held')
    expect(found.current).toBe(1) // Lotus Spa
  })

  it('an edit or a publish after the upgrade blocks undo', async () => {
    const home = await homeOf(ids.other!)
    await tx(ids.other!, async (db) => {
      const cur = (await getEditablePage(db, ids.other!, home.id))!.data
      await saveDraft(db, { tenantId: ids.other!, pageId: home.id, data: cur })
    })
    expect(await tx(ids.other!, (db) => templateUndoChanges(db, ids.other!))).toEqual(['Home'])
    await expect(tx(ids.other!, (db) => undoTemplateSwitch(db, ids.other!, USER))).rejects.toThrow(
      /Undo is no longer available/,
    )
  })

  it('a template switch (not live) keeps its undo after a Write texts save', async () => {
    const id = await onV1('switchy', 'Switchy Spa', { publish: false })
    const home = await homeOf(id)
    await tx(id, async (db) => {
      const site = await getSite(db, id)
      const cur = (await getEditablePage(db, id, home.id))!
      expect(switchWrote(site!.templateUndo, home.id, cur.version!)).toBe(true)
      const written = await saveDraft(db, { tenantId: id, pageId: home.id, data: cur.data })
      await keepTemplateUndo(db, id, home.id, cur.version!, written)
    })
    expect(await tx(id, (db) => templateUndoChanges(db, id))).toEqual([])
    const undone = await tx(id, (db) => undoTemplateSwitch(db, id, USER))
    expect(undone.templateKey).toBe('zen')
  })
})

describe('a spa with two pages on the old version (fix2: grouped by spa)', () => {
  /** A spa on v1 with a second live page showing the same design (its content: `second`). */
  async function twoPages(slug: string, name: string, second?: unknown) {
    const id = await onV1(slug, name)
    const home = await homeOf(id)
    const other = await tx(id, async (db) => {
      const live = (await getEditablePage(db, id, home.id))!.data
      const p = await addPage(db, {
        tenantId: id,
        slug: 'offers',
        title: { en: 'Offers' },
        data: second ? withContent(live, second) : live,
      })
      await publishPage(db, { tenantId: id, pageId: p.id })
      return p.id
    })
    return { id, pageIds: [home.id, other].sort() }
  }
  const liveSha = async (id: string, pageId: string) =>
    shaOf((await versions(id, pageId)).find((v) => v.status === 'published')!.data)

  it('the finder lists the spa once with both pages; one undo and one Write texts run hold both', async () => {
    const { id, pageIds } = await twoPages('twin', 'Twin Spa')
    const found = await spasOnTemplateVersions(platform, {
      key: KEY,
      fromShas: signed.fromShas,
      toSha: signed.toSha,
      version: 2,
    })
    const twin = found.spas.filter((s) => s.slug === 'twin')
    expect(twin).toHaveLength(1)
    expect(twin[0]!.pages.map((p) => p.pageId).sort()).toEqual(pageIds)
    const up = await upgrade(id, 'Twin Spa', { pageIds })
    expect(up.status).toBe('switched')
    if (up.status !== 'switched') return
    expect(up.pages.map((p) => p.pageId).sort()).toEqual(pageIds)
    for (const p of pageIds) expect(await liveSha(id, p)).toBe(signed.toSha)
    const site = await tx(id, (db) => getSite(db, id))
    expect(site!.templateUndo!.pages.map((p) => p.pageId).sort()).toEqual(pageIds)
    expect(site!.textRun).toMatchObject({ state: 'queued', via: 'template_upgrade' })
    expect([...site!.textRun!.pageIds].sort()).toEqual(pageIds)
    // Undo puts both pages back (never half on v2).
    await tx(id, (db) => undoTemplateSwitch(db, id, USER))
    for (const p of pageIds) expect(await liveSha(id, p)).toBe(signed.fromShas[0])
  })

  it('one page whose content does not fit (a video file as a logo) leaves the whole spa as it was', async () => {
    const { id, pageIds } = await twoPages('halfy', 'Halfy Spa')
    const [file] = await platform
      .insert(storedFiles)
      .values({ tenantId: id, contentType: 'video/mp4', size: 1, isPublic: true })
      .returning()
    // The second page's live content: a video file in a picture slot.
    const bad = pageIds[1]!
    await tx(id, async (db) => {
      const live = (await getEditablePage(db, id, bad))!.data
      await publishPage(db, {
        tenantId: id,
        pageId: bad,
        data: withContent(live, {
          v: 1,
          values: [{ path: 'spa.logo_on_dark', value: { img: `/files/${file!.id}` } }],
        }),
      })
    })
    const before = await Promise.all(pageIds.map(async (p) => (await versions(id, p)).length))
    const undoBefore = (await tx(id, (db) => getSite(db, id)))!.templateUndo
    const up = await upgrade(id, 'Halfy Spa', { pageIds })
    expect(up).toMatchObject({ status: 'skipped', reason: 'invalid' })
    expect((up as { detail?: string }).detail).toMatch(/a picture from the platform's files/)
    expect(await Promise.all(pageIds.map(async (p) => (await versions(id, p)).length))).toEqual(before)
    for (const p of pageIds) expect(await liveSha(id, p)).toBe(signed.fromShas[0])
    const site = await tx(id, (db) => getSite(db, id))
    expect(site!.templateUndo).toEqual(undoBefore)
    expect(site!.textRun).toBeNull()
  })
})

describe('kind-aware content files (wrongKindContentFiles via htmlDesignContentErrors)', () => {
  it('refuses an image in a clip slot and a video in a picture slot; the right kinds pass', async () => {
    const id = ids.other!
    const [img, vid] = await platform
      .insert(storedFiles)
      .values([
        { tenantId: id, contentType: 'image/webp', size: 1, isPublic: true },
        { tenantId: id, contentType: 'video/webm', size: 1, isPublic: true },
      ])
      .returning()
    const page = (values: { path: string; value: unknown }[], pictures: unknown[] = []) => ({
      root: { props: {} },
      content: [{ type: 'HtmlDesign', props: { id: 'x', content: { v: 1, values, pictures } } }],
    })
    const errors = (data: unknown) => tx(id, (db) => htmlDesignContentErrors(db, id, data))
    expect(
      await errors(
        page(
          [
            { path: 'journey[welcome].clip', value: { video: `/files/${img!.id}` } },
            { path: 'spa.logo_on_dark', value: { img: `/files/${vid!.id}` } },
          ],
          [{ id: 'img-0', src: POOL, img: `/files/${vid!.id}` }],
        ),
      ),
    ).toEqual([
      "journey[welcome].clip: a video (MP4 / WebM) from the platform's files",
      "spa.logo_on_dark: a picture from the platform's files",
      "picture img-0: a picture from the platform's files",
    ])
    expect(
      await errors(
        page(
          [
            { path: 'journey[welcome].clip', value: { video: `/files/${vid!.id}` } },
            { path: 'spa.logo_on_dark', value: { img: `/files/${img!.id}` } },
          ],
          [{ id: 'img-0', src: POOL, img: `/files/${img!.id}` }],
        ),
      ),
    ).toEqual([])
  })
})

describe('upgradedProps (fix2: a spa keeps its Phone fixes and picture framings)', () => {
  const NEW_HTML = `<img src="https://cdn.test/hero.jpg"><img src="${POOL}">`
  const prepared = (images: unknown[] = [], phoneFixes = false) => ({
    type: 'HtmlDesign',
    props: { html: '', doc: { sha256: 'n' }, images, phoneFixes },
  })
  it('keeps the spa’s phone fixes on and re-points its adjustments by src; the template’s own win', () => {
    const old = { id: 'b', images: [{ id: 'img-0', src: POOL, x: 10, y: 20 }], phoneFixes: true, extra: 1 }
    const kept = upgradedProps(old, prepared(), undefined, NEW_HTML)
    expect(kept).toMatchObject({ id: 'b', extra: 1, phoneFixes: true, doc: { sha256: 'n' } })
    expect(kept.images).toEqual([{ id: 'img-1', src: POOL, x: 10, y: 20 }])
    const set = upgradedProps(
      old,
      prepared([{ id: 'img-1', src: POOL, fit: 'contain' }], true),
      undefined,
      NEW_HTML,
    )
    expect(set.images).toEqual([{ id: 'img-1', src: POOL, fit: 'contain' }])
    // A picture gone from the new file drops its adjustment; phone fixes off stay off.
    const gone = upgradedProps(
      { images: [{ id: 'img-0', src: 'https://cdn.test/old.jpg', x: 5 }], phoneFixes: false },
      prepared(),
      undefined,
      NEW_HTML,
    )
    expect(gone).toMatchObject({ images: [], phoneFixes: false })
  })

  it('settings only inherited from the old version follow the new one; the spa’s own stay', () => {
    const fromProps = { images: [{ id: 'img-0', src: POOL, x: 10, y: 20 }], phoneFixes: true }
    // Same as the old version (inherited): the new version has Phone fixes off and no framing → both end.
    const inherited = upgradedProps(
      { y: 0, ...fromProps, id: 'b' },
      prepared(),
      undefined,
      NEW_HTML,
      fromProps,
    )
    expect(inherited).toMatchObject({ phoneFixes: false, images: [] })
    // Key order does not make an inherited adjustment the spa's own.
    const reordered = upgradedProps(
      { images: [{ y: 20, x: 10, src: POOL, id: 'img-0' }], phoneFixes: true },
      prepared(),
      undefined,
      NEW_HTML,
      fromProps,
    )
    expect(reordered).toMatchObject({ phoneFixes: false, images: [] })
    // The spa changed them itself (different from the old version): kept.
    const own = upgradedProps(
      { images: [{ id: 'img-0', src: POOL, x: 40, y: 20 }], phoneFixes: true },
      prepared(),
      undefined,
      NEW_HTML,
      { images: fromProps.images, phoneFixes: false },
    )
    expect(own).toMatchObject({ phoneFixes: true, images: [{ id: 'img-1', src: POOL, x: 40, y: 20 }] })
  })
})
