import { closeAllDbs, pageVersions, sitePages, tenants, withTenant } from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  addPage,
  applySiteCopy,
  applySiteCopyToPages,
  type BlockSpec,
  checkNodes,
  DomainError,
  ensureSite,
  exportStudioTemplate,
  extractSiteCopy,
  getEditablePage,
  getSite,
  hasCopySlots,
  listPages,
  listStudioTemplates,
  parseTemplateJson,
  publishAll,
  publishPage,
  type SiteCopy,
  type SiteTemplate,
  sanitizeTemplatePages,
  saveDraft,
  saveStudioTemplate,
  snapshotSite,
  studioToSiteTemplate,
  switchTemplate,
  templateKeyFrom,
  templateUndoChanges,
  undoTemplateSwitch,
  updateStudioTemplate,
  updateTheme,
} from '../src'

const { platform, app } = testDbs()
const ids = {} as Record<string, string>
const tx = <T>(fn: Parameters<typeof withTenant<T>>[1], tenant = ids.tenant!) => withTenant(tenant, fn, app)

const node = (type: string, id: string, props: Record<string, unknown> = {}) => ({
  type,
  props: { id, ...props },
})
const page = (headline: string) => ({
  root: { props: { title: { en: headline } } },
  content: [
    node('Hero', 'x-hero-1--hero', {
      title: { en: headline },
      subtitle: { en: 'Sub' },
      image: 'https://cdn/x.jpg',
    }),
    node('Section', 'x-section-2', {
      content: [
        node('Columns', 'x-columns-3', {
          col1: [node('Heading', 'x-heading-4--usp-1-title', { text: { en: 'USP one' } })],
          col2: [node('RichText', 'x-richtext-5--usp-1-text', { text: { en: 'USP one text' } })],
          col3: [],
          col4: [],
        }),
        node('RichText', 'x-richtext-6--about', { text: { en: 'About us at Calm Spa' } }),
      ],
    }),
    node('FAQ', 'x-faq-7--faq', { items: [{ q: { en: 'Q?' }, a: { en: 'A.' } }] }),
    node('BookingCTA', 'x-bookingcta-8--cta', { title: { en: 'Book' }, text: { en: 'Now' } }),
    node('ButtonGroup', 'x-buttongroup-9', {
      buttons: [
        { label: { en: 'Instagram' }, action: 'url', target: 'https://instagram.com/calmspa' },
        { label: { en: 'Menu' }, action: 'page', target: 'services' },
      ],
    }),
  ],
})
const template = (key: string, headline: string): SiteTemplate => ({
  key,
  name: key,
  theme: { accent: key === 'zen' ? '#8a7560' : '#3d5a80' },
  pages: [
    { slug: '', title: { en: 'Home' }, data: page(headline) },
    { slug: 'about', title: { en: 'About' }, data: page(`${headline} about`) },
  ],
})

const copy: SiteCopy = {
  hero: { headline: { en: 'New headline', ar: 'عنوان جديد' }, sub: { en: 'New sub', ar: 'نص جديد' } },
  about: { en: 'New about', ar: 'نبذة جديدة' },
  usps: [
    { title: { en: 'U1', ar: 'م1' }, text: { en: 'U1 text', ar: 'نص م1' } },
    { title: { en: 'U2' }, text: { en: 'U2 text' } },
    { title: { en: 'U3' }, text: { en: 'U3 text' } },
  ],
  faqs: [1, 2, 3, 4].map((i) => ({ q: { en: `Q${i}` }, a: { en: `A${i}` } })),
  cta: { title: { en: 'CTA title', ar: 'احجز' }, text: { en: 'CTA text' } },
}

beforeAll(async () => {
  await resetTestDatabase()
  const [a, b] = await platform
    .insert(tenants)
    .values([
      { slug: 'calm-t', name: 'Calm Spa' },
      { slug: 'other-t', name: 'Other Spa' },
    ])
    .returning()
  ids.tenant = a!.id
  ids.other = b!.id
})
afterAll(() => closeAllDbs())

describe('AI copy slots', () => {
  it('fills slotted nodes on every page without touching the input', () => {
    const t = template('zen', 'Slow down')
    const before = structuredClone(t)
    const { template: out, filled } = applySiteCopy(t, copy)
    expect(t).toEqual(before)
    // hero, usp title, usp text, about, faq, cta on two pages
    expect(filled).toBe(12)
    const home = out.pages[0]!.data as ReturnType<typeof page>
    expect(home.content[0]!.props).toMatchObject({ title: copy.hero.headline, subtitle: copy.hero.sub })
    expect(home.content[2]!.props.items).toEqual(copy.faqs)
    expect(home.content[3]!.props).toMatchObject({ title: copy.cta.title, text: copy.cta.text })
    expect(extractSiteCopy(out.pages)).toMatchObject({
      hero: copy.hero,
      about: copy.about,
      cta: copy.cta,
      faqs: copy.faqs,
      usps: [copy.usps[0], { title: { en: '' } }, { title: { en: '' } }],
    })
  })

  it('reads the current copy for the preview', () => {
    const current = extractSiteCopy(template('zen', 'Slow down').pages)
    expect(current.hero.headline).toEqual({ en: 'Slow down' })
    expect(current.about).toEqual({ en: 'About us at Calm Spa' })
    expect(current.usps[0]).toEqual({ title: { en: 'USP one' }, text: { en: 'USP one text' } })
  })
})

describe('sanitising a site into a template', () => {
  it('renews ids (keeping copy slots), templatises the name and strips images and outside links', () => {
    const [home] = sanitizeTemplatePages(template('zen', 'Calm Spa welcomes you').pages, {
      key: 'calm-sig',
      tenantName: 'Calm Spa',
    })
    const data = home!.data as ReturnType<typeof page>
    expect(data.content[0]!.props).toMatchObject({
      id: 'calm-sig-hero-1--hero',
      title: { en: '{name} welcomes you' },
      image: '',
    })
    expect(JSON.stringify(data)).not.toContain('Calm Spa')
    expect(JSON.stringify(data)).toContain('calm-sig-richtext-')
    expect(JSON.stringify(data)).toContain('--about')
    const buttons = data.content[4]!.props.buttons as { target: string }[]
    expect(buttons.map((b) => b.target)).toEqual(['', 'services'])
  })

  it('replaces client reviews, strips contact details and only rewrites whole words of copy', () => {
    const data = {
      root: { props: { title: { en: 'Hero' } } },
      content: [
        node('Hero', 'h-1--hero', {
          title: { en: 'Hero Spa — Thai massage by hero', ar: 'سبا Hero' },
          subtitle: { en: 'Call +971 4 123 4567 or mail hi@hero.ae, see https://hero.ae/book today' },
          image: '',
        }),
        node('Testimonials', 't-2', {
          title: { en: 'Kind words' },
          items: [{ quote: { en: 'Loved it' }, author: 'Fatima Real', detail: { en: '' } }],
          layout: 'grid',
        }),
        node('RichText', 'r-3', { text: { en: 'Heroes and Heroic rituals since 2019 – 2024, AED 350' } }),
      ],
    }
    const sample = [{ quote: { en: 'Sample quote' }, author: 'Guest', detail: { en: '' } }]
    const [home] = sanitizeTemplatePages([{ slug: '', title: { en: 'Hero home' }, data }], {
      key: 'k',
      tenantName: 'Hero',
      samples: { Testimonials: { items: sample } },
    })
    const out = home!.data as typeof data
    expect(home!.title).toEqual({ en: '{name} home' })
    expect(out.content.map((n) => n.type)).toEqual(['Hero', 'Testimonials', 'RichText'])
    expect(out.content[0]!.props.title).toEqual({
      en: '{name} Spa — Thai massage by {name}',
      ar: 'سبا {name}',
    })
    expect(out.content[0]!.props.subtitle).toEqual({ en: 'Call or mail , see today' })
    expect(out.content[1]!.props.items).toEqual(sample)
    expect(JSON.stringify(out)).not.toContain('Fatima')
    expect(out.content[2]!.props.text).toEqual({ en: 'Heroes and Heroic rituals since 2019 – 2024, AED 350' })
    // Without samples, customer quotes are dropped rather than copied.
    const [bare] = sanitizeTemplatePages([{ slug: '', title: { en: 'Home' }, data }], { key: 'k' })
    expect((bare!.data as typeof data).content[1]!.props.items).toEqual([])
  })

  it('derives keys from names', () => {
    expect(templateKeyFrom('  Birch Signature ✦ 2026 ')).toBe('birch-signature-2026')
    expect(templateKeyFrom('سبا')).toBe('template')
  })
})

describe('template JSON', () => {
  const valid = {
    format: 'spamanagement.site-template',
    version: 1,
    key: 'sand-dunes',
    name: 'Sand dunes',
    description: 'Warm',
    theme: { accent: '#b0532f' },
    pages: [{ slug: '', title: { en: 'Home' }, data: page('Hi') }],
  }

  it('accepts an export and rejects broken files', () => {
    const ok = parseTemplateJson(JSON.stringify(valid))
    expect(ok.ok && ok.template.key).toBe('sand-dunes')
    expect(parseTemplateJson('{nope').ok).toBe(false)
    expect(parseTemplateJson(JSON.stringify({ ...valid, format: 'x' })).ok).toBe(false)
    expect(parseTemplateJson(JSON.stringify({ ...valid, key: 'Bad Key' })).ok).toBe(false)
    const noHome = { ...valid, pages: [{ ...valid.pages[0], slug: 'about' }] }
    expect(parseTemplateJson(JSON.stringify(noHome))).toEqual({
      ok: false,
      error: 'The template needs a home page.',
    })
    const dup = { ...valid, pages: [valid.pages[0], valid.pages[0]] }
    expect(parseTemplateJson(JSON.stringify(dup)).ok).toBe(false)
    const badData = { ...valid, pages: [{ slug: '', title: { en: 'Home' }, data: { content: 'x' } }] }
    expect(parseTemplateJson(JSON.stringify(badData)).ok).toBe(false)
  })
})

describe('preset tree check', () => {
  const spec: BlockSpec = {
    Section: { required: ['background', 'content'], slots: ['content'] },
    Heading: { required: ['text', 'level'], slots: [] },
  }
  it('reports unknown blocks, missing props and nested problems', () => {
    expect(
      checkNodes(
        [
          {
            type: 'Section',
            props: { background: 'none', content: [{ type: 'Heading', props: { text: {}, level: 'h2' } }] },
          },
        ],
        spec,
      ),
    ).toEqual([])
    expect(
      checkNodes(
        [
          { type: 'Nope', props: {} },
          {
            type: 'Section',
            props: { background: 'none', content: [{ type: 'Heading', props: { text: {} } }] },
          },
          'junk',
        ],
        spec,
      ),
    ).toEqual([
      'content[0]: unknown block "Nope"',
      'content[1].content[0] Heading: missing "level"',
      'content[2]: not a block',
    ])
  })
})

describe('template switching with undo', () => {
  it('first switch creates the site; no undo is recorded', async () => {
    const site = await tx((db) => switchTemplate(db, ids.tenant!, template('zen', 'Slow down')))
    expect(site.templateUndo).toBeNull()
    const pages = await tx((db) => listPages(db, ids.tenant!))
    ids.home = pages.find((p) => p.slug === '')!.id
    ids.about = pages.find((p) => p.slug === 'about')!.id
    await tx((db) => publishPage(db, { tenantId: ids.tenant!, pageId: ids.home! }))
    await tx((db) =>
      saveDraft(db, { tenantId: ids.tenant!, pageId: ids.about!, data: page('My about draft') }),
    )
  })

  it('undo restores the template, theme and drafts and removes pages the switch added', async () => {
    const desert: SiteTemplate = {
      ...template('desert', 'Desert'),
      pages: [
        ...template('desert', 'Desert').pages,
        { slug: 'offers', title: { en: 'Offers' }, data: page('Offers') },
      ],
    }
    const switched = await tx((db) => switchTemplate(db, ids.tenant!, desert, { replaceContent: true }))
    expect(switched.templateKey).toBe('desert')
    expect(switched.templateUndo).toMatchObject({ templateKey: 'zen', theme: { accent: '#8a7560' } })
    expect((await tx((db) => listPages(db, ids.tenant!))).map((p) => p.slug)).toEqual(['', 'about', 'offers'])
    expect((await tx((db) => getEditablePage(db, ids.tenant!, ids.home!)))?.data).toEqual(page('Desert'))

    const undone = await tx((db) => undoTemplateSwitch(db, ids.tenant!))
    expect(undone).toMatchObject({ templateKey: 'zen', theme: { accent: '#8a7560' }, templateUndo: null })
    expect((await tx((db) => listPages(db, ids.tenant!))).map((p) => p.slug)).toEqual(['', 'about'])
    // Home had no draft: the switch's draft is dropped and the live version is what the editor opens again.
    const home = await tx((db) => getEditablePage(db, ids.tenant!, ids.home!))
    expect(home?.version?.status).toBe('published')
    expect(home?.data).toEqual(page('Slow down'))
    // About had a draft: it comes back.
    expect((await tx((db) => getEditablePage(db, ids.tenant!, ids.about!)))?.data).toEqual(
      page('My about draft'),
    )
    await expect(tx((db) => undoTemplateSwitch(db, ids.tenant!))).rejects.toBeInstanceOf(DomainError)
  })

  it('theme-only switches are undoable too', async () => {
    await tx((db) => switchTemplate(db, ids.tenant!, template('nordic', 'Nordic')))
    const undone = await tx((db) => undoTemplateSwitch(db, ids.tenant!))
    expect(undone.templateKey).toBe('zen')
    expect((await tx((db) => getEditablePage(db, ids.tenant!, ids.about!)))?.data).toEqual(
      page('My about draft'),
    )
  })

  it('undo is refused once anything the switch wrote was edited, and the edits survive', async () => {
    const switched = await tx((db) =>
      switchTemplate(db, ids.tenant!, template('nordic', 'Nordic'), { replaceContent: true }),
    )
    expect(switched.templateUndo?.pages).toHaveLength(2)
    expect(await tx((db) => templateUndoChanges(db, ids.tenant!))).toEqual([])
    const edited = page('Edited after the switch')
    await tx((db) => saveDraft(db, { tenantId: ids.tenant!, pageId: ids.home!, data: edited }))
    expect(await tx((db) => templateUndoChanges(db, ids.tenant!))).toEqual(['Home'])
    await expect(tx((db) => undoTemplateSwitch(db, ids.tenant!))).rejects.toThrow(/Home changed/)
    expect((await tx((db) => getEditablePage(db, ids.tenant!, ids.home!)))?.data).toEqual(edited)
    expect((await tx((db) => getSite(db, ids.tenant!)))?.templateKey).toBe('nordic')

    // A theme change after a (theme-only) switch blocks undo too.
    await tx((db) => switchTemplate(db, ids.tenant!, template('zen', 'Zen')))
    expect(await tx((db) => templateUndoChanges(db, ids.tenant!))).toEqual([])
    await tx((db) => updateTheme(db, ids.tenant!, { accent: '#111111' }))
    expect(await tx((db) => templateUndoChanges(db, ids.tenant!))).toEqual(['Theme'])
    await expect(tx((db) => undoTemplateSwitch(db, ids.tenant!))).rejects.toBeInstanceOf(DomainError)
    await tx((db) => updateTheme(db, ids.tenant!, { accent: '#8a7560' }))

    // Keeping the theme (AI copy for the current template) leaves the spa's look alone.
    const kept = await tx((db) =>
      switchTemplate(db, ids.tenant!, template('zen', 'Zen'), { keepTheme: true }),
    )
    expect(kept.theme).toEqual({ accent: '#8a7560' })
  })

  it("AI copy for the current template is written into the spa's own pages, keeping their layout", async () => {
    const before = await tx((db) => getEditablePage(db, ids.tenant!, ids.home!))
    expect(hasCopySlots([{ data: before!.data }])).toBe(true)
    expect(hasCopySlots([{ data: { root: {}, content: [node('Hero', 'legacy-hero')] } }])).toBe(false)
    const written = await tx((db) => applySiteCopyToPages(db, ids.tenant!, copy))
    expect(written).toEqual({ filled: 12, pages: 2 })
    const home = (await tx((db) => getEditablePage(db, ids.tenant!, ids.home!)))!.data as ReturnType<
      typeof page
    >
    expect(home.content[0]!.props).toMatchObject({ title: copy.hero.headline, image: 'https://cdn/x.jpg' })
    // Everything outside the copy slots (here: the buttons) is untouched.
    expect(home.content[4]).toEqual((before!.data as ReturnType<typeof page>).content[4])
  })
})

describe('pages from page templates', () => {
  it('adds the page with a draft and a free slug', async () => {
    const first = await tx((db) =>
      addPage(db, { tenantId: ids.tenant!, slug: 'about', title: { en: 'About 2' }, data: page('Story') }),
    )
    expect(first.slug).toBe('about-2')
    const versions = await tx((db) => db.select().from(pageVersions).where(eq(pageVersions.pageId, first.id)))
    expect(versions).toHaveLength(1)
    expect(versions[0]!.status).toBe('draft')
    const reserved = await tx((db) =>
      addPage(db, { tenantId: ids.tenant!, slug: 'book', title: { en: 'Book' }, data: page('x') }),
    )
    expect(reserved.slug).toBe('book-2')
    await expect(
      tx(
        (db) => addPage(db, { tenantId: ids.other!, slug: 'x', title: { en: 'X' }, data: page('x') }),
        ids.other,
      ),
    ).rejects.toBeInstanceOf(DomainError)
    await tx((db) => db.delete(sitePages).where(eq(sitePages.id, reserved.id)))
  })
})

describe('template studio', () => {
  it('snapshots live pages only and stores a sanitised studio template', async () => {
    await expect(tx((db) => snapshotSite(db, ids.other!), ids.other)).rejects.toBeInstanceOf(DomainError)
    await tx((db) => publishAll(db, ids.tenant!))
    const snap = await tx((db) => snapshotSite(db, ids.tenant!))
    expect(snap.pages.map((p) => p.slug)).toEqual(['', 'about', 'about-2'])
    expect(snap.theme).toEqual({ accent: '#8a7560' })

    const key = templateKeyFrom('Calm Signature')
    const row = await saveStudioTemplate(platform, {
      key,
      name: 'Calm Signature',
      theme: snap.theme,
      pages: sanitizeTemplatePages(snap.pages, { key, tenantName: 'Calm Spa' }),
    })
    expect(JSON.stringify(row.pages)).not.toContain('Calm Spa')
    // Saved from a spa's site: hidden from spas until a platform admin switches it on.
    expect(row.active).toBe(false)
    await expect(
      saveStudioTemplate(platform, { key, name: 'Again', theme: {}, pages: snap.pages }),
    ).rejects.toBeInstanceOf(DomainError)

    // Import with the same key replaces it; inactive rows are hidden from spas.
    const replaced = await saveStudioTemplate(
      platform,
      { ...exportStudioTemplate(row), name: 'Calm Signature v2' },
      { replace: true },
    )
    expect(replaced.id).toBe(row.id)
    await updateStudioTemplate(platform, row.id, { active: false, sort: 3 })
    expect(await listStudioTemplates(platform, { activeOnly: true })).toHaveLength(0)
    const [all] = await listStudioTemplates(platform)
    expect(all).toMatchObject({ name: 'Calm Signature v2', active: false, sort: 3 })

    // A spa can start from it like any built-in.
    const fromStudio = studioToSiteTemplate(all!)
    await tx((db) => ensureSite(db, ids.other!, fromStudio), ids.other)
    const other = await tx((db) => getSite(db, ids.other!), ids.other)
    expect(other?.templateKey).toBe(key)
  })
})
