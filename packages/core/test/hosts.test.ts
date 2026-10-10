import { describe, expect, it } from 'vitest'
import { canonicalScheme, hostRoutedUrl, parseRoots, pathRoutedAddress } from '../src'

// The move from path routing (sslip.io, ROUTING=path) to host routing on spamanagement.co: old addresses on any platform
// root (or its www.) → their host-routed home on the canonical root (proxy.ts).
describe('path-routed → host-routed addresses', () => {
  const roots = parseRoots('spamanagement.co', '134-209-145-162.sslip.io spamanagement.ae')
  const target = (host: string, path: string, current?: string | null) => {
    const old = pathRoutedAddress(host, path, roots)
    return old && hostRoutedUrl(old, roots[0]!, 'https', current)
  }

  it.each([
    ['134-209-145-162.sslip.io', '/app', 'https://app.spamanagement.co/'],
    ['134-209-145-162.sslip.io', '/app/', 'https://app.spamanagement.co/'],
    ['134-209-145-162.sslip.io', '/app/login', 'https://app.spamanagement.co/login'],
    ['134-209-145-162.sslip.io', '/app/pilot/calendar', 'https://app.spamanagement.co/pilot/calendar'],
    ['134-209-145-162.sslip.io', '/app/invite/abc123', 'https://app.spamanagement.co/invite/abc123'],
    [
      '134-209-145-162.sslip.io',
      '/app/pilot/app.webmanifest',
      'https://app.spamanagement.co/pilot/app.webmanifest',
    ],
    ['134-209-145-162.sslip.io', '/admin', 'https://admin.spamanagement.co/'],
    ['134-209-145-162.sslip.io', '/admin/tenants/42', 'https://admin.spamanagement.co/tenants/42'],
    ['134-209-145-162.sslip.io', '/s/pilot', 'https://pilot.spamanagement.co/'],
    ['134-209-145-162.sslip.io', '/s/pilot/', 'https://pilot.spamanagement.co/'],
    ['134-209-145-162.sslip.io', '/s/pilot/book/embed', 'https://pilot.spamanagement.co/book/embed'],
    ['134-209-145-162.sslip.io', '/s/Pilot/ar/services', 'https://pilot.spamanagement.co/ar/services'],
    // Every platform root and its www. (canonical included), always onto the canonical root.
    ['www.134-209-145-162.sslip.io', '/s/pilot/book', 'https://pilot.spamanagement.co/book'],
    ['SpaManagement.ae:443', '/admin/', 'https://admin.spamanagement.co/'],
    ['spamanagement.co', '/app/pilot', 'https://app.spamanagement.co/pilot'],
    ['www.spamanagement.co', '/s/pilot/sitemap.xml', 'https://pilot.spamanagement.co/sitemap.xml'],
  ])('%s%s → %s', (host, path, expected) => expect(target(host, path)).toBe(expected))

  it('swaps in the current slug of a renamed spa (F23) in one hop', () => {
    expect(target('134-209-145-162.sslip.io', '/s/old-spa/book', 'new-spa')).toBe(
      'https://new-spa.spamanagement.co/book',
    )
    expect(target('134-209-145-162.sslip.io', '/app/old-spa/clients', 'new-spa')).toBe(
      'https://app.spamanagement.co/new-spa/clients',
    )
    expect(pathRoutedAddress('spamanagement.co', '/app/old-spa/x', roots)).toEqual({
      surface: 'app',
      slug: 'old-spa',
      rest: '/x',
    })
    expect(pathRoutedAddress('spamanagement.co', '/admin/old-spa', roots)?.slug).toBeNull()
  })

  it.each([
    ['134-209-145-162.sslip.io', '/'],
    ['134-209-145-162.sslip.io', '/pricing'],
    ['134-209-145-162.sslip.io', '/apps'],
    ['134-209-145-162.sslip.io', '/administrator'],
    ['134-209-145-162.sslip.io', '/sitemap.xml'],
    ['134-209-145-162.sslip.io', '/s'],
    ['134-209-145-162.sslip.io', '/s/'],
    ['134-209-145-162.sslip.io', '/s/x'], // too short for a slug
    ['134-209-145-162.sslip.io', '/s/www/'], // reserved
    ['134-209-145-162.sslip.io', '/s/evil.example.com/'],
    ['134-209-145-162.sslip.io', '/s/a%2eb/'],
    ['134-209-145-162.sslip.io', '/s/user@evil.example/'],
    // Hosts that never served the path-routed surfaces: subdomains, custom domains, unknown hosts.
    ['app.spamanagement.co', '/app/pilot'],
    ['admin.spamanagement.co', '/admin'],
    ['pilot.spamanagement.co', '/s/pilot'],
    ['www.serenityspa.ae', '/app/pilot'],
    ['evil.example.com', '/s/pilot'],
    ['134.209.145.162', '/app'],
  ])('%s%s is not an old address', (host, path) => expect(pathRoutedAddress(host, path, roots)).toBeNull())

  it('keeps the host fixed whatever the path holds (no open redirect)', () => {
    for (const path of [
      '/app//evil.example/x',
      '/app/%2F%2Fevil.example',
      '/admin//evil.example',
      '/app/@evil',
    ])
      expect(new URL(target('spamanagement.co', path)!).host).toMatch(/^(app|admin)\.spamanagement\.co$/)
    expect(target('spamanagement.co', '/app//evil.example/x')).toBe(
      'https://app.spamanagement.co//evil.example/x',
    )
  })

  it('uses the canonical scheme and keeps a dev port', () => {
    const dev = parseRoots('localhost:3100', 'alt.localhost:3100')
    const old = pathRoutedAddress('alt.localhost:3100', '/s/pilot/book', dev)!
    expect(hostRoutedUrl(old, dev[0]!, canonicalScheme(dev[0]!, 'http://app.localhost:3100'))).toBe(
      'http://pilot.localhost:3100/book',
    )
    expect(canonicalScheme('spamanagement.co', 'https://app.spamanagement.co')).toBe('https')
    expect(canonicalScheme('spamanagement.co')).toBe('https')
    expect(canonicalScheme('localhost:3000')).toBe('http')
    expect(canonicalScheme('10.0.0.5')).toBe('http')
    expect(canonicalScheme('localhost:3000', 'https://app.localhost:3000')).toBe('https')
  })
})
