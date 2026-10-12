import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { crmScriptJson, htmlCrmContractOf, spliceCrmData } from '../src/html-crm'
import {
  applyHtmlImageAdjustments,
  applyHtmlTextOverrides,
  attributesOf,
  decodeHtmlBytes,
  fixHtmlDesign,
  HTML_DESIGN_BASE_CSS,
  HTML_DESIGN_COMPAT_SHIM,
  HTML_IMAGE_URL,
  htmlDesignDocOf,
  htmlDesignDocument,
  htmlDesignEmbedHosts,
  htmlDesignEmbedWarning,
  htmlDesignPhoneFixes,
  htmlImageUrl,
  listHtmlDesignImages,
  listHtmlDesignTexts,
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

const shim = `<script>${HTML_DESIGN_COMPAT_SHIM}</script>`
/** The document minus the shim and the frame link script: what the design itself looks like after rendering. */
const designOf = (out: string) =>
  out.replace(shim, '').replace(/<script>\(\(\)=>\{const inert=[\s\S]*?<\/script>/, '')

describe('htmlDesignDocument: exact by default (R24 owner rule)', () => {
  it('adds only the compat shim + link script: no base sheet, no viewport, widths untouched', () => {
    const out = htmlDesignDocument(doc, {}, false)
    expect(out).not.toContain('data-spa-base')
    expect(out).not.toContain('name="viewport"')
    expect(out).toContain('style="width:1600px"')
    expect(designOf(out)).toBe(doc)
    const head = out.indexOf('<head>') + '<head>'.length
    expect(out.slice(head).startsWith(shim)).toBe(true)
  })
  it('top mode (the live page itself): only the shim', () => {
    const out = htmlDesignDocument(doc, {}, false, [], {}, { top: true })
    expect(out.replace(shim, '')).toBe(doc)
  })
  it('puts the shim before a script that comes before <head>', () => {
    const early = '<!doctype html><script>localStorage.x=1</script><html><head></head><body></body></html>'
    const out = htmlDesignDocument(early, {}, false)
    expect(out.indexOf(shim)).toBeLessThan(out.indexOf('<script>localStorage'))
  })
  it('adds the map style only when an {{address}} link was spliced in', () => {
    const links = { address: { href: 'https://maps.app.goo.gl/x', label: 'Maps' } }
    expect(htmlDesignDocument('<p>{{address}}</p>', { address: 'A' }, false, [], links)).toContain(
      'data-spa-map>',
    )
    expect(htmlDesignDocument('<p>{{address}}</p>', { address: 'A' }, false, [], links)).toContain(
      '<style data-spa-map-style>',
    )
    expect(
      htmlDesignDocument('<p title="{{address}}">x</p>', { address: 'A' }, false, [], links),
    ).not.toContain('<style data-spa-map-style>')
  })
  it('exact frames open links in the top window and fix #anchors; legacy keeps new tabs for outside sites', () => {
    expect(htmlDesignDocument(doc, {}, false)).toContain('exact=true')
    expect(htmlDesignDocument(doc, {}, false, [], {}, { phoneFixes: true })).toContain('exact=false')
    expect(htmlDesignDocument(doc, {}, false)).toContain("location.assign(location.href.split('#')[0]+h)")
  })
  it('the flag: absent (stored before R24) = on, explicit false = exact', () => {
    expect(htmlDesignPhoneFixes({})).toBe(true)
    expect(htmlDesignPhoneFixes({ phoneFixes: true })).toBe(true)
    expect(htmlDesignPhoneFixes({ phoneFixes: false })).toBe(false)
  })
})

describe('compat shim (R24)', () => {
  const run = (throwing: boolean) => {
    const denied = () => {
      throw new Error('SecurityError: sandboxed')
    }
    const document: Record<string, unknown> = {}
    const window: Record<string, unknown> = {}
    if (throwing) {
      for (const n of ['localStorage', 'sessionStorage'])
        Object.defineProperty(window, n, { get: denied, configurable: true })
      Object.defineProperty(document, 'cookie', { get: denied, set: denied, configurable: true })
    } else {
      window.localStorage = { length: 0, real: true }
      window.sessionStorage = { length: 0, real: true }
      Object.defineProperty(document, 'cookie', { get: () => 'real=1', set: () => {}, configurable: true })
    }
    runInNewContext(HTML_DESIGN_COMPAT_SHIM, { window, document, Proxy, Map, Object, String, Number, Date })
    return { window, document }
  }
  it('gives in-memory storage and cookies only where access throws', () => {
    const { window, document } = run(true)
    const ls = window.localStorage as Storage & Record<string, string>
    ls.setItem('a', '1')
    ls.b = '2'
    expect(ls.getItem('a')).toBe('1')
    expect(ls.length).toBe(2)
    expect(Object.keys(ls)).toEqual(['a', 'b'])
    expect('a' in ls).toBe(true)
    expect(ls.key(1)).toBe('b')
    ls.removeItem('a')
    expect(ls.getItem('a')).toBeNull()
    ls.clear()
    expect(ls.length).toBe(0)
    expect((window.sessionStorage as Storage).getItem('x')).toBeNull()
    document.cookie = 'seen=yes; path=/; max-age=3600'
    document.cookie = 'n=2'
    expect(document.cookie).toBe('seen=yes; n=2')
    document.cookie = 'seen=; max-age=0'
    expect(document.cookie).toBe('n=2')
  })
  it('touches nothing when storage and cookies work', () => {
    const { window, document } = run(false)
    expect((window.localStorage as { real?: boolean }).real).toBe(true)
    expect(document.cookie).toBe('real=1')
  })
})

describe('htmlDesignDocument: phone fixes (legacy designs, explicit opt-in)', () => {
  it('puts viewport + zero-specificity base CSS first in <head>, before the design styles', () => {
    const out = htmlDesignDocument(doc, {}, false, [], {}, { phoneFixes: true })
    const head = out.indexOf('<head>') + '<head>'.length + shim.length
    expect(out.slice(head)).toMatch(/^<meta name="viewport"[^>]*><style data-spa-base>/)
    expect(out).toContain('style="width:100%;max-width:1600px"')
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
      [],
      {},
      { phoneFixes: true },
    )
    expect(out.match(/name="viewport"/g)).toHaveLength(1)
  })
  it('adds exactly two scripts (shim + link handler) and no event-handler attributes', () => {
    const out = htmlDesignDocument(
      doc,
      {},
      true,
      [
        { id: 'img-0', src: 'https://cdn.test/a.jpg', x: 10, y: 90, replace: 'https://cdn.test/new.jpg' },
        { id: 'bg-0', src: 'https://cdn.test/hero.jpg', x: 0, y: 0, fit: 'contain' },
      ],
      {},
      { phoneFixes: true },
    )
    expect(out.match(/<script\b/gi)!.length).toBe(doc.match(/<script\b/gi)!.length + 2)
    expect(out).not.toMatch(/\son[a-z]+\s*=/i)
  })
  it('fills placeholders HTML-escaped', () => {
    expect(htmlDesignDocument('<p>{{spa_name}}</p>', { spa_name: '<b>' }, true)).toContain('<p>&lt;b&gt;</p>')
  })
  it('fills placeholders by context: JS / JSON as string text, CSS hex escapes, never in comments or templates', () => {
    const name = `Mary's "Rose & Oud" </script>`
    const html =
      '<p>{{ spa_name }}</p><a href="{{book_url}}" onclick="alert(\'{{spa_name}}\')">x</a>' +
      '<script>el.textContent="{{spa_name}}"</script><script type="module">t=`{{spa_name}}`</script>' +
      '<script type="application/ld+json">{"name":"{{spa_name}}"}</script>' +
      '<script type="text/x-template"><b>{{ phone }}</b></script><!-- {{spa_name}} -->' +
      '<style>.x::after{content:"{{spa_name}}"}</style>'
    const out = htmlDesignDocument(html, { spa_name: name, book_url: '/book?a=1&b=2', phone: '+971' }, false)
    expect(out).toContain('<p>Mary&#39;s &quot;Rose &amp; Oud&quot; &lt;/script&gt;</p>')
    expect(out).toContain('href="/book?a=1&amp;b=2"')
    // Each JS body evaluates to the exact name; JSON stays valid JSON.
    const js = /el\.textContent=("[^<]*")<\/script>/.exec(out)![1]!
    expect(runInNewContext(js)).toBe(name)
    expect(runInNewContext(/t=(`[^`]*`)/.exec(out)![1]!)).toBe(name)
    expect(JSON.parse(/ld\+json">([^<]*)<\/script>/.exec(out)![1]!).name).toBe(name)
    // The handler attribute is JS inside HTML: decoding the entities gives a valid JS string again.
    const attr = /onclick="alert\('([^"]*)'\)"/.exec(out)![1]!
    expect(runInNewContext(`'${attr.replace(/&#92;/g, '\\').replace(/&amp;/g, '&')}'`)).toBe(name)
    expect(out).toContain('<script type="text/x-template"><b>{{ phone }}</b></script><!-- {{spa_name}} -->')
    expect(out).toContain('content:"Mary\\27 s \\22 Rose \\26  Oud\\22  \\3c /script\\3e "')
    // + the compat shim and the frame link script only
    expect(out.match(/<\/script/gi)!.length).toBe(html.match(/<\/script/gi)!.length + 2)
  })
})

describe('placeholders cannot break out of their context (R24 review)', () => {
  /** What the HTML parser hands on as an attribute value. */
  const attrDecoded = (s: string) =>
    s
      .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
  const fill = (html: string, spa_name: string, address = '') =>
    htmlDesignDocument(html, { spa_name, address }, false).slice(-html.length - 400)
  const trap = () => {
    throw new Error('injected code ran')
  }

  it('an unquoted attribute value takes no space, = or quote (no new attribute)', () => {
    const out = fill('<img alt={{spa_name}}>', 'x onmouseover=alert(1) "q\'`<>')
    const tag = out.slice(out.lastIndexOf('<img'))
    expect(attributesOf(tag, 4).map((a) => a.name)).toEqual(['alt'])
    expect(tag).toBe('<img alt=x&#32;onmouseover&#61;alert(1)&#32;&quot;q&#39;&#96;&lt;&gt;>')
    // Outside any value (a name position) too.
    expect(fill('<div {{spa_name}}>', 'x onclick=go()')).toContain('<div x&#32;onclick&#61;go()>')
  })
  it('a javascript: URL gets JS-string text, then attribute escaping (percent signs too)', () => {
    for (const name of ["');alert(1);//", '%27);alert(1);//', 'a\\b"c'])
      for (const html of [
        `<a href="javascript:f('{{spa_name}}')">x</a>`,
        `<form action="JavaScript:f(&quot;{{spa_name}}&quot;)"></form>`,
        `<a href=javascript:f(\`{{spa_name}}\`)>x</a>`,
        `<a href="javascript:f({{spa_name}})">x</a>`,
      ]) {
        const out = fill(html, name)
        const tag = out.slice(out.lastIndexOf('</script>') + 9)
        const value = /(?:href|action)=("[^"]*"|[^\s>]*)/.exec(tag)![1]!.replace(/^"|"$/g, '')
        const code = decodeURIComponent(attrDecoded(value).replace(/^javascript:/i, ''))
        let got: unknown
        runInNewContext(code, { f: (v: unknown) => (got = v), alert: trap })
        expect(got).toBe(name)
      }
    // Other URLs: the plain attribute value as before.
    expect(fill('<a href="tel:{{spa_name}}">x</a>', "1 '2'")).toContain('href="tel:1 &#39;2&#39;"')
  })
  it('a script outside a string literal gets a quoted string literal, never raw text', () => {
    const address = '1;alert(1)//"\'`</script>\n*/'
    const scripts = [
      'var p = {{address}};',
      'var r = /"/; var p = {{address}};',
      'var p = 4 / 2 && {{address}};',
      '/* {{address}} */ var p = 1; // {{address}}',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: a script body, not a template
      'var t = `${ {{address}} }`; var p = t',
    ]
    for (const js of scripts) {
      const out = fill(`<script>${js}</script>`, '', address)
      const body = out.slice(out.lastIndexOf('<script>') + 8, out.lastIndexOf('</script>'))
      const p = runInNewContext(`${body}\n;p`, { alert: trap })
      expect(js.startsWith('/*') ? p : String(p)).toBe(js.startsWith('/*') ? 1 : address)
    }
    const json = fill('<script type="application/ld+json">{"name": {{spa_name}}}</script>', address)
    expect(JSON.parse(json.slice(json.lastIndexOf('json">') + 6, json.lastIndexOf('</script>'))).name).toBe(
      address,
    )
    // Handler attributes too; `$` + `{` never opens a template substitution.
    const handler = fill('<b onclick="f({{spa_name}})">b</b>', address)
    let got: unknown
    runInNewContext(attrDecoded(/onclick="([^"]*)"/.exec(handler)![1]!), {
      f: (v: unknown) => (got = v),
      alert: trap,
    })
    expect(got).toBe(address)
    const tpl = fill('<script>t=`$${{spa_name}}`</script>', '{alert(1)}')
    expect(runInNewContext(/t=(`[^`]*`)/.exec(tpl)![1]!, { alert: trap })).toBe('$${alert(1)}')
  })
  it('CSS outside a string escapes every non-alphanumeric character (no declaration or rule injection)', () => {
    const name = 'red;background:url(https://evil.test/x)}body{display:none'
    for (const html of [
      '<style>.a{color:{{spa_name}}}</style>',
      '<style>/* {{spa_name}} */ .a{color:red}</style>',
      '<style>.a{background:url({{spa_name}})}</style>',
      '<p style="color:{{spa_name}}">x</p>',
      '<p style=color:{{spa_name}}>x</p>',
    ]) {
      const out = fill(html, `${name}*/`)
      const css = attrDecoded(out.slice(out.lastIndexOf(html.slice(0, 3))))
      expect(css).not.toMatch(/;background|\}body/)
      expect(css.split('*/').length).toBe(html.split('*/').length)
      expect(css).toContain('red\\3b background\\3a url\\28 https\\3a \\2f \\2f evil\\2e test')
    }
    // Inside a CSS string: unchanged (hex escapes of quotes and markup only).
    expect(fill('<style>.a::after{content:"{{spa_name}}"}</style>', "a;b'")).toContain('content:"a;b\\27 "')
    expect(fill(`<p style="font-family:'{{spa_name}}'">x</p>`, "a;b'")).toContain("font-family:'a;b&#92;27 '")
  })
  it('text right after a < never starts a tag; safe contexts stay as they were', () => {
    expect(fill('<p><{{spa_name}}</p>', 'img src=x onerror=alert(1)')).toContain(
      '<p><&#105;mg src=x onerror=alert(1)</p>',
    )
    expect(fill('<p title="{{spa_name}}">{{spa_name}}</p>', 'a b=c')).toContain('<p title="a b=c">a b=c</p>')
  })
})

describe('design files and embeds (R24 review)', () => {
  it('reads a stored-file reference, else null', () => {
    const doc = { file: '0b6f8a52-3c1d-4e2f-9a7b-5c4d3e2f1a0b', sha256: 'a'.repeat(64), bytes: 3, chars: 3 }
    expect(htmlDesignDocOf({ doc })).toEqual(doc)
    expect(htmlDesignDocOf({ doc: { ...doc, sha256: 'x' } })).toBeNull()
    expect(htmlDesignDocOf({ html: '<p>' })).toBeNull()
    // A malformed file id is no reference (renders as an empty design; never reaches a uuid query).
    for (const file of ['f', '', "x' or 1=1", `${doc.file}x`])
      expect(htmlDesignDocOf({ doc: { ...doc, file } })).toBeNull()
  })
  it('decodes an .html file the way a browser opening it does', () => {
    const latin = Uint8Array.from([
      ...Buffer.from('<meta charset="windows-1252"><p>Caf'),
      0xe9,
      0x20,
      0x93,
      ...Buffer.from('Relax'),
      0x94,
    ])
    expect(decodeHtmlBytes(latin)).toEqual({
      html: '<meta charset="windows-1252"><p>Café “Relax”',
      encoding: 'windows-1252',
    })
    const iso = Buffer.from(
      '<meta http-equiv="Content-Type" content="text/html; charset=ISO-8859-1"><p>\xe9',
      'latin1',
    )
    expect(decodeHtmlBytes(iso).html.endsWith('é')).toBe(true)
    // Case, spaces and quotes as browsers accept them; a commented-out or look-alike tag declares nothing.
    const loud = Buffer.from("<META  CHARSET = ' Windows-1252 '><p>\xe9", 'latin1')
    expect(decodeHtmlBytes(loud).encoding).toBe('windows-1252')
    const hidden = Buffer.from('<!-- <meta charset="windows-1252"> --><metadata charset="windows-1252"><p>é')
    expect(decodeHtmlBytes(hidden)).toEqual({ html: hidden.toString('utf8'), encoding: 'utf-8' })
    expect(decodeHtmlBytes(Buffer.from(`<meta${' '.repeat(900)}x>`)).encoding).toBe('utf-8')
    expect(decodeHtmlBytes(Buffer.from('<p>مرحبا</p>')).html).toBe('<p>مرحبا</p>')
    expect(decodeHtmlBytes(Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from('<p>é')]))).toEqual({
      html: '<p>é',
      encoding: 'utf-8',
    })
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('<p>Ω</p>', 'utf16le')])
    expect(decodeHtmlBytes(utf16).html).toBe('<p>Ω</p>')
    // No declaration, not valid UTF-8 → windows-1252 (the browser fallback).
    expect(decodeHtmlBytes(Buffer.from([0x3c, 0x70, 0x3e, 0xe9])).html).toBe('<p>é')
    // A meta inside a comment doesn't count.
    expect(decodeHtmlBytes(Buffer.from('<!-- <meta charset="windows-1252"> --><p>é')).encoding).toBe('utf-8')
  })
  it('lists embedded frames, objects and widget scripts (not data:/srcdoc, not inside scripts or comments)', () => {
    const html =
      '<iframe src="https://www.youtube-nocookie.com/embed/x"></iframe><iframe srcdoc="<p>hi</p>"></iframe>' +
      '<iframe src="data:text/html,hi"></iframe><embed src="/menu.pdf"><object data="https://cdn.test/a.svg"></object>' +
      '<script src="https://assets.calendly.com/assets/external/widget.js"></script><script src="https://cdn.test/app.js"></script>' +
      '<!-- <iframe src="https://hidden.test/"></iframe> --><script>"<iframe src=https://js.test/>"</script>'
    expect(htmlDesignEmbedHosts(html)).toEqual([
      'www.youtube-nocookie.com',
      'this site',
      'cdn.test',
      'assets.calendly.com',
    ])
    expect(htmlDesignEmbedWarning([])).toBeNull()
    expect(htmlDesignEmbedWarning(['www.youtube.com'])).toMatch(/www\.youtube\.com.*sandbox/)
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

describe('applyHtmlImageAdjustments: replace-only (R28 P4)', () => {
  const R = '/files/0b0f6c2e-5c5e-4e8f-9a4e-1f2a3b4c5d6e'
  it('replace-only img: only the src swap (+ srcset/sizes dropped), no data-spa-img, no <style data-spa-images>', () => {
    const out = applyHtmlImageAdjustments(doc, [{ id: 'img-0', src: 'https://cdn.test/a.jpg', replace: R }])
    expect(out).toBe(
      doc.replace(
        '<img src="https://cdn.test/a.jpg" srcset="https://cdn.test/a2.jpg 2x" style="width:1600px">',
        `<img src="${R}" style="width:1600px">`,
      ),
    )
  })
  it('replace-only bg: only the url() swap', () => {
    const out = applyHtmlImageAdjustments(doc, [
      { id: 'bg-0', src: 'https://cdn.test/hero.jpg', replace: 'https://cdn.test/h2.jpg' },
    ])
    expect(out).toBe(doc.replace('url("https://cdn.test/hero.jpg")', 'url(https://cdn.test/h2.jpg)'))
  })
  it('{id, src} alone → the same string', () => {
    expect(
      applyHtmlImageAdjustments(doc, [
        { id: 'img-0', src: 'https://cdn.test/a.jpg' },
        { id: 'bg-1', src: 'https://cdn.test/b.jpg' },
      ]),
    ).toBe(doc)
  })
  it('a replaced img inside <picture> sets each <source srcset> to the replacement', () => {
    const pic =
      '<body><picture><source srcset="https://cdn.test/p.avif" type="image/avif">' +
      '<source media="(min-width:600px)" srcset=\'https://cdn.test/p-wide.webp 2x\'><source type="image/png">' +
      '<img src="https://cdn.test/p.jpg" alt="p"></picture><picture><source srcset="https://cdn.test/q.webp"></picture>' +
      '<script>const t = \'<picture><source srcset="s.webp">\'</script><img src="https://cdn.test/q.jpg"></body>'
    const out = applyHtmlImageAdjustments(pic, [
      { id: 'img-0', src: 'https://cdn.test/p.jpg', replace: R },
      { id: 'img-1', src: 'https://cdn.test/q.jpg', replace: 'https://cdn.test/n.jpg' },
    ])
    expect(out).toBe(
      pic
        .replace('srcset="https://cdn.test/p.avif"', `srcset="${R}"`)
        .replace("srcset='https://cdn.test/p-wide.webp 2x'", `srcset="${R}"`)
        .replace('src="https://cdn.test/p.jpg"', `src="${R}"`)
        .replace('src="https://cdn.test/q.jpg"', 'src="https://cdn.test/n.jpg"'),
    )
  })
  it('of two adjustments with one id, the one whose src still matches applies', () => {
    const out = applyHtmlImageAdjustments(doc, [
      { id: 'img-0', src: 'https://cdn.test/a.jpg', x: 10 },
      { id: 'img-0', src: 'https://cdn.test/stale.jpg', replace: R },
    ])
    expect(out).toContain('[data-spa-img="0"]{object-fit:cover!important;object-position:10% 50%!important}')
    expect(out).not.toContain(R)
  })
  it('a URL with $& / $1 / $$ is written as text (replacer functions only), quotes / backticks refused; & is escaped in src / srcset and a pasted &amp; reads as &', () => {
    const pic =
      '<body><picture><source srcset="https://cdn.test/p.webp"><img class="a" src="https://cdn.test/p.jpg" alt="x" data-k="v"></picture></body>'
    const put = (url: string) =>
      applyHtmlImageAdjustments(pic, [{ id: 'img-0', src: 'https://cdn.test/p.jpg', replace: url }])
    const swapped = (attr: string) =>
      `<body><picture><source srcset="${attr}"><img class="a" src="${attr}" alt="x" data-k="v"></picture></body>`
    for (const url of ['https://cdn.test/$1" onerror="x.jpg', 'https://x.test/$`']) expect(put(url)).toBe(pic)
    expect(put('https://cdn.test/$&$1$$.jpg')).toBe(swapped('https://cdn.test/$&amp;$1$$.jpg'))
    expect(put('/files/$$x')).toBe(swapped('/files/$$x'))
    const escaped = swapped('https://cdn.test/n.jpg?w=1&amp;h=2')
    expect(put('https://cdn.test/n.jpg?w=1&h=2')).toBe(escaped)
    expect(put('https://cdn.test/n.jpg?w=1&amp;h=2')).toBe(escaped) // saved from HTML source: not double-escaped
    expect(put('https://cdn.test/n.jpg?w=1&AMP;h=2')).toBe(escaped)
  })
  it('bg pictures: a character reference (&#41; / &rpar;) is refused, so no CSS is added; & escaped in a style attribute, kept in a <style> body', () => {
    const page =
      '<html><head><style>.h{background:url(https://cdn.test/s.jpg)}</style></head><body>' +
      '<div style="background-image:url(https://cdn.test/a.jpg);color:red"></div></body></html>'
    for (const url of [
      'https://cdn.test/b.jpg&#41;;position:fixed',
      'https://cdn.test/b.jpg&rpar;',
      'https://x.test/&#x29;',
      'https://cdn.test/b.jpg&amp;#41;', // a reference once &amp; reads as &
      'https://cdn.test/b.jpg&amp;rpar;',
      'https://cdn.test/b.jpg&amp;amp;',
      'https://cdn.test/b.jpg&ampx;',
    ])
      expect(
        applyHtmlImageAdjustments(page, [
          { id: 'bg-0', src: 'https://cdn.test/s.jpg', replace: url },
          { id: 'bg-1', src: 'https://cdn.test/a.jpg', replace: url },
        ]),
      ).toBe(page)
    const amp = 'https://cdn.test/b.jpg?x=1&y=2'
    expect(
      applyHtmlImageAdjustments(page, [
        { id: 'bg-0', src: 'https://cdn.test/s.jpg', replace: amp },
        { id: 'bg-1', src: 'https://cdn.test/a.jpg', replace: amp },
      ]),
    ).toBe(
      page
        .replace('url(https://cdn.test/s.jpg)', `url(${amp})`)
        .replace('url(https://cdn.test/a.jpg)', 'url(https://cdn.test/b.jpg?x=1&amp;y=2)'),
    )
    // Pasted with &amp; (copied from HTML source): read as &, so the same output.
    expect(
      applyHtmlImageAdjustments(page, [
        { id: 'bg-0', src: 'https://cdn.test/s.jpg', replace: 'https://cdn.test/b.jpg?x=1&amp;y=2' },
        { id: 'bg-1', src: 'https://cdn.test/a.jpg', replace: 'https://cdn.test/b.jpg?x=1&amp;y=2' },
      ]),
    ).toBe(
      page
        .replace('url(https://cdn.test/s.jpg)', `url(${amp})`)
        .replace('url(https://cdn.test/a.jpg)', 'url(https://cdn.test/b.jpg?x=1&amp;y=2)'),
    )
    expect(HTML_IMAGE_URL.test(amp)).toBe(true)
    expect(HTML_IMAGE_URL.test('https://x.test/a&amp;b.jpg')).toBe(true)
    expect(HTML_IMAGE_URL.test('https://x.test/$1.jpg')).toBe(true)
    expect(htmlImageUrl('https://x.test/a&amp;b&amp;c.jpg')).toBe('https://x.test/a&b&c.jpg')
    expect(htmlImageUrl('https://x.test/a&amp;#41;.jpg')).toBeNull()
    expect(htmlImageUrl(undefined)).toBeNull()
  })
})

/** Every page text of a design (test fixture): text nodes, attributes, title, meta, groups, raw-text bodies. */
const textsDoc = `<!doctype html><html><head>
<meta charset="utf-8">
<title> Rituals &amp; Rest </title>
<meta name="description" content="Calm massage in Dubai">
<style>.x::after{content:"Not a text"}</style>
<script>const s = '<p>script text</p>'</script>
</head><body>
<!-- <p>commented</p> -->
<header><nav aria-label="Main menu"><a href="#a">Home</a> <a href="#b" title='Our rituals'>Rituals</a></nav></header>
<section id="our-story"><h2>Our &nbsp;story</h2><p>
  Since 2010 &mdash; calm hands.
</p><img src="https://cdn.test/a.jpg" alt=Lounge alt="dup"><p>a &lt; b</p><p>5 > 3</p><p>&nbsp;</p></section>
<section><h3>Treatments</h3><form><input placeholder="Your name"><select><option>Swedish</option></select>
<textarea>Not listed</textarea><button aria-label="Send now">Send</button></form></section>
<template><p>Later</p></template>
<svg viewBox="0 0 1 1"><title>Icon</title><path d="M0 0"/><text>Svg label</text></svg>
<noscript><p>No script</p></noscript>
<aside id="gift_cards-box"><p>Gift cards</p></aside>
<footer>© 2026 &copy; Spa</footer>
</body></html>`

const fixture = (name: string) =>
  readFileSync(new URL(`../../../apps/web/e2e/fixtures/${name}`, import.meta.url), 'utf8')
const all = (h: string, en: string) =>
  applyHtmlTextOverrides(
    h,
    listHtmlDesignTexts(h).map((x) => ({ id: x.id, src: x.src, t: { en } })),
    'en',
  )
const count = (h: string, s: string) => h.split(s).length - 1

describe('listHtmlDesignTexts (R28 P4)', () => {
  it('lists text nodes, alt/placeholder/aria-label/title attributes, the first title outside svg and the meta description with positional ids; skips script/style/comment/raw-text bodies, blank runs and texts or values holding < or >; lists template and option texts', () => {
    const list = listHtmlDesignTexts(textsDoc)
    expect(list.map((x) => [x.id, x.kind, x.attr ?? '', x.tag, x.text])).toEqual([
      ['title', 'title', '', 'title', 'Rituals & Rest'],
      ['meta-description', 'meta', '', 'meta', 'Calm massage in Dubai'],
      ['attr-0', 'attr', 'aria-label', 'nav', 'Main menu'],
      ['txt-0', 'text', '', 'a', 'Home'],
      ['attr-1', 'attr', 'title', 'a', 'Our rituals'],
      ['txt-1', 'text', '', 'a', 'Rituals'],
      ['txt-2', 'text', '', 'h2', 'Our \u00a0story'], // U+00A0 kept, HTML whitespace collapsed
      ['txt-3', 'text', '', 'p', 'Since 2010 — calm hands.'],
      ['attr-2', 'attr', 'alt', 'img', 'Lounge'],
      ['txt-4', 'text', '', 'p', 'a < b'],
      ['txt-5', 'text', '', 'h3', 'Treatments'],
      ['attr-3', 'attr', 'placeholder', 'input', 'Your name'],
      ['txt-6', 'text', '', 'option', 'Swedish'],
      ['attr-4', 'attr', 'aria-label', 'button', 'Send now'],
      ['txt-7', 'text', '', 'button', 'Send'],
      ['txt-8', 'text', '', 'p', 'Later'],
      ['txt-9', 'text', '', 'text', 'Svg label'],
      ['txt-10', 'text', '', 'p', 'Gift cards'],
      ['txt-11', 'text', '', 'footer', '© 2026 © Spa'],
    ])
    expect(list.every((x) => x.src === x.text && !x.bound)).toBe(true)
    expect(listHtmlDesignTexts('<svg><title>Icon</title></svg><title>Page</title><p>x</p>')[0]).toMatchObject(
      {
        id: 'title',
        text: 'Page',
      },
    )
    expect(listHtmlDesignTexts('<title>  </title><meta name=description content="">')).toMatchObject([
      { id: 'title', text: '' },
      { id: 'meta-description', text: '' },
    ])
    expect(listHtmlDesignTexts(`<p>${'x'.repeat(2500)}</p>`)[0]).toMatchObject({
      text: 'x'.repeat(2000),
      src: 'x'.repeat(300),
    })
  })

  it('groups by the nearest section/header/nav/footer: aria-label, first heading, id, fallback', () => {
    const groups = Object.fromEntries(listHtmlDesignTexts(textsDoc).map((x) => [x.id, x.group]))
    expect(groups).toMatchObject({
      title: '',
      'meta-description': '',
      'attr-0': 'Main menu',
      'txt-0': 'Main menu',
      'txt-2': 'Our \u00a0story',
      'attr-2': 'Our \u00a0story',
      'txt-5': 'Treatments',
      'attr-3': 'Form 1',
      'txt-7': 'Form 1',
      'txt-8': '',
      'txt-10': 'Gift cards box',
      'txt-11': 'Footer 1',
    })
  })

  it('marks bound: data-crm / data-item / data-book-service (inherited, "crm"); text the design’s JS writes by id, document.title ("crm" with a CRM contract — CRM_DATA literal or crm-endpoint meta —, else "script"); the CRM_DATA literal is not read', () => {
    const html = `<html><head><title>Design</title></head><body>
<div data-crm="spa.name"><h1>Design Spa</h1></div>
<ul data-item="services"><li><b>Ritual</b></li></ul>
<a data-book-service href="#" title="Book now">Book</a>
<p id="hours">Mon–Sun</p><p id="note">Free text</p><span id="promo">Promo</span><p id="crm-only">Literal only</p>
<script>document.getElementById('hours').textContent = 'x'; document.querySelector("#promo .x").textContent = 'y'; document.title = 'Live'</script>
<script>window.CRM_DATA = {"id":"crm-only","note":"#note"}</script>
</body></html>`
    const rows = (h: string) =>
      listHtmlDesignTexts(h).map((x) => [x.text, x.bound, x.boundBy ?? '', x.binding ?? ''])
    const expected = (by: string) => [
      ['Design', true, by, 'document.title'],
      ['Design Spa', true, 'crm', 'data-crm=spa.name'],
      ['Ritual', true, 'crm', 'data-item=services'],
      ['Book now', true, 'crm', 'data-book-service'],
      ['Book', true, 'crm', 'data-book-service'],
      ['Mon–Sun', true, by, '#hours'],
      ['Free text', false, '', ''],
      ['Promo', true, by, '#promo'], // `#promo .x` is written: inside #promo, so bound (when unsure, bound)
      ['Literal only', false, '', ''],
    ]
    expect(rows(html)).toEqual(expected('crm'))
    const literal = '<script>window.CRM_DATA = {"id":"crm-only","note":"#note"}</script>'
    expect(rows(html.replace(literal, ''))).toEqual(expected('script'))
    expect(
      rows(
        html
          .replace(literal, '')
          .replace('<title>', '<meta name="CRM-Endpoint" content="crm-data.json"><title>'),
      ),
    ).toEqual(expected('crm'))
  })

  it('bound by script only where the script writes the text: listener / toggle / read-only ids, getAttribute and attributes stay editable; direct, variable, helper and ancestor writes bind', () => {
    const html = `<html><head><title>T</title></head><body>
<button id="burger" aria-label="Menu">Menu</button><button id="langBtn" aria-label="Language">EN</button>
<h2 id="title">Our rituals</h2><button id="book">Book now</button><p id="yr">2025</p>
<p id="v1">Var text</p><p id="h1">Helper text</p><p id="h2">Arrow helper</p><div id="box"><p>Inner</p></div>
<p id="read">Read only</p><p id="jq">jQuery</p>
<script>
// document.getElementById('read').textContent = 'commented out'
document.getElementById('burger').onclick = () => document.getElementById('mmenu').classList.toggle('open')
document.getElementById("langBtn").textContent = 'ع'
document.querySelector('#book').addEventListener('click', () => {})
const t = document.getElementById('title').getAttribute('title')
document.getElementById('yr').textContent=new Date().getFullYear()
const v = document.getElementById('v1'); if (v) v.innerText = 'x'
function setText(id, value) { const el = document.getElementById(id); if (el) el.textContent = value }
setText('h1', 'x')
const put = (key, html) => { document.querySelector('#' + key).innerHTML = html }
put('h2', '<b>x</b>')
document.getElementById('box').innerHTML += ''
const n = document.getElementById('read').textContent.length
$('#jq').text('x')
</script></body></html>`
    const bound = listHtmlDesignTexts(html)
      .filter((x) => x.bound)
      .map((x) => [x.kind, x.attr ?? '', x.text, x.boundBy, x.binding])
    expect(bound).toEqual([
      ['text', '', 'EN', 'script', '#langBtn'],
      ['text', '', '2025', 'script', '#yr'],
      ['text', '', 'Var text', 'script', '#v1'],
      ['text', '', 'Helper text', 'script', '#h1'],
      ['text', '', 'Arrow helper', 'script', '#h2'],
      ['text', '', 'Inner', 'script', '#box'],
      ['text', '', 'jQuery', 'script', '#jq'],
    ])
    // Editable: the menu button (listener), its and the language button's aria-label (attributes never), the
    // heading (getAttribute), "Book now" (listener only), "Read only" (read, or written in a comment).
    expect(
      listHtmlDesignTexts(html)
        .filter((x) => !x.bound)
        .map((x) => x.text),
    ).toEqual(['T', 'Menu', 'Menu', 'Language', 'Our rituals', 'Book now', 'Read only'])
    // Linear: long runs of letters, many id-like literals and calls.
    const big = `<p id="a">x</p><script>${'a'.repeat(300_000)} = (${'b'.repeat(100_000)}${"f('a');g = (x) => y;".repeat(20_000)}</script>`
    const t = Date.now()
    expect(listHtmlDesignTexts(big).map((x) => x.bound)).toEqual([false])
    expect(Date.now() - t).toBeLessThan(2000)
  })

  it('bound where the script writes the text in other ways: #id + descendant selector, child access, replaceChildren / append / prepend / insertAdjacentHTML, iterated id arrays, holder objects; listener-only and sibling-selector ids stay editable', () => {
    const html = `<html><head><title>T</title></head><body>
<p id="sel"><span>Selector child</span></p><p id="chain"><b>Chained child</b></p><ul id="kids"><li>Kid</li></ul>
<div id="q"><i>Query child</i></div><p id="rc">Replaced</p><p id="ap">Appended</p><p id="pp">Prepended</p>
<p id="ia">Inserted</p><p id="arr1">Array one</p><p id="arr2">Array two</p><p id="loop1">Loop one</p>
<p id="vl">Var loop</p><p id="hold">Holder</p><p id="self">This holder</p><p id="sibling">Sibling only</p>
<p id="listen">Listener</p><p id="unused-arr">Unused array</p><p id="opt">Optional</p>
<script>
document.querySelector('#sel span').textContent = 'x'
document.getElementById('chain').firstElementChild.textContent = 'x'
document.getElementById('kids').children[0].innerText = 'x'
const q = document.getElementById('q'); q.querySelector('i').textContent = 'x'
document.getElementById('rc').replaceChildren('x')
const ap = document.getElementById('ap'); ap.append('x')
$('#pp').prepend('x')
document.getElementById('ia').insertAdjacentHTML('beforeend', '<b>x</b>')
;['arr1', 'arr2'].forEach((id) => { document.getElementById(id).textContent = data[id] })
for (const id of ['loop1']) document.getElementById(id).textContent = 'x'
const ids = ['vl']
ids.forEach(function (k) { const el = document.getElementById(k); if (el) el.innerHTML = 'x' })
const els = { hold: document.getElementById('hold'), 'other': document.getElementById('listen') }
els.hold.textContent = 'x'
els.other.addEventListener('click', () => {})
class W { constructor() { this.box = document.getElementById('self') } paint() { this.box.lastElementChild.textContent = 'x' } }
document.querySelector('#sibling + p').textContent = 'x'
;['unused-arr'].forEach((id) => document.getElementById(id).addEventListener('click', go))
const o = document.getElementById('opt') || null
o?.replaceChildren()
</script></body></html>`
    const list = listHtmlDesignTexts(html)
    expect(list.filter((x) => x.bound).map((x) => [x.text, x.boundBy, x.binding])).toEqual(
      [
        ['Selector child', 'sel'],
        ['Chained child', 'chain'],
        ['Kid', 'kids'],
        ['Query child', 'q'],
        ['Replaced', 'rc'],
        ['Appended', 'ap'],
        ['Prepended', 'pp'],
        ['Inserted', 'ia'],
        ['Array one', 'arr1'],
        ['Array two', 'arr2'],
        ['Loop one', 'loop1'],
        ['Var loop', 'vl'],
        ['Holder', 'hold'],
        ['This holder', 'self'],
        ['Optional', 'opt'],
      ].map(([text, id]) => [text, 'script', `#${id}`]),
    )
    expect(list.filter((x) => !x.bound).map((x) => x.text)).toEqual([
      'T',
      'Sibling only',
      'Listener',
      'Unused array',
    ])
  })

  it('linear: 3000 element variables and a 1 MB script are read in one pass each', () => {
    const vars = Array.from(
      { length: 3000 },
      (_, k) => `const v${k} = document.getElementById('p${k}');`,
    ).join('\n')
    const html = `<p id="p7">Seven</p><p id="p8">Eight</p><script>${vars}\n${'x.y = z + 1; // filler\n'.repeat(45_000)}v7.textContent = 'x'</script>`
    expect(html.length).toBeGreaterThan(1_000_000)
    listHtmlDesignTexts(
      '<p id="a">x</p><script>const a = document.getElementById("a"); a.textContent = 1</script>',
    )
    const t = performance.now()
    expect(listHtmlDesignTexts(html).map((x) => [x.text, x.bound])).toEqual([
      ['Seven', true],
      ['Eight', false],
    ])
    expect(performance.now() - t).toBeLessThan(150)
  })

  it('decodes common named references (exact case); a run or value with an unknown / ambiguous reference is not listed (no id taken)', () => {
    const html =
      '<p>Caf&eacute; &rarr; &hearts; &check; &bull; &ldquo;x&rdquo; &mdash; &euro;5 &pound; &yen; &Eacute;&nbsp;A</p>' +
      '<p>Explore &unknownref; now</p><p title="A &zzz; b">Kept</p><p>Fish&Chips R&D a&b=1 &copy 2026</p>' +
      '<p>&notice</p><p>&#x1F600; &#39; &#128;</p><p>&EACUTE;</p><p>Last</p>'
    expect(listHtmlDesignTexts(html).map((x) => [x.id, x.text])).toEqual([
      ['txt-0', 'Café → ♥ ✓ • “x” — €5 £ ¥ É A'],
      ['txt-1', 'Kept'],
      ['txt-2', 'Fish&Chips R&D a&b=1 © 2026'],
      ['txt-3', 'Last'],
    ])
    // Render ids match the listing: an override of "Last" lands on it, the unlisted runs keep their bytes.
    const out = applyHtmlTextOverrides(html, [{ id: 'txt-3', src: 'Last', t: { en: 'New' } }], 'en')
    expect(out).toBe(html.replace('<p>Last</p>', '<p>New</p>'))
  })

  it('ids, src and bound are identical after the CRM splice', () => {
    const data = { spa: { name: '</script><p>Injected</p>' }, note: 'a < b & c > d', id: 'note' }
    const literal = `<!doctype html><html><head><title>T</title></head><body><h1 id="note">Hi</h1><p>Text</p>
<script>window.CRM_DATA = {"spa":{"name":"Design"}};</script><script>const n = 'hours'</script><p id="hours">9-5</p></body></html>`
    const endpoint = '<meta name="crm-endpoint" content="crm-data.json">'
    const cases = [
      literal,
      `<!doctype html><html><head>${endpoint}<title>T</title></head><body>  <h1 id="note">Hi</h1>\n<p>Text</p></body></html>`,
      `<!doctype html><html><head>${endpoint}</head><body><p>Before</p><script>const x = 'note'</script><h1 id="note">Hi</h1></body></html>`,
      `${endpoint}Lead text<h1 id="note">Hi</h1><p>Text</p>`,
    ]
    const injectAt = ['literal', 'head', 'script', 0]
    cases.forEach((raw, k) => {
      const found = htmlCrmContractOf(raw)!
      const at = found.literal
        ? 'literal'
        : found.inject && (raw.startsWith('<script', found.inject) ? 'script' : 'head')
      expect(at).toBe(injectAt[k])
      const out = spliceCrmData(raw, found, crmScriptJson(data), { inject: true })
      expect(out).not.toBe(raw)
      expect(listHtmlDesignTexts(out)).toEqual(listHtmlDesignTexts(raw))
    })
  })
})

describe('applyHtmlTextOverrides (R28 P4)', () => {
  it('no texts / [] / only stale or malformed entries → the very same string', () => {
    expect(applyHtmlTextOverrides(textsDoc, undefined, 'en')).toBe(textsDoc)
    expect(applyHtmlTextOverrides(textsDoc, [], 'en')).toBe(textsDoc)
    expect(applyHtmlTextOverrides(textsDoc, [{ id: 'txt-0', src: 'Other', t: { en: 'X' } }], 'en')).toBe(
      textsDoc,
    )
    expect(
      applyHtmlTextOverrides(
        textsDoc,
        [
          { id: 'bad', src: 'Home', t: { en: 'X' } },
          { id: 'txt-0', src: 'Home' },
          null,
          { id: 'txt-0', src: 'Home', t: { en: '  ' } },
        ] as never,
        'en',
      ),
    ).toBe(textsDoc)
  })

  it('escapes text, quoted / single-quoted / unquoted attributes, the title and meta: X<"\'&>= y adds no <, >, src= or style=; keeps leading/trailing whitespace', () => {
    const html = `<html><head><title>Old</title><meta name="description" content="Old desc"></head><body><p>
  Old text  </p><img alt="a" title='b' src="x.jpg"><input placeholder=c style="color:red"></body></html>`
    const v = `X<"'&>= y src=1 style=2`
    const out = all(html, v)
    const e = 'X&lt;&quot;&#39;&amp;&gt;'
    expect(out).toBe(
      `<html><head><title>${e}= y src=1 style=2</title><meta name="description" content="${e}&#61; y src&#61;1 style&#61;2"></head><body><p>
  ${e}= y src=1 style=2  </p><img alt="${e}&#61; y src&#61;1 style&#61;2" title='${e}&#61; y src&#61;1 style&#61;2' src="x.jpg"><input placeholder=${e}&#61;&#32;y&#32;src&#61;1&#32;style&#61;2 style="color:red"></body></html>`,
    )
    expect(count(out, '<')).toBe(count(html, '<'))
    expect(count(out, '>')).toBe(count(html, '>'))
    // No attribute added or lost: `src=` / `style=` in a value stay text.
    const names = (h: string, tag: string) => attributesOf(h, h.indexOf(tag) + tag.length).map((a) => a.name)
    expect(names(out, '<img')).toEqual(['alt', 'title', 'src'])
    expect(names(out, '<input')).toEqual(['placeholder', 'style'])
    expect(names(out, '<meta')).toEqual(['name', 'content'])
  })

  it('Arabic → English fallback; blank values skipped', () => {
    const html = '<p>One</p><p>Two</p><p>Three</p>'
    const texts = [
      { id: 'txt-0', src: 'One', t: { en: 'Hello', ar: 'مرحبا' } },
      { id: 'txt-1', src: 'Two', t: { en: 'Hi', ar: '  ' } },
      { id: 'txt-2', src: 'Three', t: { en: ' ' } },
    ]
    expect(applyHtmlTextOverrides(html, texts, 'ar')).toBe('<p>مرحبا</p><p>Hi</p><p>Three</p>')
    expect(applyHtmlTextOverrides(html, texts, 'en')).toBe('<p>Hello</p><p>Hi</p><p>Three</p>')
  })

  it('Arabic-only entries: the English page is byte-identical (the very same string); the Arabic page uses them', () => {
    const texts = listHtmlDesignTexts(textsDoc).map((x) => ({ id: x.id, src: x.src, t: { ar: 'نص' } }))
    expect(applyHtmlTextOverrides(textsDoc, texts, 'en')).toBe(textsDoc)
    expect(
      applyHtmlTextOverrides(
        textsDoc,
        texts.map((x) => ({ ...x, t: { en: '', ar: 'نص' } })),
        'en',
      ),
    ).toBe(textsDoc)
    expect(applyHtmlTextOverrides('<p>One</p>', [{ id: 'txt-0', src: 'One', t: { ar: 'واحد' } }], 'ar')).toBe(
      '<p>واحد</p>',
    )
  })

  it('a value equal to the design text keeps the original bytes (references, U+00A0, <pre> whitespace, the 2000-character listing)', () => {
    const html =
      '<html><head><title>Caf&eacute; &amp; Spa</title></head><body><h2>Caf&eacute; &rarr; ritual</h2>' +
      '<p>Price&nbsp;AED 350</p><pre>a\n   b</pre><p title="I &hearts; spa">x</p>' +
      `<p>${'y'.repeat(2500)}</p></body></html>`
    const listed = listHtmlDesignTexts(html)
    expect(listed.map((x) => x.text.slice(0, 20))).toEqual([
      'Café & Spa',
      'Café → ritual',
      'Price AED 350',
      'a b',
      'I ♥ spa',
      'x',
      'y'.repeat(20),
    ])
    // Echoed as English (the editor / AI copy the listed text), or as the Arabic fallback: nothing changes.
    const echo = listed.map((x) => ({ id: x.id, src: x.src, t: { en: x.text } }))
    expect(applyHtmlTextOverrides(html, echo, 'en')).toBe(html)
    expect(applyHtmlTextOverrides(html, echo, 'ar')).toBe(html)
    expect(applyHtmlTextOverrides(html, [{ ...echo[3]!, t: { en: ' a  b ' } }], 'en')).toBe(html)
    expect(applyHtmlTextOverrides(html, [{ ...echo[1]!, t: { en: 'Tea → ritual' } }], 'en')).toBe(
      html.replace('<h2>Caf&eacute; &rarr; ritual</h2>', '<h2>Tea → ritual</h2>'),
    )
  })

  it('skeleton property: overriding every text changes values only (inline fixture, fidelity + CRM contract fixtures)', () => {
    for (const raw of [textsDoc, fixture('fidelity.html'), fixture('crm-contract.html')]) {
      const out = all(raw, `<"'&>={{x}}`)
      expect(out).not.toBe(raw)
      expect(listHtmlDesignImages(out)).toEqual(listHtmlDesignImages(raw))
      expect(count(out, '<')).toBe(count(raw, '<'))
      const shape = (h: string) =>
        listHtmlDesignTexts(h).map(({ id, kind, attr, tag, bound }) => ({ id, kind, attr, tag, bound }))
      expect(shape(out)).toEqual(shape(raw))
      expect(all(out, '§')).toBe(all(raw, '§'))
    }
  })
})

describe('htmlDesignDocument with page texts (R28 P4)', () => {
  const page =
    '<html><head><title>T</title></head><body><h1>Old</h1><img alt="Old alt" src="https://cdn.test/a.jpg"></body></html>'
  it('texts run first: {{spa_name}} in an override is filled; an alt override on an adjusted img keeps the adjustment; phone fixes still apply', () => {
    const out = htmlDesignDocument(
      page,
      { spa_name: 'Zen & Co' },
      false,
      [{ id: 'img-0', src: 'https://cdn.test/a.jpg', x: 10 }],
      {},
      {
        phoneFixes: true,
        texts: [
          { id: 'txt-0', src: 'Old', t: { en: 'Welcome to {{spa_name}}', ar: 'أهلا في {{spa_name}}' } },
          { id: 'attr-0', src: 'Old alt', t: { en: 'New alt' } },
        ],
        locale: 'ar',
      },
    )
    expect(out).toContain('<h1>أهلا في Zen &amp; Co</h1>')
    expect(out).toContain('<img data-spa-img="0" alt="New alt" src="https://cdn.test/a.jpg">')
    expect(out).toContain('[data-spa-img="0"]{object-fit:cover!important;object-position:10% 50%!important}')
    expect(out).toContain(`<style data-spa-base>${HTML_DESIGN_BASE_CSS}</style>`)
  })
  it('{{placeholders}} in an override are plain escaped text: {{address}} adds no <a> and no map sheet; the designer’s own still links', () => {
    const links = { address: { href: 'https://maps.example/?q=1', label: 'Open in Google Maps' } }
    const values = { address: 'Al <Wasl> & Co', spa_name: '{{address}}' }
    const own = '<html><head><title>T</title></head><body><h1>Old</h1><p>{{address}}</p></body></html>'
    const texts = [{ id: 'txt-0', src: 'Old', t: { en: 'Find us: {{address}} · {{spa_name}} · {{nope}}' } }]
    const out = htmlDesignDocument(own, values, false, [], links, { texts, top: true })
    expect(out).toContain(
      '<h1>Find us: Al &lt;Wasl&gt; &amp; Co · &#123;&#123;address}} · &#123;&#123;nope}}</h1>',
    )
    expect(count(out, '<a ')).toBe(1) // the design's own {{address}}
    expect(count(out, 'data-spa-map-style')).toBe(1)
    const none = htmlDesignDocument(own.replace('<p>{{address}}</p>', ''), values, false, [], links, {
      texts,
      top: true,
    })
    expect(none).not.toContain('<a ')
    expect(none).not.toContain('data-spa-map')
    // A title / attribute override: escaped, never a link either.
    const attr = htmlDesignDocument(
      '<title>T</title><img alt="Old alt" src="/a.jpg">',
      values,
      false,
      [],
      links,
      {
        texts: [
          { id: 'title', src: 'T', t: { en: '{{address}}' } },
          { id: 'attr-0', src: 'Old alt', t: { en: 'At {{address}}' } },
        ],
        top: true,
      },
    )
    expect(attr).toContain('<title>Al &lt;Wasl&gt; &amp; Co</title>')
    expect(attr).toContain('alt="At Al &lt;Wasl&gt; &amp; Co"')
    expect(attr).not.toContain('<a ')
  })
  it('no texts → output identical to the call without texts / locale', () => {
    const plain = htmlDesignDocument(page, {}, false, [], {})
    expect(htmlDesignDocument(page, {}, false, [], {}, { texts: [], locale: 'ar' })).toBe(plain)
    expect(htmlDesignDocument(page, {}, false, [], {}, { texts: undefined })).toBe(plain)
  })
})
