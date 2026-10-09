import { describe, expect, it } from 'vitest'
import { htmlDesignDocument } from '../src/html-design'
import { branchMapsHref, isGoogleMapsUrl, mapsSearchUrl } from '../src/maps'

describe('isGoogleMapsUrl', () => {
  it.each([
    'https://www.google.com/maps/place/Marina+Walk/@25.07,55.13,17z',
    'https://google.com/maps?q=25.07,55.13',
    'https://www.google.ae/maps/place/X',
    'https://www.google.co.uk/maps/@25,55,15z',
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
  ])('rejects %s', (url) => expect(isGoogleMapsUrl(url)).toBe(false))
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
})
