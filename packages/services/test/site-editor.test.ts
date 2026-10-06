import { closeAllDbs, tenants, webEvents, withTenant } from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  collectGlobalIds,
  contrastRatio,
  createSavedSection,
  DomainError,
  deleteSavedSection,
  describeSchedule,
  ensureSite,
  getEditablePage,
  getVersion,
  globalSectionsFor,
  globalSectionUsage,
  isScheduleVisible,
  labelVersion,
  listPages,
  listSavedSections,
  listVersions,
  type PreflightContext,
  pageBlockStats,
  pagePaths,
  preflight,
  preflightErrors,
  publishPage,
  removeAt,
  restoreVersion,
  saveDraft,
  scheduleState,
  scopeSectionCss,
  setAt,
  signPreviewToken,
  updateSavedSection,
  verifyPreviewToken,
} from '../src'

describe('section custom CSS', () => {
  const id = 'Section-abc'
  const scope = '[data-section-id="Section-abc"]'

  it('prefixes every selector, including inside @media', () => {
    const { css, removed } = scopeSectionCss(
      'h2, .lead { color: #333; letter-spacing: .02em }\n@media (min-width: 768px) { p > a:hover { text-decoration: underline } }',
      id,
    )
    expect(removed).toEqual([])
    expect(css).toBe(
      `${scope} h2,${scope} .lead{color:#333;letter-spacing:.02em}@media (min-width: 768px){${scope} p > a:hover{text-decoration:underline}}`,
    )
  })

  it('maps :scope, &, :root, html and body onto the section element itself', () => {
    const self = `${scope} > :not(style)`
    expect(scopeSectionCss(':scope { padding: 2rem } &:hover{opacity:.9} body{margin:0}', id).css).toBe(
      `${self}{padding:2rem}${self}:hover{opacity:.9}${self}{margin:0}`,
    )
  })

  it('drops imports, scripts, foreign urls, expressions, behaviors and markup', () => {
    const { css, removed } = scopeSectionCss(
      [
        '@import url("https://evil.test/x.css");',
        '.a { background: url(javascript:alert(1)); color: red }',
        '.b { background-image: url("http://insecure.test/a.png"); width: expression(alert(1)) }',
        '.c { behavior: url(x.htc); -moz-binding: url(x.xml#y) }',
        '.d { background: url(https://cdn.example.com/leaf.png) no-repeat }',
        '.e { content: "\\3c script" }',
        '@font-face { font-family: x; src: url(https://x.test/f.woff2) }',
        '.f { color: blue }</style><script>alert(1)</script>',
      ].join('\n'),
      id,
    )
    expect(css).not.toMatch(/import|javascript|expression|behavior|binding|http:|<|script|font-face/i)
    expect(css).toContain(`${scope} .a{color:red}`)
    expect(css).toContain(`${scope} .d{background:url(https://cdn.example.com/leaf.png) no-repeat}`)
    expect(removed).toEqual(
      expect.arrayContaining(['HTML tags', '@import', 'url() other than https images', 'expression()']),
    )
  })

  it('ignores anything over 4 KB instead of applying half a stylesheet', () => {
    const big = `.a{color:red}${' '.repeat(4100)}`
    expect(scopeSectionCss(big, id)).toMatchObject({ css: '', tooLarge: true })
  })

  it('cannot break out of the attribute selector with a hostile id', () => {
    expect(scopeSectionCss('p{color:red}', 'x"] body, [y').css).toBe(
      '[data-section-id="xbodyy"] p{color:red}',
    )
  })

  it('drops unclosed blocks and selectors with braces or at-signs', () => {
    expect(scopeSectionCss('.ok{color:red} .bad { color: blue', id).css).toBe(`${scope} .ok{color:red}`)
  })

  it('drops selectors that start with a sibling combinator (they would reach neighbouring blocks)', () => {
    expect(scopeSectionCss('~ * { display:none }', id)).toMatchObject({
      css: '',
      removed: ['selector “~ *”'],
    })
    const { css, removed } = scopeSectionCss('h2, + section, > p { color: red }', id)
    expect(css).toBe(`${scope} h2,${scope} > p{color:red}`)
    expect(removed).toEqual(['selector “+ section”'])
  })

  it('treats non-string input as no CSS (page JSON is only shape-checked)', () => {
    expect(scopeSectionCss(42 as never, id)).toEqual({ css: '', removed: [], tooLarge: false })
    expect(scopeSectionCss({ a: 1 } as never, id).css).toBe('')
  })
})

describe('section schedule (Asia/Dubai)', () => {
  const at = (iso: string) => new Date(iso)
  it('shows a date range inclusive of the last day in Dubai time', () => {
    const s = { from: '2026-03-01', to: '2026-03-14' }
    expect(scheduleState(s, at('2026-02-28T19:59:00Z'))).toBe('upcoming') // 23:59 Dubai on 28 Feb
    expect(scheduleState(s, at('2026-02-28T20:00:00Z'))).toBe('live') // 00:00 Dubai on 1 Mar
    expect(scheduleState(s, at('2026-03-14T19:59:00Z'))).toBe('live') // 23:59 Dubai on 14 Mar
    expect(scheduleState(s, at('2026-03-14T20:00:00Z'))).toBe('ended')
    expect(describeSchedule(s)).toBe('Shows 1 Mar 2026 – 14 Mar 2026')
  })
  it('supports times, open ends and ignores junk', () => {
    expect(isScheduleVisible({ from: '2026-03-01T18:30' }, at('2026-03-01T14:29:00Z'))).toBe(false)
    expect(isScheduleVisible({ from: '2026-03-01T18:30' }, at('2026-03-01T14:30:00Z'))).toBe(true)
    expect(scheduleState({ to: 'soon' })).toBe('always')
    expect(scheduleState(undefined)).toBe('always')
    expect(scheduleState({ from: 5, to: { x: 1 } } as never)).toBe('always')
    expect(describeSchedule({ from: 5 } as never)).toBe('Always shown')
  })
})

describe('contrast', () => {
  it('matches WCAG reference values', () => {
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2)
    expect(contrastRatio('nope', '#fff')).toBeNull()
  })
})

describe('preflight', () => {
  const colors = {
    bg: '#fafaf8',
    surface: '#ffffff',
    subtle: '#f3f2ef',
    fg: '#1c1c1a',
    accent: '#a5b8ad',
    accentFg: '#ffffff',
    accentSoft: '#e8eeea',
    inverseBg: '#1c1c1a',
    inverseFg: '#fafaf8',
  }
  const ctx: PreflightContext = {
    colors,
    currentSlug: '',
    pages: [
      { slug: '', visible: true, published: false },
      { slug: 'services', visible: true, published: true },
      { slug: 'offers', visible: false, published: true },
      { slug: 'contact', visible: true, published: false },
    ],
    globalIds: new Set(['g-1']),
  }
  const page = {
    root: { props: { title: { en: 'Home', ar: 'الرئيسية' } } },
    content: [
      {
        type: 'Hero',
        props: {
          id: 'hero',
          title: { en: 'A very long hero headline that keeps going well past what fits on a phone' },
          image: 'http://cdn.test/hero.jpg',
          imageAlt: { en: '' },
          background: 'none',
          buttons: [
            { label: { en: 'Offers', ar: 'العروض' }, action: 'page', target: 'offers', style: 'primary' },
            { label: { en: 'Contact', ar: 'تواصل' }, action: 'page', target: '/contact', style: 'link' },
            { label: { en: 'Menu', ar: 'القائمة' }, action: 'page', target: 'services', style: 'link' },
          ],
        },
      },
      {
        type: 'Section',
        props: {
          id: 'band',
          background: 'accent',
          content: [
            {
              type: 'Image',
              props: {
                id: 'img',
                src: 'data:image/png;base64,AA',
                alt: { en: '' },
                caption: { en: 'Our garden' },
              },
            },
            {
              type: 'Columns',
              props: { id: 'cols', ratio: '1-1', col1: [{ type: 'Spacer', props: { id: 'sp' } }], col2: [] },
            },
          ],
        },
      },
      { type: 'Section', props: { id: 'empty', background: 'none', content: [] } },
      { type: 'GlobalSection', props: { id: 'gone', sectionId: 'g-2' } },
      { type: 'GlobalSection', props: { id: 'kept', sectionId: 'g-1' } },
      {
        type: 'Section',
        props: {
          id: 'styled',
          background: 'none',
          advanced: { customCss: '@import url(x.css); h2{color:red}' },
          content: [{ type: 'Spacer', props: { id: 'sp2' } }],
        },
      },
    ],
  }
  const issues = preflight(page, ctx)
  const by = (rule: string, blockId: string | null) =>
    issues.filter((i) => i.rule === rule && i.blockId === blockId)

  it('blocks publishing on non-https images, with a one-click https fix when possible', () => {
    const errors = preflightErrors(issues)
    expect(errors.map((e) => e.blockId).sort()).toEqual(['hero', 'img'])
    expect(by('insecure-image', 'hero')[0]).toMatchObject({
      path: ['content', 0, 'props', 'image'],
      fix: { kind: 'set', value: 'https://cdn.test/hero.jpg' },
    })
    expect(by('insecure-image', 'img')[0]!.fix).toBeUndefined()
    expect(issues[0]!.severity).toBe('error')
  })

  it('flags missing alt text, offering the caption when there is one', () => {
    expect(by('alt', 'hero')[0]).toMatchObject({ field: 'imageAlt', fix: undefined })
    expect(by('alt', 'img')[0]).toMatchObject({
      path: ['content', 1, 'props', 'content', 0, 'props', 'alt'],
      fix: { kind: 'set', value: { en: 'Our garden' } },
    })
  })

  it('flags missing Arabic with an AI translation fix (never a copy of the English)', () => {
    const arabic = by('arabic', 'hero')
    expect(arabic).toHaveLength(1)
    expect(arabic[0]!.fix).toEqual({
      kind: 'translate',
      label: 'Translate with AI',
      text: 'A very long hero headline that keeps going well past what fits on a phone',
    })
    expect(by('arabic', 'img')).toHaveLength(1) // caption
    expect(by('arabic', null)).toHaveLength(0) // page title has both
  })

  it('flags long headings, low contrast, empty blocks, deleted globals and ignored CSS', () => {
    expect(by('heading-length', 'hero')).toHaveLength(1)
    expect(by('contrast', 'band')[0]!.message).toMatch(/accent band/)
    expect(by('contrast', 'hero')).toHaveLength(0)
    expect(by('empty', 'empty')[0]!.fix).toEqual({ kind: 'remove', label: 'Remove block' })
    expect(by('empty', 'cols')[0]).toMatchObject({
      field: 'col2',
      path: ['content', 1, 'props', 'content', 1, 'props', 'col2'],
    })
    expect(by('empty', 'cols')[0]!.fix).toBeUndefined()
    expect(by('empty', 'gone')).toHaveLength(1)
    expect(by('empty', 'kept')).toHaveLength(0)
    expect(by('css', 'styled')[0]!.message).toMatch(/@import/)
  })

  it('flags links to hidden and unpublished pages (the page being published counts as live)', () => {
    const links = by('link', 'hero').map((i) => i.message)
    expect(links).toEqual([
      'Link goes to a hidden page (/offers)',
      'Link goes to a page that isn’t published yet (/contact)',
    ])
    expect(by('link', 'hero')[0]!.path).toEqual(['content', 0, 'props', 'buttons', 0, 'target'])
    const again = preflight(page, { ...ctx, currentSlug: 'contact' })
    expect(again.filter((i) => i.rule === 'link')).toHaveLength(1)
  })

  it('tree helpers apply fixes immutably', () => {
    const fixed = setAt(page, ['content', 0, 'props', 'image'], 'https://cdn.test/hero.jpg')
    expect((fixed.content[0]!.props as { image: string }).image).toBe('https://cdn.test/hero.jpg')
    expect(page.content[0]!.props.image).toBe('http://cdn.test/hero.jpg')
    const removed = removeAt(page, ['content', 2])
    expect(removed.content.map((n) => n.props.id)).toEqual(['hero', 'band', 'gone', 'kept', 'styled'])
    expect(collectGlobalIds(page)).toEqual(['g-2', 'g-1'])
  })
})

describe('preview tokens', () => {
  const secret = 'test-secret-test-secret-test-secret'
  const claims = { tenantId: 't-1', pageId: 'p-1', expiresAt: new Date('2026-10-10T00:00:00Z') }
  it('round-trips until it expires', () => {
    const token = signPreviewToken(claims, secret)
    expect(verifyPreviewToken(token, secret, new Date('2026-10-09T23:59:59Z'))).toEqual({
      tenantId: 't-1',
      pageId: 'p-1',
      exp: Math.floor(claims.expiresAt.getTime() / 1000),
    })
    expect(verifyPreviewToken(token, secret, new Date('2026-10-10T00:00:00Z'))).toBeNull()
  })
  it('rejects tampering, other secrets and junk', () => {
    const token = signPreviewToken(claims, secret)
    const [payload, sig] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ t: 't-2', p: 'p-1', e: 1_999_999_999 })).toString('base64url')
    const now = new Date('2026-10-01T00:00:00Z')
    expect(verifyPreviewToken(`${forged}.${sig}`, secret, now)).toBeNull()
    expect(verifyPreviewToken(`${payload}.${sig}x`, secret, now)).toBeNull()
    expect(verifyPreviewToken(token, 'another-secret', now)).toBeNull()
    expect(verifyPreviewToken('a.b.c', secret, now)).toBeNull()
    expect(verifyPreviewToken(42, secret, now)).toBeNull()
    expect(() => signPreviewToken(claims, '')).toThrow()
  })
})

describe('editor data (saved sections, versions, block stats)', () => {
  const { platform, app } = testDbs()
  const ids = {} as Record<string, string>
  const tx = <T>(fn: Parameters<typeof withTenant<T>>[1], tenant = ids.tenant!) => withTenant(tenant, fn, app)
  const node = (text: string) => ({ type: 'Heading', props: { id: 'h', text: { en: text } } })

  beforeAll(async () => {
    await resetTestDatabase()
    const [a, b] = await platform
      .insert(tenants)
      .values([
        { slug: 'calm', name: 'Calm Spa' },
        { slug: 'other', name: 'Other Spa' },
      ])
      .returning()
    ids.tenant = a!.id
    ids.other = b!.id
    await tx((db) =>
      ensureSite(db, ids.tenant!, {
        key: 'zen',
        name: 'Zen',
        theme: {},
        pages: [{ slug: '', title: { en: 'Home' }, data: { root: { props: {} }, content: [node('v1')] } }],
      }),
    )
    ids.home = (await tx((db) => listPages(db, ids.tenant!)))[0]!.id
  })
  afterAll(() => closeAllDbs())

  it('saves, renames, resolves and deletes sections; globals in use cannot be deleted', async () => {
    const promo = await tx((db) =>
      createSavedSection(db, {
        tenantId: ids.tenant!,
        name: ' Promo bar ',
        data: node('Ramadan'),
        isGlobal: true,
      }),
    )
    const plain = await tx((db) =>
      createSavedSection(db, { tenantId: ids.tenant!, name: 'Quote', data: node('Calm'), isGlobal: false }),
    )
    expect(promo.name).toBe('Promo bar')
    expect((await tx((db) => listSavedSections(db, ids.tenant!))).map((s) => s.id)).toEqual([
      promo.id,
      plain.id,
    ])
    // Tenant isolation: the other spa sees nothing.
    expect(await tx((db) => listSavedSections(db, ids.other!), ids.other!)).toEqual([])

    const page = {
      root: { props: {} },
      content: [{ type: 'GlobalSection', props: { id: 'g', sectionId: promo.id } }],
    }
    await tx((db) => saveDraft(db, { tenantId: ids.tenant!, pageId: ids.home!, data: page }))
    await tx((db) => updateSavedSection(db, ids.tenant!, promo.id, { data: node('Eid offers') }))
    const globals = await tx((db) => globalSectionsFor(db, ids.tenant!, page))
    expect(globals[promo.id]).toEqual(node('Eid offers'))
    expect(await tx((db) => globalSectionsFor(db, ids.other!, page), ids.other!)).toEqual({})

    await expect(tx((db) => deleteSavedSection(db, ids.tenant!, promo.id))).rejects.toThrow(/on 1 page/)
    await tx((db) => deleteSavedSection(db, ids.tenant!, plain.id))
    // Live usage: only once a page showing it is published.
    const live = () => tx((db) => globalSectionUsage(db, ids.tenant!, promo.id, { live: true }))
    expect(await live()).toEqual([])
    await tx((db) => publishPage(db, { tenantId: ids.tenant!, pageId: ids.home! }))
    expect(await live()).toEqual([ids.home])
    // Removing it from the draft isn't enough while the live page shows it; publishing that frees it.
    await tx((db) =>
      saveDraft(db, { tenantId: ids.tenant!, pageId: ids.home!, data: { root: { props: {} }, content: [] } }),
    )
    expect(await tx((db) => globalSectionUsage(db, ids.tenant!, promo.id))).toEqual([ids.home])
    await expect(tx((db) => deleteSavedSection(db, ids.tenant!, promo.id))).rejects.toThrow(/on 1 page/)
    await tx((db) => publishPage(db, { tenantId: ids.tenant!, pageId: ids.home! }))
    expect(await live()).toEqual([])
    await tx((db) => deleteSavedSection(db, ids.tenant!, promo.id))
    expect(await tx((db) => listSavedSections(db, ids.tenant!))).toEqual([])
  })

  it('labels versions and restores an old one as the draft', async () => {
    const v1 = { root: { props: {} }, content: [node('first')] }
    await tx((db) => saveDraft(db, { tenantId: ids.tenant!, pageId: ids.home!, data: v1 }))
    const published = await tx((db) => publishPage(db, { tenantId: ids.tenant!, pageId: ids.home! }))
    await tx((db) => labelVersion(db, ids.tenant!, published.id, '  Launch  '))
    const v2 = { root: { props: {} }, content: [node('second')] }
    const second = await tx((db) => saveDraft(db, { tenantId: ids.tenant!, pageId: ids.home!, data: v2 }))
    const restored = await tx((db) =>
      restoreVersion(db, { tenantId: ids.tenant!, pageId: ids.home!, versionId: published.id }),
    )
    expect(restored.data).toEqual(v1)
    expect((await tx((db) => getEditablePage(db, ids.tenant!, ids.home!)))!.data).toEqual(v1)
    // The saved draft it replaced is still in the history, unchanged.
    expect(restored.draft.id).not.toBe(second.id)
    const versions = await tx((db) => listVersions(db, ids.tenant!, ids.home!))
    expect(versions.slice(0, 3).map((v) => v.id)).toEqual([restored.draft.id, second.id, published.id])
    expect((await tx((db) => getVersion(db, ids.tenant!, second.id)))!.data).toEqual(v2)
    expect(versions.find((v) => v.id === published.id)!.label).toBe('Launch')

    // A named draft is never overwritten: the next save starts a new draft, and publishing keeps the name.
    await tx((db) => labelVersion(db, ids.tenant!, restored.draft.id, 'Try A'))
    const v3 = { root: { props: {} }, content: [node('third')] }
    const third = await tx((db) => saveDraft(db, { tenantId: ids.tenant!, pageId: ids.home!, data: v3 }))
    expect(third.id).not.toBe(restored.draft.id)
    expect((await tx((db) => getVersion(db, ids.tenant!, restored.draft.id)))!.data).toEqual(v1)
    await tx((db) => labelVersion(db, ids.tenant!, third.id, 'Try B'))
    const live = await tx((db) => publishPage(db, { tenantId: ids.tenant!, pageId: ids.home! }))
    expect(live).toMatchObject({ id: third.id, status: 'published', label: 'Try B' })
    const named = await tx((db) => saveDraft(db, { tenantId: ids.tenant!, pageId: ids.home!, data: v2 }))
    await tx((db) => labelVersion(db, ids.tenant!, named.id, 'Kept'))
    const edited = await tx((db) => publishPage(db, { tenantId: ids.tenant!, pageId: ids.home!, data: v3 }))
    expect(edited.id).not.toBe(named.id)
    expect(await tx((db) => getVersion(db, ids.tenant!, named.id))).toMatchObject({
      status: 'draft',
      label: 'Kept',
      data: v2,
    })
    await expect(
      tx(
        (db) => restoreVersion(db, { tenantId: ids.other!, pageId: ids.home!, versionId: published.id }),
        ids.other!,
      ),
    ).rejects.toBeInstanceOf(DomainError)
    await expect(tx((db) => labelVersion(db, ids.other!, published.id, 'x'), ids.other!)).rejects.toThrow(
      /not found/,
    )
  })

  it('computes per-block reach and clicks over the last 30 days', async () => {
    const ev = (session: string, type: string, extra: Record<string, unknown> = {}) => ({
      tenantId: ids.tenant!,
      sessionHash: session,
      type,
      path: '/s/calm',
      ...extra,
    })
    await tx((db) =>
      db
        .insert(webEvents)
        .values([
          ev('s1', 'pageview'),
          ev('s2', 'pageview'),
          ev('s3', 'pageview'),
          ev('s4', 'pageview'),
          ev('s1', 'block_view', { blockId: 'hero' }),
          ev('s2', 'block_view', { blockId: 'hero' }),
          ev('s2', 'block_view', { blockId: 'hero' }),
          ev('s3', 'block_view', { blockId: 'faq' }),
          ev('s1', 'booking_start', { blockId: 'hero' }),
          ev('s2', 'wa_click', { blockId: 'hero' }),
          ev('s9', 'pageview', { path: '/s/calm/services' }),
          ev('s5', 'block_view', { blockId: 'hero', ts: new Date(Date.now() - 40 * 86_400_000) }),
        ]),
    )
    const stats = await tx((db) =>
      pageBlockStats(db, {
        tenantId: ids.tenant!,
        paths: pagePaths('calm', ''),
        blockIds: ['hero', 'faq', 'none'],
      }),
    )
    expect(stats.sessions).toBe(4)
    expect(stats.blocks).toEqual({
      hero: { seen: 2, seenPct: 50, clicks: 2 },
      faq: { seen: 1, seenPct: 25, clicks: 0 },
    })
    const other = await tx(
      (db) => pageBlockStats(db, { tenantId: ids.other!, paths: ['/s/calm'], blockIds: ['hero'] }),
      ids.other!,
    )
    expect(other).toEqual({ sessions: 0, days: 30, blocks: {} })
  })
})
