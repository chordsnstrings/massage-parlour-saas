import { describe, expect, it } from 'vitest'
import {
  applyHtmlImageAdjustments,
  fixHtmlDesign,
  HTML_DESIGN_BASE_CSS,
  htmlDesignDocument,
  listHtmlDesignImages,
  withBaseHref,
} from '../src/html-design'

const doc = `<!doctype html><html><head><style>
@font-face{font-family:X;src:url(x.woff2)}
.hero{height:400px;background:url("https://cdn.test/hero.jpg") center/cover no-repeat}
</style></head><body>
<!-- <img src="commented.jpg"> -->
<img src="https://cdn.test/a.jpg" srcset="https://cdn.test/a2.jpg 2x" style="width:1600px">
<div style="background-image:url(&quot;https://cdn.test/b.jpg&quot;);height:200px"></div>
<img class="right" src='https://cdn.test/c.jpg' width="900">
<script>const s = '<img src="script.jpg">'</script>
</body></html>`

describe('listHtmlDesignImages', () => {
  it('lists <img> and CSS background images in order, skipping fonts, comments and scripts', () => {
    expect(listHtmlDesignImages(doc)).toEqual([
      { id: 'img-0', kind: 'img', src: 'https://cdn.test/a.jpg' },
      { id: 'img-1', kind: 'img', src: 'https://cdn.test/c.jpg' },
      { id: 'bg-0', kind: 'bg', src: 'https://cdn.test/hero.jpg' },
      { id: 'bg-1', kind: 'bg', src: 'https://cdn.test/b.jpg' },
    ])
  })
  it('stays fast on malformed CSS url() (no exponential or quadratic backtracking)', () => {
    const t = Date.now()
    expect(listHtmlDesignImages(`<style>.a{background:url(${'&#39;'.repeat(40)}</style>`)).toEqual([])
    expect(listHtmlDesignImages(`<style>.a{background:url(${' '.repeat(100_000)}x</style>`)).toEqual([])
    expect(listHtmlDesignImages('<style>.a{background:url( )}</style>')).toEqual([])
    expect(listHtmlDesignImages(`<style>.a{background:${'url('.repeat(50_000)}</style>`)).toEqual([])
    expect(Date.now() - t).toBeLessThan(1000)
  })
})

describe('fixHtmlDesign', () => {
  it('adds a missing viewport meta and makes fixed-width images fluid', () => {
    const { html, fixes } = fixHtmlDesign(doc)
    expect(fixes.sort()).toEqual(['viewport', 'wide-image'])
    expect(html).toContain('<head><meta name="viewport" content="width=device-width, initial-scale=1">')
    expect(html).toContain('style="width:100%;max-width:1600px"')
  })
  it('leaves a design that already has both alone', () => {
    const ok =
      '<html><head><meta name="viewport" content="width=device-width"></head><img src="a.jpg" style="width:200px"></html>'
    expect(fixHtmlDesign(ok)).toEqual({ html: ok, fixes: [] })
  })
})

describe('htmlDesignDocument', () => {
  it('puts viewport + zero-specificity base CSS first in <head>, before the design styles', () => {
    const out = htmlDesignDocument(doc, {}, false)
    const head = out.indexOf('<head>') + '<head>'.length
    expect(out.slice(head)).toMatch(/^<meta name="viewport"[^>]*><style data-spa-base>/)
    expect(out.indexOf('data-spa-base')).toBeLessThan(out.indexOf('.hero{'))
    expect(HTML_DESIGN_BASE_CSS).toContain(':where(img,picture,video,canvas,svg,iframe){max-width:100%}')
    expect(HTML_DESIGN_BASE_CSS).toContain(':where(html,body){max-width:100%;overflow-x:clip}')
    // Every selector is wrapped in :where() (zero specificity).
    for (const rule of HTML_DESIGN_BASE_CSS.split('}').filter(Boolean)) expect(rule).toMatch(/^:where\(/)
  })
  it('keeps an existing viewport meta', () => {
    const out = htmlDesignDocument(
      '<html><head><meta name="viewport" content="width=1200"></head></html>',
      {},
      true,
    )
    expect(out.match(/name="viewport"/g)).toHaveLength(1)
  })
  it('adds exactly one script (the link handler) and no event-handler attributes', () => {
    const out = htmlDesignDocument(doc, {}, true, [
      { id: 'img-0', src: 'https://cdn.test/a.jpg', x: 10, y: 90, replace: 'https://cdn.test/new.jpg' },
      { id: 'bg-0', src: 'https://cdn.test/hero.jpg', x: 0, y: 0, fit: 'contain' },
    ])
    expect(out.match(/<script\b/gi)!.length).toBe(doc.match(/<script\b/gi)!.length + 1)
    expect(out).not.toMatch(/\son[a-z]+\s*=/i)
  })
  it('fills placeholders HTML-escaped', () => {
    expect(htmlDesignDocument('<p>{{spa_name}}</p>', { spa_name: '<b>' }, true)).toContain('<p>&lt;b&gt;</p>')
  })
})

describe('applyHtmlImageAdjustments', () => {
  it('tags adjusted <img>s, sets focal point / fit, replaces src and drops srcset', () => {
    const out = applyHtmlImageAdjustments(doc, [
      {
        id: 'img-0',
        src: 'https://cdn.test/a.jpg',
        x: 20,
        y: 80,
        replace: '/files/0b0f6c2e-5c5e-4e8f-9a4e-1f2a3b4c5d6e',
      },
      { id: 'img-1', src: 'https://cdn.test/c.jpg', fit: 'contain' },
    ])
    expect(out).toContain(
      '<img data-spa-img="0" src="/files/0b0f6c2e-5c5e-4e8f-9a4e-1f2a3b4c5d6e" style="width:1600px">',
    )
    expect(out).toContain('[data-spa-img="0"]{object-fit:cover!important;object-position:20% 80%!important}')
    expect(out).toContain(
      '[data-spa-img="1"]{object-fit:contain!important;object-position:50% 50%!important}',
    )
    expect(out.indexOf('<style data-spa-images>')).toBeLessThan(out.indexOf('</body>'))
  })
  it('realigns an <img> inside the screen when asked', () => {
    const out = applyHtmlImageAdjustments(doc, [
      { id: 'img-1', src: 'https://cdn.test/c.jpg', align: 'center' },
    ])
    expect(out).toContain('float:none!important;max-width:100%!important;margin:0 auto!important')
  })
  it('adds position/size after background declarations (style blocks and inline styles)', () => {
    const out = applyHtmlImageAdjustments(doc, [
      { id: 'bg-0', src: 'https://cdn.test/hero.jpg', x: 30, y: 10, replace: 'https://cdn.test/h2.jpg' },
      { id: 'bg-1', src: 'https://cdn.test/b.jpg', x: 100, y: 0, fit: 'contain' },
    ])
    expect(out).toContain(
      'background:url(https://cdn.test/h2.jpg) center/cover no-repeat;background-position:30% 10% !important;background-size:cover !important}',
    )
    expect(out).toContain(
      'background-image:url(&quot;https://cdn.test/b.jpg&quot;);background-position:100% 0% !important;background-size:contain !important;background-repeat:no-repeat !important;height:200px',
    )
  })
  it('ignores adjustments for another image, unsafe URLs and bad ids; clamps values', () => {
    const out = applyHtmlImageAdjustments(doc, [
      { id: 'img-0', src: 'https://cdn.test/other.jpg', x: 5 },
      { id: 'img-1', src: 'https://cdn.test/c.jpg', x: 500, y: -3, replace: 'javascript:alert(1)' },
      { id: 'img-1); x', src: 'https://cdn.test/c.jpg' },
    ])
    expect(out).not.toContain('data-spa-img="0"')
    expect(out).toContain("src='https://cdn.test/c.jpg'")
    expect(out).toContain('object-position:100% 0%')
    expect(out).not.toContain('javascript:')
  })
  it('returns the file unchanged without adjustments', () => {
    expect(applyHtmlImageAdjustments(doc, [])).toBe(doc)
  })
})

describe('withBaseHref (F10)', () => {
  it('adds the hosting page as <base> after <head>, escaped; a design with its own base keeps it', () => {
    const out = withBaseHref(
      '<!doctype html><html><head><title>x</title></head><body></body></html>',
      'https://a.test/?q="1"&b=<2>',
    )
    expect(out).toBe(
      '<!doctype html><html><head><base href="https://a.test/?q=&quot;1&quot;&amp;b=&lt;2&gt;"><title>x</title></head><body></body></html>',
    )
    const own = '<html><head><base href="https://cdn.test/"></head></html>'
    expect(withBaseHref(own, 'https://a.test/')).toBe(own)
    expect(withBaseHref('<p>hi</p>', 'https://a.test/')).toBe('<base href="https://a.test/"><p>hi</p>')
    // A tag with no closing `>` anywhere: linear (no `[^>]*>` rescan from every start), falls through to the start.
    const open = '<head'.repeat(50_000)
    const t = Date.now()
    expect(withBaseHref(open, '/x/')).toBe(`<base href="/x/">${open}`)
    expect(Date.now() - t).toBeLessThan(1000)
  })
})
