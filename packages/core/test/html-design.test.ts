import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import {
  applyHtmlImageAdjustments,
  attributesOf,
  decodeHtmlBytes,
  fixHtmlDesign,
  HTML_DESIGN_BASE_CSS,
  HTML_DESIGN_COMPAT_SHIM,
  htmlDesignDocOf,
  htmlDesignDocument,
  htmlDesignEmbedHosts,
  htmlDesignEmbedWarning,
  htmlDesignPhoneFixes,
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
