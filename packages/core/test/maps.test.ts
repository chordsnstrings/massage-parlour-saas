import { describe, expect, it } from 'vitest'
import { htmlDesignDocument } from '../src/html-design'
import { branchMapsHref, isGoogleMapsUrl, mapsSearchUrl, normalizeGoogleMapsUrl } from '../src/maps'

describe('isGoogleMapsUrl', () => {
  it.each([
    'https://www.google.com/maps/place/Marina+Walk/@25.07,55.13,17z',
    'https://google.com/maps?q=25.07,55.13',
    'https://www.google.ae/maps/place/X',
    'https://maps.google.com/maps/place/X',
    'https://maps.google.com/?cid=123',
    'https://maps.google.ae/maps?q=spa',
    'https://maps.app.goo.gl/AbCdEf123',
    'https://goo.gl/maps/AbCdEf123',
    'http://maps.app.goo.gl/x',
  ])('accepts %s', (url) => expect(isGoogleMapsUrl(url)).toBe(true))

  it.each([
    '',
    'maps.app.goo.gl/x',
    'javascript:alert(1)//maps.app.goo.gl/x',
    'https://www.google.com/search?q=spa',
    'https://google.com.evil.test/maps',
    'https://evil.test/maps.app.goo.gl/x',
    'https://maps.app.goo.gl/',
    'https://goo.gl/abc',
    'https://user:pw@maps.app.goo.gl/x',
    'https://maps.google.com.evil.test/',
    'ftp://maps.google.com/',
    `https://maps.app.goo.gl/${'a'.repeat(2001)}`,
    // lookalike / third-party-registrable zones and Google's redirector
    'https://www.google.xyz/maps/x',
    'https://maps.google.sbs/',
    'https://maps.google.icu/x',
    'https://www.google.com.de/maps',
    'https://www.google.co.nl/maps',
    'https://www.google.co.uk/maps/@25,55,15z',
    'https://maps.google.com/url?q=https://evil.example',
    'https://www.google.com/url?q=https://evil.example',
    // markup / script breakout characters in the pasted text
    'https://maps.app.goo.gl/x onmouseover=alert(1)//',
    'https://maps.app.goo.gl/x?q=\\',
    'https://www.google.com/maps/x" y',
    'https://maps.app.goo.gl/x<script>',
    'https://maps.app.goo.gl/x`',
    'https://maps.app.goo.gl/x\tq',
  ])('rejects %s', (url) => expect(isGoogleMapsUrl(url)).toBe(false))

  it('normalizes to URL.href (what the settings actions store)', () => {
    expect(normalizeGoogleMapsUrl('HTTPS://Maps.App.Goo.gl/AbC')).toBe('https://maps.app.goo.gl/AbC')
    expect(normalizeGoogleMapsUrl('https://www.google.com/maps/place/سبا')).toBe(
      'https://www.google.com/maps/place/%D8%B3%D8%A8%D8%A7',
    )
    expect(normalizeGoogleMapsUrl('https://www.google.com/maps/x/onerror=alert(1)//')).toBe(
      'https://www.google.com/maps/x/onerror=alert(1)//',
    )
    expect(normalizeGoogleMapsUrl(null)).toBeNull()
  })
})

describe('branchMapsHref', () => {
  it('uses the exact pin when set, else searches the address', () => {
    expect(branchMapsHref({ address: 'Shop 4, Marina Walk', mapsUrl: 'https://maps.app.goo.gl/x1' })).toBe(
      'https://maps.app.goo.gl/x1',
    )
    expect(branchMapsHref({ address: 'Shop 4, Marina Walk', mapsUrl: null })).toBe(
      'https://www.google.com/maps/search/?api=1&query=Shop%204%2C%20Marina%20Walk',
    )
    expect(mapsSearchUrl('a&b')).toContain('query=a%26b')
  })
  it('ignores an invalid stored pin and returns null without an address', () => {
    expect(branchMapsHref({ address: 'X', mapsUrl: 'javascript:alert(1)' })).toBe(mapsSearchUrl('X'))
    expect(branchMapsHref({ address: 'X', mapsUrl: 'https://www.google.com/maps/x" y' })).toBe(
      mapsSearchUrl('X'),
    )
    expect(branchMapsHref({ address: 'X', mapsUrl: 'https://maps.app.goo.gl/x?q=\\' })).toBe(
      mapsSearchUrl('X'),
    )
    expect(branchMapsHref({ address: ' ', mapsUrl: null })).toBeNull()
    expect(branchMapsHref(null)).toBeNull()
  })
})

describe('htmlDesignDocument links', () => {
  const values = { address: 'Shop <4> "Marina"', map_url: 'https://maps.app.goo.gl/x?a=1&b=2' }
  const links = { address: { href: values.map_url, label: 'Open in Google Maps' } }
  const doc = (html: string) => htmlDesignDocument(html, values, false, [], links)

  it('turns {{address}} in text into an escaped maps link', () => {
    const out = doc('<html><head></head><body><p>Visit {{address}}</p></body></html>')
    expect(out).toContain(
      '<a href="https://maps.app.goo.gl/x?a=1&amp;b=2" target="_blank" rel="noopener" title="Open in Google Maps"',
    )
    expect(out).toContain('data-spa-map>Shop &lt;4&gt; &quot;Marina&quot;</a>')
    expect(out).not.toContain('<4>')
  })
  it('keeps plain escaped values in attributes, links, scripts and titles', () => {
    const out = doc(
      '<html><head><title>{{address}}</title></head><body><img alt="{{address}}"><a href="{{map_url}}">{{address}}</a><script>var a="{{address}}"</script></body></html>',
    )
    expect(out).not.toContain('data-spa-map>')
    expect(out).toContain('<title>Shop &lt;4&gt; &quot;Marina&quot;</title>')
    expect(out).toContain('alt="Shop &lt;4&gt; &quot;Marina&quot;"')
    expect(out).toContain('<a href="https://maps.app.goo.gl/x?a=1&amp;b=2">Shop')
  })
  it('stays plain without a maps href', () => {
    const out = htmlDesignDocument('<p>{{address}}</p>', values, false, [], {
      address: { href: null, label: 'x' },
    })
    expect(out).toContain('<p>Shop &lt;4&gt; &quot;Marina&quot;</p>')
  })

  describe('never splices link markup outside page text', () => {
    // A pin the old validator accepted; the href's tokens would become attributes if spliced into a tag.
    const evil = 'https://www.google.com/maps/x/onerror=alert(1)//'
    const crafted = { address: { href: evil, label: 'Open in Google Maps' } }
    const plain = 'Shop &lt;4&gt; &quot;Marina&quot;'
    const run = (html: string) => htmlDesignDocument(html, values, false, [], crafted)

    it.each([
      [
        'a > in a preceding attribute',
        `<div class="[&>p]:mt-2" title="{{address}}">Hi</div>`,
        `title="${plain}"`,
      ],
      ['a > before it in the same alt', `<img src=x alt="Spa > {{address}}">`, `alt="Spa > ${plain}"`],
      ['single quotes', `<p title='x > {{address}}'>y</p>`, `title='x > ${plain}'`],
      ['an Alpine expression', `<div x-show="n > 0" data-a="{{address}}"></div>`, `data-a="${plain}"`],
      ['an inline handler', `<b onclick="if(a>b)go()" title="{{address}}">b</b>`, `title="${plain}"`],
      ['an unquoted attribute', `<p title={{address}}>x</p>`, `title=${plain}>`],
      ['xmp', '<xmp>{{address}}</xmp>', `<xmp>${plain}</xmp>`],
      ['plaintext', '<plaintext>{{address}} <p>{{address}}</p>', `<p>${plain}</p>`],
      ['iframe', '<iframe>{{address}}</iframe>', `<iframe>${plain}</iframe>`],
      ['noembed', '<noembed>{{address}}</noembed>', `<noembed>${plain}</noembed>`],
      ['noframes', '<noframes>{{address}}</noframes>', `<noframes>${plain}</noframes>`],
      ['noscript', '<noscript>{{address}}</noscript>', `<noscript>${plain}</noscript>`],
      ['a comment', '<!-- {{address}} -->', `<!-- ${plain} -->`],
      ['a button', '<button>Go to {{address}}</button>', `<button>Go to ${plain}</button>`],
      ['a raw-text element closing at EOF', '<script>a="{{address}}"</script', `a="${plain}"`],
    ])('%s', (_, html, expected) => {
      const out = run(html)
      expect(out).not.toContain('data-spa-map>')
      expect(out).toContain(expected)
    })

    it('still links real text, also right after a tag with > in an attribute', () => {
      const out = run(
        '<p class="[&>p]:mt-2" title="a>b">Visit {{address}}</p><!-->{{address}}<a href=#>x</a> {{address}}',
      )
      expect(out.match(/data-spa-map>/g)).toHaveLength(3)
      expect(out).toContain(`<p class="[&>p]:mt-2" title="a>b">Visit <a href="${evil}"`)
    })

    it('ignores an unsafe href handed in directly', () => {
      const out = htmlDesignDocument('<p>{{address}}</p>', values, false, [], {
        address: { href: 'https://maps.app.goo.gl/x onmouseover=alert(1)//', label: 'x' },
      })
      expect(out).toContain(`<p>${plain}</p>`)
    })

    it('escapes a trailing backslash so it cannot end a design script string', () => {
      const out = htmlDesignDocument(
        '<script>var u="{{map_url}}";var a="{{address}}";</script>',
        {
          map_url: 'x\\',
          address: ';alert(1)//',
        },
        false,
      )
      expect(out).toContain('var u="x&#92;";var a=";alert(1)//";')
    })
  })
})
