import { describe, expect, it } from 'vitest'
import { htmlDesignPictureSrcs, htmlDesignPictures, listHtmlDesignImages } from '../src/html-design'
import { type HtmlDesignShare, htmlDesignHeadTags } from '../src/html-design-head'

describe('htmlDesignHeadTags (M11 / M2)', () => {
  const share: HtmlDesignShare = {
    title: 'Fallback title',
    description: 'Fallback description',
    url: 'https://spa.example.ae/',
    siteName: 'Spa "One" & Co',
    locale: 'en',
    image: { url: 'https://spa.example.ae/files/hero', large: true },
    icon: 'https://spa.example.ae/files/logo',
    languages: {
      en: 'https://spa.example.ae/',
      ar: 'https://spa.example.ae/?lang=ar',
      'x-default': 'https://spa.example.ae/',
    },
  }
  const tags = (s: string) => [...s.matchAll(/<(?:meta|link)\b[^>]*>/g)].map((m) => m[0])

  it('a design without any: every tag, the design’s own title + description, values escaped', () => {
    const html =
      '<!doctype html><html><head><title> Caf&eacute; &amp;\n Spa </title>' +
      '<meta name="description" content="Relax &quot;here&quot;"></head><body><p>x</p></body></html>'
    expect(tags(htmlDesignHeadTags(html, share))).toEqual([
      '<meta property="og:title" content="Café &amp; Spa">',
      '<meta property="og:description" content="Relax &quot;here&quot;">',
      '<meta property="og:url" content="https://spa.example.ae/">',
      '<meta property="og:type" content="website">',
      '<meta property="og:locale" content="en_AE">',
      '<meta property="og:site_name" content="Spa &quot;One&quot; &amp; Co">',
      '<meta property="og:image" content="https://spa.example.ae/files/hero">',
      '<meta name="twitter:card" content="summary_large_image">',
      '<meta name="twitter:title" content="Café &amp; Spa">',
      '<meta name="twitter:description" content="Relax &quot;here&quot;">',
      '<meta name="twitter:image" content="https://spa.example.ae/files/hero">',
      '<link rel="icon" href="https://spa.example.ae/files/logo">',
      '<link rel="apple-touch-icon" href="https://spa.example.ae/files/logo">',
      '<link rel="alternate" hreflang="en" href="https://spa.example.ae/">',
      '<link rel="alternate" hreflang="ar" href="https://spa.example.ae/?lang=ar">',
      '<link rel="alternate" hreflang="x-default" href="https://spa.example.ae/">',
    ])
  })

  it('no title / description of its own: the page’s; Arabic; the logo as a small card; no Arabic site → no hreflang', () => {
    const out = htmlDesignHeadTags('<p>bare</p>', {
      ...share,
      description: undefined,
      locale: 'ar',
      image: { url: 'https://spa.example.ae/files/logo', large: false },
      languages: undefined,
    })
    expect(out).toContain('<meta property="og:title" content="Fallback title">')
    expect(out).toContain('<meta property="og:locale" content="ar_AE">')
    expect(out).toContain('<meta name="twitter:card" content="summary">')
    expect(out).not.toContain('description')
    expect(out).not.toContain('hreflang')
  })

  it('never adds a tag the design has (by property or name, aliases, rel tokens, any hreflang)', () => {
    const html =
      '<html><head><title>T</title>' +
      '<meta property="og:title" content="Own"><meta name="OG:Description" content="Own">' +
      "<meta property='og:image:url' content='https://x/own.jpg'><meta name=twitter:card content=summary>" +
      '<meta name="twitter:image:src" content="https://x/own.jpg">' +
      '<link rel="shortcut icon" href="/own.ico"><link rel="apple-touch-icon-precomposed" href="/own.png">' +
      '<link rel="alternate" hreflang="fr" href="https://x/fr"></head><body></body></html>'
    expect(tags(htmlDesignHeadTags(html, share))).toEqual([
      '<meta property="og:url" content="https://spa.example.ae/">',
      '<meta property="og:type" content="website">',
      '<meta property="og:locale" content="en_AE">',
      '<meta property="og:site_name" content="Spa &quot;One&quot; &amp; Co">',
    ])
  })

  it('the design’s own og:* tags keep the X card: no twitter:* of ours over them, card size from its picture', () => {
    const html =
      '<head><title>Own T</title><meta property="og:title" content="Own OG">' +
      '<meta property="og:description" content="Own OG D"><meta property="og:image" content="https://cdn/x.jpg">' +
      '</head><body></body>'
    const logo = {
      ...share,
      description: 'Page D',
      image: { url: 'https://spa.example.ae/files/logo', large: false },
    }
    const out = htmlDesignHeadTags(html, logo)
    expect(out).toContain('<meta name="twitter:card" content="summary_large_image">')
    expect(out).not.toMatch(/twitter:(?:title|description|image)|og:(?:title|description|image)/)
    expect(out).not.toContain('Own T')
    expect(out).not.toContain('Page D')
    // An SVG og:image is not shown large (nor at all by most apps): the small card.
    expect(htmlDesignHeadTags(html.replace('x.jpg', 'x.svg'), share)).toContain(
      '<meta name="twitter:card" content="summary">',
    )
  })

  it('the design’s own twitter:* values fill the og:* tags it lacks (relative picture made absolute)', () => {
    const html =
      '<head><title>T</title><meta name="twitter:title" content="Tw title">' +
      '<meta name="twitter:description" content="Tw desc"><meta name="twitter:image" content="/files/tw.jpg">' +
      '</head><body></body>'
    expect(
      tags(htmlDesignHeadTags(html, share)).filter((t) => /og:(?:title|desc|image)|twitter/.test(t)),
    ).toEqual([
      '<meta property="og:title" content="Tw title">',
      '<meta property="og:description" content="Tw desc">',
      '<meta property="og:image" content="https://spa.example.ae/files/tw.jpg">',
      '<meta name="twitter:card" content="summary_large_image">',
    ])
  })

  it('the head ends at the real </head> / <body>: "<body" or tags inside scripts, styles and templates don’t count', () => {
    const own =
      '<head><script>var t="<body class=x><title>Script</title>"</script>' +
      '<style>/* <body> */</style><template><meta property="og:title" content="Tpl"></template>' +
      '<meta property="og:image" content="https://cdn/x.jpg"><title>Real</title></head><body></body>'
    const out = htmlDesignHeadTags(own, share)
    expect(out).not.toContain('og:image')
    expect(out).toContain('<meta property="og:title" content="Real">')
    expect(out).not.toMatch(/Script|Tpl/)
  })

  it('no <body> tag: the head ends at the first body element, so an inline SVG <title> is not the page title', () => {
    const html =
      '<!doctype html><html><head><meta charset="utf-8"></head-less>' +
      '<div><svg><title>Instagram</title></svg><meta property="og:image" content="/late.jpg"></div>'
    const out = htmlDesignHeadTags(html, share)
    expect(out).toContain('<meta property="og:title" content="Fallback title">')
    expect(out).toContain('<meta property="og:image" content="https://spa.example.ae/files/hero">')
    expect(out).not.toContain('Instagram')
    // A stray body tag inside a head that has a real </head>: the design's tags after it still count.
    const stray =
      '<head><div></div><meta property="og:image" content="https://cdn/x.jpg"></head><body></body>'
    expect(htmlDesignHeadTags(stray, share)).not.toContain('og:image')
  })

  it('reads only the head: comments and body markup are not the design’s tags', () => {
    const html =
      '<head><!-- <meta property="og:title" content="x"> <link rel="icon" href="/x"> --></head>' +
      '<body><meta property="og:image" content="/body.jpg"><link rel="alternate" hreflang="ar" href="/ar"></body>'
    const out = htmlDesignHeadTags(html, share)
    expect(out).toContain('<meta property="og:title" content="Fallback title">')
    expect(out).toContain('<meta property="og:image" content="https://spa.example.ae/files/hero">')
    expect(out).toContain('<link rel="icon" href="https://spa.example.ae/files/logo">')
    expect(out).toContain('hreflang="ar"')
  })

  it('no logo → no icon links; no picture → no image tags', () => {
    const out = htmlDesignHeadTags('<head></head>', { ...share, icon: null, image: null })
    expect(out).not.toMatch(/rel="(?:icon|apple-touch-icon)"/)
    expect(out).not.toMatch(/og:image|twitter:image/)
    expect(out).toContain('<meta name="twitter:card" content="summary">')
  })
})

describe('htmlDesignPictures + htmlDesignPictureSrcs (link-preview photo)', () => {
  const html =
    '<header><img src="/designs/x/logo.svg"><img src="/files/brand" alt="Spa logo"><img src="/files/i" width="40">' +
    '<img class="nav-icon" src="/files/n"></header><section style="background-image:url(/files/hero.jpg)">' +
    '<img src="data:image/png;base64,AA"><img src="/files/a"></section>' +
    '<style>.band{background:url(/files/bg.svg)}</style>'
  const pictures = htmlDesignPictures(html)

  it('document order, same ids as the image list; logos / icons marked', () => {
    expect(pictures.map((p) => p.id)).toEqual([
      'img-0',
      'img-1',
      'img-2',
      'img-3',
      'bg-0',
      'img-4',
      'img-5',
      'bg-1',
    ])
    expect(new Set(pictures.map((p) => p.id))).toEqual(new Set(listHtmlDesignImages(html).map((i) => i.id)))
    expect(pictures.filter((p) => p.mark).map((p) => p.id)).toEqual(['img-0', 'img-1', 'img-2', 'img-3'])
  })

  it('photos only (no logo, icon, SVG or inline data), the replacement where id + src still match', () => {
    expect(htmlDesignPictureSrcs(pictures)).toEqual(['/files/hero.jpg', '/files/a'])
    expect(
      htmlDesignPictureSrcs(pictures, [
        { id: 'bg-0', src: '/files/hero.jpg', replace: 'https://cdn.example/new.svg' },
        { id: 'img-4', src: 'data:image/png;base64,AA', replace: 'https://cdn.example/new.jpg' },
        { id: 'img-5', src: '/files/other', replace: 'https://cdn.example/stale.jpg' },
        { id: 'bg-1', src: '/files/bg.svg', replace: 'javascript:alert(1)' },
      ]),
    ).toEqual(['https://cdn.example/new.jpg', '/files/a'])
  })
})
