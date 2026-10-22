// R28 P5: the Write texts runner shared by the console and the D5 queue (stub ModelArk client).
import { htmlContentParts, listHtmlDesignTexts } from '@spa/core'
import { closeAllDbs, platformAdmins, type SiteTextRun, sites, tenants, user, withTenant } from '@spa/db'
import { seedPlatform } from '@spa/db/seed'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import {
  ensureSite,
  getEditablePage,
  getSite,
  listPages,
  queueSiteTexts,
  storeSpaHtmlDoc,
} from '@spa/services'
import { fillTextSlots, htmlTextSlots, type SiteEditSchema, textSlots } from '@spa/services/site-kit'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createModelArkClient, runQueuedSiteTexts, runSiteTexts, sweepSiteTexts } from '../src'

process.env.SITE_AI_EDITOR_EMAILS = '*'
const { platform, app } = testDbs()
const ADMIN = 'texts-admin'
let tenantId: string
let pageId: string
let sha: string

const DATA = {
  contract: {
    version: 2,
    locales: ['en', 'ar'],
    fields: { 'ui.wa.*': { locales: ['en'] } },
    l10n: { ar: { 'ui.form.submit': 'اطلب الحجز' } },
  },
  spa: { name: 'Your Spa', short_name: 'Your Spa', area_label: '', logo_on_dark: '', logo_on_light: '' },
  journey: [{ id: 'welcome', title: 'Slow down.', body: 'Massage in the heart of {city}.', tags: [] }],
  booking: { label: 'Book' },
  contact: { whatsapp_number: '', whatsapp_message: 'Hello', phones: [] },
  services: [],
  staff: [],
  ui: { form: { submit: 'Request booking' }, wa: { intro: 'Hello {spa}, I would like to book:' } },
}
const HTML = `<!doctype html><html><head><title>{{spa_name}}</title></head><body><h1>Arrive slowly</h1><script>window.CRM_DATA = ${JSON.stringify(DATA)};</script></body></html>`
const H1 = listHtmlDesignTexts(HTML).find((x) => x.text === 'Arrive slowly')!

const reply = (texts: { key: string; en: string; ar: string }[]) => {
  const fetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: { role: 'assistant', content: JSON.stringify({ texts, note: 'Done.' }) },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 1000, completion_tokens: 200 },
        }),
      ),
  )
  return {
    fetch,
    client: createModelArkClient({ apiKey: 'k', fetch: fetch as unknown as typeof globalThis.fetch }),
  }
}
const DRAFTS = [
  { key: 'd-1/content:journey[welcome].title', en: 'Unwind by the sea.', ar: 'استرخ قرب البحر.' },
  // Loses the design's {city} token: skipped.
  { key: 'd-1/content:journey[welcome].body', en: 'Massage in Dubai.', ar: 'تدليك في دبي.' },
  { key: `d-1/text:${H1.id}`, en: 'Arrive and rest', ar: 'تعال واسترح' },
]
const draftContent = async () =>
  withTenant(
    tenantId,
    async (tx) =>
      (await getEditablePage(tx, tenantId, pageId))!.data as { content: { props: { content?: unknown } }[] },
    app,
  )

beforeAll(async () => {
  await resetTestDatabase()
  await seedPlatform(platform)
  const [t] = await platform
    .insert(tenants)
    .values({ slug: 'texts-spa', name: 'Texts Spa', aiBudgetUsd: '5' })
    .returning()
  tenantId = t!.id
  await platform.insert(user).values({
    id: ADMIN,
    name: 'Admin',
    email: 'texts-admin@e2e.test',
    emailVerified: true,
    twoFactorEnabled: true,
  })
  await platform.insert(platformAdmins).values({ userId: ADMIN })
  await withTenant(
    tenantId,
    async (tx) => {
      const doc = await storeSpaHtmlDoc(tx, { tenantId, html: HTML })
      sha = doc.sha256
      await ensureSite(tx, tenantId, {
        key: 'v2',
        name: 'V2',
        theme: {},
        pages: [
          {
            slug: '',
            title: { en: 'Home' },
            data: {
              root: { props: { htmlDesign: true } },
              content: [
                {
                  type: 'HtmlDesign',
                  props: {
                    id: 'd-1',
                    html: '',
                    doc,
                    images: [],
                    // The spa already wrote the booking label: onlyDefaults leaves it.
                    content: { v: 1, values: [{ path: 'booking.label', value: { t: { en: 'Reserve' } } }] },
                  },
                },
              ],
            },
          },
        ],
      })
      pageId = (await listPages(tx, tenantId))[0]!.id
    },
    app,
  )
})
afterAll(closeAllDbs)

describe('Write texts runner (R28 P5)', () => {
  it('slots: system copy never, the spa’s own values left with onlyDefaults', async () => {
    const data = (await draftContent()) as unknown
    const all = htmlTextSlots(data, HTML).map((s) => s.key)
    expect(all).toContain('d-1/content:booking.label')
    expect(all.some((k) => k.includes('content:ui.'))).toBe(false)
    const slots = htmlTextSlots(data, HTML, { onlyDefaults: true })
    const only = slots.map((s) => s.key)
    // fix2 (DECISION): the spa's English-only value is drafted in Arabic only (its English kept), ahead of the rest.
    expect(slots[0]).toMatchObject({
      key: 'd-1/content:booking.label',
      en: 'Reserve',
      ar: '',
      arabicOnly: true,
    })
    expect(slots.filter((s) => s.arabicOnly)).toHaveLength(1)
    expect(only).toEqual(
      expect.arrayContaining([
        'd-1/content:journey[welcome].title',
        'd-1/content:journey[welcome].body',
        `d-1/text:${H1.id}`,
      ]),
    )
    // Leftovers still go in (a whole rewrite).
    const left = htmlTextSlots(data, HTML, {
      onlyDefaults: true,
      first: new Set(['d-1/content:booking.label']),
    })
    expect(left[0]!.key).toBe('d-1/content:booking.label')
    expect(left[0]!.arabicOnly).toBeUndefined()
    // System copy: the spa's English-only value of a translated `ui.*` text gets its Arabic (either mode); a text the
    // contract keeps English never; one with Arabic never.
    const withUi = structuredClone(data) as { content: { props: { content: { values: unknown[] } } }[] }
    withUi.content[0]!.props.content.values.push(
      { path: 'ui.form.submit', value: { t: { en: 'Ask us' } } },
      { path: 'ui.wa.intro', value: { t: { en: 'Hi {spa}' } } },
    )
    for (const onlyDefaults of [false, true]) {
      const ui = htmlTextSlots(withUi, HTML, { onlyDefaults }).filter((s) => s.prop.startsWith('content:ui.'))
      expect(ui).toEqual([
        expect.objectContaining({ prop: 'content:ui.form.submit', en: 'Ask us', arabicOnly: true }),
      ])
    }
    expect(
      htmlTextSlots(data, HTML).find((s) => s.key === 'd-1/content:booking.label')?.arabicOnly,
    ).toBeUndefined()
  })

  it('a page on another design is skipped (designSha)', async () => {
    const { client, fetch } = reply(DRAFTS)
    const run = await runSiteTexts({
      tenantId,
      slug: 'texts-spa',
      userId: ADMIN,
      htmlOnly: true,
      designSha: 'f'.repeat(64),
      client,
    })
    expect(run.result).toEqual({
      pages: [],
      skipped: [{ title: 'Home', reason: 'the draft uses another design' }],
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('writes the drafts; a draft that loses a {token} is skipped; an Arabic-only slot keeps its English', async () => {
    const { client, fetch } = reply([
      ...DRAFTS,
      { key: 'd-1/content:booking.label', en: 'Book a visit', ar: 'احجز' },
    ])
    const run = await runSiteTexts({
      tenantId,
      slug: 'texts-spa',
      userId: ADMIN,
      htmlOnly: true,
      onlyDefaults: true,
      designSha: sha,
      client,
    })
    expect(run.result.pages).toEqual([{ id: pageId, slug: '', title: 'Home', filled: 3 }])
    // The model is told which slots are Arabic only.
    const body = String((fetch.mock.calls as unknown as [string, RequestInit][])[0]![1].body)
    expect(body).toContain('\\"arabic_only\\":true')
    const parts = htmlContentParts((await draftContent()).content[0]!.props.content)
    expect(parts.values['journey[welcome].title']).toEqual({
      t: { en: 'Unwind by the sea.', ar: 'استرخ قرب البحر.' },
    })
    expect(parts.values['journey[welcome].body']).toBeUndefined()
    expect(parts.values['booking.label']).toEqual({ t: { en: 'Reserve', ar: 'احجز' } })
    expect(parts.texts[H1.id]?.t).toEqual({ en: 'Arrive and rest', ar: 'تعال واسترح' })
  })

  it('a queued run is claimed once (two at the same time → one run), audited, then done', async () => {
    await withTenant(
      tenantId,
      (tx) =>
        queueSiteTexts(tx, tenantId, { via: 'template_upgrade', actorUserId: ADMIN, pageIds: [pageId] }),
      app,
    )
    const { client } = reply([
      {
        key: 'd-1/content:journey[welcome].body',
        en: 'Massage in the heart of {city}, slowly.',
        ar: 'تدليك في قلب {city}.',
      },
    ])
    const runs = await Promise.all([
      runQueuedSiteTexts(tenantId, { client }),
      runQueuedSiteTexts(tenantId, { client }),
    ])
    expect(runs.filter(Boolean)).toHaveLength(1)
    const done = runs.find(Boolean)!
    expect(done).toMatchObject({ state: 'done', via: 'template_upgrade' })
    expect(done.summary).toMatch(/^Drafted texts for 1 page in English and Arabic/)
    const [site] = await platform
      .select({ run: sites.textRun })
      .from(sites)
      .where(eq(sites.tenantId, tenantId))
    expect(site!.run).toMatchObject({ state: 'done' })
    expect(await runQueuedSiteTexts(tenantId, { client })).toBeNull()
  })

  it('the gate is checked again for whoever queued it', async () => {
    await platform.update(user).set({ twoFactorEnabled: false }).where(eq(user.id, ADMIN))
    await withTenant(
      tenantId,
      (tx) => queueSiteTexts(tx, tenantId, { via: 'template_apply', actorUserId: ADMIN, pageIds: [pageId] }),
      app,
    )
    const { client, fetch } = reply(DRAFTS)
    expect(await runQueuedSiteTexts(tenantId, { client })).toMatchObject({
      state: 'skipped',
      summary: 'needs SITE_AI_EDITOR_EMAILS + 2FA',
    })
    expect(fetch).not.toHaveBeenCalled()
    const site = await withTenant(tenantId, (tx) => getSite(tx, tenantId), app)
    expect(site!.textRun?.state).toBe('skipped')
  })
})

describe('sweepSiteTexts (worker site-texts-queue)', () => {
  it('runs queued runs older than 3 minutes and queues again runs cut off over 15 minutes ago', async () => {
    const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString()
    const spa = async (slug: string, run: Record<string, unknown>) => {
      const [t] = await platform.insert(tenants).values({ slug, name: slug }).returning()
      await withTenant(
        t!.id,
        (tx) =>
          ensureSite(tx, t!.id, {
            key: 'v2',
            name: 'V2',
            theme: {},
            pages: [{ slug: '', title: { en: 'Home' }, data: { root: { props: {} }, content: [] } }],
          }),
        app,
      )
      const textRun = { via: 'template_upgrade', actorUserId: ADMIN, pageIds: [], ...run } as SiteTextRun
      await platform.update(sites).set({ textRun }).where(eq(sites.tenantId, t!.id))
      return t!.id
    }
    const state = async (id: string) =>
      (await platform.select({ run: sites.textRun }).from(sites).where(eq(sites.tenantId, id)))[0]!.run
    const due = await spa('sweep-due', { state: 'queued', at: ago(4) })
    const fresh = await spa('sweep-fresh', { state: 'queued', at: ago(1) })
    const cut = await spa('sweep-cut', { state: 'running', at: ago(20), startedAt: ago(16) })
    const busy = await spa('sweep-busy', { state: 'running', at: ago(6), startedAt: ago(5) })
    // ADMIN lost 2FA above: each claimed run ends "skipped" without calling ModelArk.
    expect(await sweepSiteTexts()).toBe(2)
    for (const id of [due, cut])
      expect(await state(id)).toMatchObject({
        state: 'skipped',
        summary: 'needs SITE_AI_EDITOR_EMAILS + 2FA',
        finishedAt: expect.any(String),
      })
    expect(await state(fresh)).toMatchObject({ state: 'queued' })
    expect(await state(busy)).toMatchObject({ state: 'running' })
    // Nothing left that is due.
    expect(await sweepSiteTexts()).toBe(0)
  })
})

describe('Draft fixes scope (R30): only the search fields', () => {
  const SEO_HTML =
    '<!doctype html><html><head><title>Old Spa</title><meta name="description" content="Old description."></head><body><h1>Welcome</h1><img src="a.jpg" alt="Old stones"><img src="b.jpg"></body></html>'
  const schema: SiteEditSchema = {
    blocks: { Heading: { label: 'Heading', props: { text: { kind: 'bi' } }, defaults: {} } },
    root: { title: { kind: 'bi' }, description: { kind: 'bi', multiline: true } },
    theme: {},
    presets: [],
  }
  const ALT = listHtmlDesignTexts(SEO_HTML).find((x) => x.attr === 'alt')!
  const H = listHtmlDesignTexts(SEO_HTML).find((x) => x.text === 'Welcome')!
  let seoTenant: string
  const ids = {} as Record<string, string>
  const draftOf = (id: string) =>
    withTenant(seoTenant, async (tx) => (await getEditablePage(tx, seoTenant, id))!.data, app)

  beforeAll(async () => {
    await platform.update(user).set({ twoFactorEnabled: true }).where(eq(user.id, ADMIN))
    const [t] = await platform
      .insert(tenants)
      .values({ slug: 'seo-texts', name: 'Seo Texts Spa', aiBudgetUsd: '5' })
      .returning()
    seoTenant = t!.id
    await withTenant(
      seoTenant,
      async (tx) => {
        const doc = await storeSpaHtmlDoc(tx, { tenantId: seoTenant, html: SEO_HTML })
        await ensureSite(tx, seoTenant, {
          key: 'seo',
          name: 'Seo',
          theme: {},
          pages: [
            // No search description at all yet: Draft fixes writes it new.
            {
              slug: '',
              title: { en: 'Home' },
              data: {
                root: { props: { title: { en: 'Home' } } },
                content: [{ type: 'Heading', props: { id: 'h-1', text: { en: 'Slow down' } } }],
              },
            },
            {
              slug: 'offers',
              title: { en: 'Offers' },
              data: {
                root: { props: { htmlDesign: true } },
                content: [{ type: 'HtmlDesign', props: { id: 'o-1', html: '', doc, images: [] } }],
              },
            },
          ],
        })
        for (const p of await listPages(tx, seoTenant)) ids[p.slug || 'home'] = p.id
      },
      app,
    )
  })

  it('slots: a block page’s title + description (also when missing); a design’s title + meta, never alts', async () => {
    const home = await draftOf(ids.home!)
    expect(textSlots(home, schema, { scope: 'seo' }).map((s) => [s.key, s.en])).toEqual([
      ['root/title', 'Home'],
      ['root/description', ''],
    ])
    // Without the scope: every text, never an empty one.
    expect(textSlots(home, schema).map((s) => s.key)).toEqual(['root/title', 'h-1/text'])
    const offers = await draftOf(ids.offers!)
    expect(htmlTextSlots(offers, SEO_HTML, { scope: 'seo' }).map((s) => s.key)).toEqual([
      'o-1/text:title',
      'o-1/text:meta-description',
    ])
    expect(htmlTextSlots(offers, SEO_HTML).map((s) => s.key)).toEqual(
      expect.arrayContaining([`o-1/text:${H.id}`, `o-1/text:${ALT.id}`]),
    )
  })

  it('slots: an HTML design without its own head texts falls back to the page’s root title / description', () => {
    const page = (phoneFixes?: false) => ({
      root: { props: { htmlDesign: true, title: { en: 'Offers' }, description: { en: '' } } },
      content: [
        {
          type: 'HtmlDesign',
          props: { id: 'd-1', html: '', ...(phoneFixes === false ? { phoneFixes } : {}) },
        },
      ],
    })
    const bare = '<!doctype html><html><head></head><body><h1>Hi</h1></body></html>'
    const keys = (data: unknown, html: string) =>
      htmlTextSlots(data, html, { scope: 'seo' }).map((s) => [s.key, s.en, s.multiline])
    // Framed (Phone fixes on): the page's metadata is the live head.
    expect(keys(page(), bare)).toEqual([
      ['root/title', 'Offers', false],
      ['root/description', '', true],
    ])
    // Exact: the file's own head; the route only adds the page title to a file without a <title>.
    expect(keys(page(false), bare)).toEqual([['root/title', 'Offers', false]])
    const blank =
      '<!doctype html><html><head><title> </title><meta name="description" content=""></head></html>'
    expect(keys(page(false), blank)).toEqual([
      ['d-1/text:title', '', false],
      ['d-1/text:meta-description', '', true],
    ])
    // Both are written: the root description new, the blank meta as the spa's page text.
    const data = page(false)
    const slots = [
      ...htmlTextSlots(page(), bare, { scope: 'seo' }),
      ...htmlTextSlots(data, blank, { scope: 'seo' }),
    ]
    const description = { en: 'Seasonal massage offers in Dubai Marina, every day.', ar: 'عروض التدليك' }
    const out = fillTextSlots(
      data,
      slots.filter((s) => s.prop !== 'title'),
      [
        { key: 'root/description', ...description },
        { key: 'd-1/text:meta-description', ...description },
      ],
      { html: blank, scope: 'seo' },
    )
    expect(out.filled).toBe(2)
    expect(out.data.root.props.description).toEqual(description)
    expect(
      htmlContentParts((out.data.content[0]!.props as { content?: unknown }).content).texts[
        'meta-description'
      ]?.t,
    ).toEqual(description)
    // Without the scope the blank meta is no slot: nothing written there.
    expect(
      fillTextSlots(data, slots, [{ key: 'd-1/text:meta-description', ...description }], { html: blank })
        .filled,
    ).toBe(0)
  })

  it('runSiteTexts with scope seo: search rules in the prompt, only those fields written (drafts)', async () => {
    const { client, fetch } = reply([
      { key: 'root/title', en: 'Massage in Dubai · Seo Texts Spa', ar: 'تدليك في دبي' },
      {
        key: 'root/description',
        en: 'Thai and Swedish massage in Dubai Marina, open daily until midnight.',
        ar: 'تدليك تايلندي وسويدي في دبي مارينا، مفتوح يوميا حتى منتصف الليل.',
      },
      // Not a search field: ignored.
      { key: 'h-1/text', en: 'Changed', ar: 'تغير' },
      { key: 'o-1/text:title', en: 'Offers · Seo Texts Spa', ar: 'العروض' },
      { key: `o-1/text:${H.id}`, en: 'Changed', ar: 'تغير' },
    ])
    const run = await runSiteTexts({
      tenantId: seoTenant,
      slug: 'seo-texts',
      userId: ADMIN,
      scope: 'seo',
      schema,
      // The web passes designSignature (texts are content); here: the block types only.
      signature: (d) => JSON.stringify((d as { content: { type: string }[] }).content.map((n) => n.type)),
      client,
    })
    expect(run.result.skipped).toEqual([])
    expect(run.result.pages.map((p) => [p.slug, p.filled])).toEqual([
      ['', 2],
      ['offers', 1],
    ])
    const bodies = (fetch.mock.calls as unknown as [string, RequestInit][]).map((c) => String(c[1].body))
    expect(bodies.every((b) => b.includes('what search engines show'))).toBe(true)
    expect(bodies.some((b) => b.includes('h-1/text'))).toBe(false)
    const home = (await draftOf(ids.home!)) as {
      root: { props: Record<string, { en: string; ar: string }> }
      content: { props: { text: { en: string } } }[]
    }
    expect(home.root.props.description).toEqual({
      en: 'Thai and Swedish massage in Dubai Marina, open daily until midnight.',
      ar: 'تدليك تايلندي وسويدي في دبي مارينا، مفتوح يوميا حتى منتصف الليل.',
    })
    expect(home.content[0]!.props.text.en).toBe('Slow down')
    const texts = htmlContentParts(
      ((await draftOf(ids.offers!)) as { content: { props: { content?: unknown } }[] }).content[0]!.props
        .content,
    ).texts
    expect(Object.keys(texts)).toEqual(['title'])
    expect(texts.title!.t).toEqual({ en: 'Offers · Seo Texts Spa', ar: 'العروض' })
  })

  it('a queued run carries the scope through to the run', async () => {
    await withTenant(
      seoTenant,
      (tx) =>
        queueSiteTexts(tx, seoTenant, {
          via: 'template_apply',
          actorUserId: ADMIN,
          pageIds: [ids.offers!],
          scope: 'seo',
        }),
      app,
    )
    const { client, fetch } = reply([
      {
        key: 'o-1/text:meta-description',
        en: 'Seasonal offers on massages at Seo Texts Spa in Dubai.',
        ar: 'عروض',
      },
    ])
    expect(await runQueuedSiteTexts(seoTenant, { client })).toMatchObject({ state: 'done', scope: 'seo' })
    const body = String((fetch.mock.calls as unknown as [string, RequestInit][])[0]![1].body)
    expect(body).toContain('what search engines show')
    expect(body).not.toContain(`text:${H.id}`)
  })
})
