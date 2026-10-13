// R30: the weekly search check of a spa's live pages (pure).
import { describe, expect, it } from 'vitest'
import { listHtmlDesignTexts } from '../src/html-design'
import { htmlImagesWithoutAlt, type SeoCheckPage, seoCheck, seoSeverity } from '../src/seo-check'

const GOOD_DESC = 'Thai, Swedish and hot stone massage in Dubai Marina, open daily until midnight.'
const block = (slug: string, root: Record<string, unknown>, content: unknown[] = []): SeoCheckPage => ({
  slug,
  data: { root: { props: root }, content },
})
const html = (body: string, head = '<title>Seaside Spa · Massage in Dubai</title>') =>
  `<!doctype html><html><head>${head}<meta name="description" content="${GOOD_DESC}"></head><body>${body}</body></html>`
const design = (slug: string, source: string, props: Record<string, unknown> = {}): SeoCheckPage => ({
  slug,
  html: source,
  data: {
    root: { props: { htmlDesign: true, title: { en: '{name}' }, description: { en: '' } } },
    content: [{ type: 'HtmlDesign', props: { id: 'd', html: '', phoneFixes: false, ...props } }],
  },
})
const run = (pages: SeoCheckPage[], opts: { arabic?: boolean; sitemap?: string[] } = {}) =>
  seoCheck({
    spaName: 'Seaside Spa',
    arabic: opts.arabic ?? false,
    pages,
    sitemap: opts.sitemap ?? pages.map((p) => p.slug),
  })
const codes = (r: ReturnType<typeof run>) => r.findings.map((f) => `${f.path} ${f.locale} ${f.code}`)

describe('seo check (R30)', () => {
  it('a good page has no findings', () => {
    const r = run([
      block('', { title: { en: 'Massage in Dubai Marina · {name}' }, description: { en: GOOD_DESC } }),
    ])
    expect(r.findings).toEqual([])
    expect(r.counts).toEqual({ high: 0, medium: 0 })
  })

  it('missing title and description are high; length problems medium', () => {
    const r = run([
      block('', { title: { en: '' }, description: { en: '' } }),
      block('services', { title: { en: 'x'.repeat(61) }, description: { en: 'Too short.' } }),
      block('about', { title: { en: 'About us' }, description: { en: 'y'.repeat(161) } }),
    ])
    expect(codes(r)).toEqual([
      '/ en title_missing',
      '/ en description_missing',
      '/services en title_long',
      '/services en description_short',
      '/about en description_long',
    ])
    expect(r.counts).toEqual({ high: 2, medium: 3 })
    expect(r.findings[2]!.detail).toBe('The title is 61 characters (keep it to 60).')
    expect(seoSeverity('not_in_sitemap')).toBe('high')
    expect(seoSeverity('image_alt_missing')).toBe('medium')
  })

  it('{name} counts as the spa name; whitespace is collapsed', () => {
    // 'Seaside Spa ' (12) + 49 = 61 characters.
    const r = run([block('', { title: { en: `{name}  ${'z'.repeat(49)}` }, description: { en: GOOD_DESC } })])
    expect(codes(r)).toEqual(['/ en title_long'])
  })

  it('duplicate titles and descriptions across pages (same language), with the other pages named', () => {
    const r = run([
      block('', { title: { en: 'Seaside Spa' }, description: { en: GOOD_DESC } }),
      block('services', { title: { en: 'seaside spa' }, description: { en: GOOD_DESC } }),
      block('contact', {
        title: { en: 'Contact Seaside Spa' },
        description: { en: `${GOOD_DESC} Call us.` },
      }),
    ])
    expect(codes(r)).toEqual([
      '/ en title_duplicate',
      '/ en description_duplicate',
      '/services en title_duplicate',
      '/services en description_duplicate',
    ])
    expect(r.findings[0]!.detail).toBe('Same title as /services.')
    expect(r.findings[2]!.detail).toBe('Same title as /.')
  })

  it('Arabic: only where the Arabic page shows its own Arabic text (else the English finding covers it)', () => {
    const r = run(
      [
        block('', {
          title: { en: 'Massage in Dubai', ar: 'م'.repeat(61) },
          description: { en: GOOD_DESC, ar: 'قصير' },
        }),
        // No Arabic: the Arabic page falls back to English — no Arabic findings of its own.
        block('services', { title: { en: '' }, description: { en: 'short' } }),
        block('about', {
          title: { en: 'About', ar: 'تدليك في دبي' },
          description: { en: GOOD_DESC, ar: 'قصير' },
        }),
      ],
      { arabic: true },
    )
    expect(codes(r)).toEqual([
      '/ en description_duplicate',
      '/ ar title_long',
      '/ ar description_short',
      '/ ar description_duplicate',
      '/services en title_missing',
      '/services en description_short',
      '/about en description_duplicate',
      '/about ar description_short',
      '/about ar description_duplicate',
    ])
    // Without Arabic on the site, Arabic texts are not checked.
    expect(
      codes(
        run([
          block('', {
            title: { en: 'Massage in Dubai', ar: 'م'.repeat(61) },
            description: { en: GOOD_DESC },
          }),
        ]),
      ),
    ).toEqual([])
  })

  it('block images: an image with an empty alt (Image block, gallery items, {x}Alt) — not backgrounds', () => {
    const r = run([
      block('', { title: { en: 'Massage in Dubai' }, description: { en: GOOD_DESC } }, [
        { type: 'Image', props: { id: 'i1', src: '/files/a.jpg', alt: { en: '' } } },
        { type: 'Image', props: { id: 'i2', src: { src: '/files/b.jpg' }, alt: { en: 'Hot stones' } } },
        // No picture chosen yet: nothing to describe.
        { type: 'Image', props: { id: 'i3', src: '', alt: { en: '' } } },
        {
          type: 'Gallery',
          props: {
            id: 'g',
            images: [
              { src: '/files/c.jpg', alt: { en: '' } },
              { src: '/files/d.jpg', alt: { en: 'Room' } },
            ],
          },
        },
        {
          type: 'Columns',
          props: {
            id: 'c',
            left: [{ type: 'Split', props: { id: 's', image: '/files/e.jpg', imageAlt: { en: ' ' } } }],
          },
        },
        { type: 'Hero', props: { id: 'h', image: '/files/hero.jpg', bgImage: '/files/bg.jpg' } },
      ]),
    ])
    expect(codes(r)).toEqual(['/ en image_alt_missing'])
    expect(r.findings[0]!.detail).toBe('3 images have no alt text.')
  })

  it('HTML images: no alt or blank alt, unless decorative; never inside scripts, styles or comments', () => {
    const src = [
      '<img src="a.jpg">',
      '<IMG SRC="b.jpg" ALT="">',
      '<img src="c.jpg" alt="Hot stones">',
      '<img src="d.jpg" alt>',
      '<img src="e.jpg" role="presentation">',
      '<img src="f.jpg" alt="" aria-hidden="true">',
      '<img src="g.jpg" title="x > y">',
      '<!-- <img src="h.jpg"> -->',
      '<script>const t = "<img src=i.jpg>"</script>',
      '<style>/* <img> */</style>',
      '<textarea><img src="j.jpg"></textarea>',
    ].join('')
    expect(htmlImagesWithoutAlt(src)).toBe(4)
    expect(htmlImagesWithoutAlt('<img src="x.jpg"')).toBe(1)
    expect(htmlImagesWithoutAlt('<script><img src=x>')).toBe(0)
  })

  it('HTML designs: the spa’s page texts over the design’s own title / description (src guard), {{spa_name}} filled', () => {
    const source = html('<img src="a.jpg">', '<title>{{spa_name}}</title>')
    const listed = listHtmlDesignTexts(source)
    const titleSrc = listed.find((x) => x.id === 'title')!.src
    const mine = design('', source)
    expect(codes(run([mine], { arabic: true }))).toEqual(['/ en image_alt_missing'])
    // A too long English title, and an Arabic description of its own that is too short.
    const over = design('', source, {
      content: {
        v: 1,
        texts: [
          { id: 'title', src: titleSrc, t: { en: 't'.repeat(70) } },
          {
            id: 'meta-description',
            src: listed.find((x) => x.id === 'meta-description')!.src,
            t: { ar: 'قصير' },
          },
        ],
      },
    })
    expect(codes(run([over], { arabic: true }))).toEqual([
      '/ en title_long',
      '/ ar description_short',
      '/ en image_alt_missing',
    ])
    // A stale page text (another design text at that id) is not shown live: the design's own title counts.
    const stale = design('', source, {
      content: { v: 1, texts: [{ id: 'title', src: 'old', t: { en: 't'.repeat(70) } }] },
    })
    expect(codes(run([stale]))).toEqual(['/ en image_alt_missing'])
  })

  it('HTML designs without a description; framed designs use the page’s own title + description', () => {
    const bare = '<!doctype html><html><head><title>Seaside Spa · Massage</title></head><body></body></html>'
    expect(codes(run([design('', bare)]))).toEqual(['/ en description_missing'])
    // Phone fixes on: the design runs in a frame, so search sees the page's metadata ({name}, no description).
    expect(codes(run([design('', html(''), { phoneFixes: true })]))).toEqual(['/ en description_missing'])
    // A missing design file: only what the page itself says.
    expect(codes(run([{ ...design('', ''), html: null }]))).toEqual(['/ en description_missing'])
  })

  it('a live page sitemap.xml does not list is high', () => {
    const r = run(
      [
        block('', { title: { en: 'Massage in Dubai' }, description: { en: GOOD_DESC } }),
        block('offers', { title: { en: 'Offers' }, description: { en: `${GOOD_DESC} Offers.` } }),
      ],
      { sitemap: [''] },
    )
    expect(codes(r)).toEqual(['/offers en not_in_sitemap'])
    expect(r.counts).toEqual({ high: 1, medium: 0 })
  })

  it('stays linear on big input (many pages, one huge design, unclosed tags)', () => {
    const pages = Array.from({ length: 3000 }, (_, i) =>
      block(`p${i}`, { title: { en: 'Same title' }, description: { en: GOOD_DESC } }, [
        { type: 'Image', props: { id: `i${i}`, src: '/files/a.jpg', alt: { en: '' } } },
      ]),
    )
    const huge = html(`${'<img src="a.jpg">'.repeat(100_000)}${'<div title="'.repeat(20_000)}`)
    const t = performance.now()
    const r = run([...pages, design('big', huge)])
    expect(htmlImagesWithoutAlt(`${'<img '.repeat(200_000)}`)).toBeGreaterThan(0)
    expect(htmlImagesWithoutAlt(`<script>${'<'.repeat(500_000)}`)).toBe(0)
    expect(performance.now() - t).toBeLessThan(3000)
    // Each block page: same title, same description, a picture without alt; the design: same description + pictures.
    expect(r.counts.medium).toBe(3000 * 3 + 2)
    expect(r.findings.length).toBe(300)
    expect(r.findings[0]!.detail).toBe('Same title as /p1, /p2, /p3 and 2996 more.')
  })
})
