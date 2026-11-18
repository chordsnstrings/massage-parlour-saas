import { describe, expect, it } from 'vitest'
import {
  decodeEntities,
  htmlDesignAssetRefs,
  patchHtml,
  remapHtmlImageAdjustments,
  rewriteHtmlDesignAssets,
} from '../src/html-design-assets'

const urls = (html: string) => htmlDesignAssetRefs(html).map((r) => r.url)
const D = 'data:image/png;base64,AAAA'

describe('htmlDesignAssetRefs (R24)', () => {
  it('finds quoted, unquoted and entity-encoded attribute URLs', () => {
    const html = `<img src="${D}"><img src='b.png'><img src=c.png alt=x><img src="d.png?a=1&amp;b=2">`
    expect(urls(html)).toEqual([D, 'b.png', 'c.png', 'd.png?a=1&b=2'])
    const r = htmlDesignAssetRefs(html)[0]!
    expect(html.slice(r.start, r.end)).toBe(D)
    expect(r).toMatchObject({ where: 'attr', tag: 'img', attr: 'src' })
  })
  it('splits srcset per candidate (a data: URI comma is part of the URL), incl. trailing commas', () => {
    const html = `<img srcset="${D} 1x, data:image/png;base64,BBBB 2x,c.png"><picture><source srcset="x.webp 480w, y.webp 2x" type="image/webp"></picture>`
    expect(urls(html)).toEqual([D, 'data:image/png;base64,BBBB', 'c.png', 'x.webp', 'y.webp'])
  })
  it('covers poster, video/source src, input[type=image], link icon/preload and SVG image hrefs', () => {
    const html = `<video src="v.mp4" poster="p.jpg"><source src="v.webm"></video><input type="image" src="i.png"><input type="text" src="no.png">
<link rel="shortcut icon" href="f.ico"><link rel="preload" as="font" href="font.woff2"><link rel="stylesheet" href="no.css">
<svg><image href="s1.png"/><feImage xlink:href="s2.png"/></svg>`
    expect(urls(html)).toEqual([
      'v.mp4',
      'p.jpg',
      'v.webm',
      'i.png',
      'f.ico',
      'font.woff2',
      's1.png',
      's2.png',
    ])
  })
  it('reads CSS url() in <style> and style attributes, @font-face src lists with format(), image-set', () => {
    const html = `<style>
@font-face{font-family:F;src:url("data:font/woff2;base64,d09GMg") format("woff2"),url(f.woff) format('woff')}
.a{background:url( 'a.jpg' ) no-repeat,image-set("b.jpg" 1x, url(c.jpg) 2x)}
.b{content:"url(not-a-url.png)"} /* url(commented.png) */
.c{background:-webkit-image-set('d.png' 1x)}
</style><div style="background-image:url(&quot;e.jpg&quot;);mask:url(&#39;m.svg&#39;)"></div><p style='background:url("q.jpg")'></p>`
    expect(urls(html)).toEqual([
      'data:font/woff2;base64,d09GMg',
      'f.woff',
      'a.jpg',
      'b.jpg',
      'c.jpg',
      'd.png',
      'e.jpg',
      'm.svg',
      'q.jpg',
    ])
    const e = htmlDesignAssetRefs(html).find((r) => r.url === 'e.jpg')!
    expect(html.slice(e.start, e.end)).toBe('e.jpg')
    expect(e).toMatchObject({ where: 'css', tag: 'div', attr: 'style' })
  })
  it('skips scripts, comments and raw-text bodies', () => {
    const html = `<!-- <img src="c.png"> --><script>const x='<img src="s.png">'; const y = "url(s.png)"</script><textarea><img src="t.png"></textarea><noscript><img src="n.png"></noscript><img src="ok.png">`
    expect(urls(html)).toEqual(['ok.png'])
  })
  it('leaves malformed CSS alone: stray backslash, unterminated url(, missing quote; line continuations are fine', () => {
    expect(urls('<style>.a{background:url(a\\(b.png)}</style>')).toEqual([])
    expect(urls('<style>.a{background:url("a\\62.png")}</style>')).toEqual([])
    expect(urls('<style>.a{background:url(data:image/png;base64,AAAA</style>')).toEqual([])
    expect(urls('<style>.a{background:url("a.png)}\n.b{background:url(b.png)}</style>')).toEqual(['b.png'])
    expect(urls('<style>.a{background:url("data:image/png;base64,AA\\\nAA")}</style>')).toEqual([
      'data:image/png;base64,AAAA',
    ])
  })
  it('stays linear on huge or broken input', () => {
    const t = Date.now()
    htmlDesignAssetRefs(`<style>${'url('.repeat(100_000)}</style>`)
    htmlDesignAssetRefs(`<img src="${'a'.repeat(3_000_000)}">`)
    htmlDesignAssetRefs(`<div style="${'&quot;'.repeat(50_000)}"></div>`)
    expect(Date.now() - t).toBeLessThan(2000)
  })
})

describe('rewriteHtmlDesignAssets', () => {
  it('replaces only the URL ranges and keeps everything else byte for byte (no attribute added)', () => {
    const html = `<img src="${D}" alt="a"><img src="${D}" srcset="keep.png 2x"><div style="background:url(&quot;${D}&quot;)"></div><img crossorigin="use-credentials" src="${D}">`
    const out = rewriteHtmlDesignAssets(html, htmlDesignAssetRefs(html), (r) =>
      r.url.startsWith('data:') ? 'https://app.test/files/x/1.png' : null,
    )
    expect(out).toBe(
      '<img src="https://app.test/files/x/1.png" alt="a"><img src="https://app.test/files/x/1.png" srcset="keep.png 2x"><div style="background:url(&quot;https://app.test/files/x/1.png&quot;)"></div><img crossorigin="use-credentials" src="https://app.test/files/x/1.png">',
    )
  })
})

describe('entities', () => {
  it('decodes numeric and common named references, keeps unknown ones', () => {
    expect(decodeEntities('&#x2F;&#47;&amp;&quot;&bogus;')).toBe('//&"&bogus;')
  })
})

describe('remapHtmlImageAdjustments', () => {
  it('moves src keys to the new URLs for the same image ids', () => {
    const before = `<img src="${D}"><div style="background:url(${D})"></div><img src="b.png">`
    const after =
      '<img src="https://f/1.png"><div style="background:url(https://f/1.png)"></div><img src="b.png">'
    expect(
      remapHtmlImageAdjustments(before, after, [
        { id: 'img-0', src: D, x: 10 },
        { id: 'bg-0', src: D, fit: 'contain' },
        { id: 'img-1', src: 'other.png' },
      ]),
    ).toEqual([
      { id: 'img-0', src: 'https://f/1.png', x: 10 },
      { id: 'bg-0', src: 'https://f/1.png', fit: 'contain' },
      { id: 'img-1', src: 'other.png' },
    ])
  })
})

describe('patchHtml', () => {
  it('applies edits in order, each against the result so far', () => {
    expect(
      patchHtml('<h1>Hi</h1><p>a</p>', [
        { find: '<h1>Hi</h1>', replace: '<h1>Hello</h1>' },
        { find: 'Hello', replace: 'Welcome' },
      ]),
    ).toEqual({ ok: true, html: '<h1>Welcome</h1><p>a</p>', at: [0, 4] })
  })
  it('needs exactly one match per edit', () => {
    expect(patchHtml('<p>a</p><p>a</p>', [{ find: '<p>a</p>', replace: 'x' }])).toEqual({
      ok: false,
      error: 'Edit 1: `find` matches 2 times — include more surrounding text so it is unique',
    })
    expect(
      patchHtml('<p>a</p>', [
        { find: 'a', replace: 'b' },
        { find: 'zzz', replace: 'y' },
      ]),
    ).toEqual({
      ok: false,
      error: 'Edit 2: `find` matches 0 times — copy it exactly from get_html_design',
    })
    expect(patchHtml('aaa', [{ find: 'aa', replace: 'b' }])).toMatchObject({ ok: false })
  })
})
