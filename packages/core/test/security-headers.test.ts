import { describe, expect, it } from 'vitest'
import {
  API_CSP,
  blockedSource,
  contentSecurityPolicy,
  HTML_DESIGN_SANDBOX,
  htmlDesignFrameCsp,
  newNonce,
  pageKindOf,
  pageSecurityHeaders,
  parseCspReports,
  SITE_EMBED_ORIGINS,
  TURNSTILE_ORIGIN,
} from '../src'

const directives = (csp: string) =>
  Object.fromEntries(
    csp.split(';').map((d) => {
      const [name, ...values] = d.trim().split(/\s+/)
      return [name!, values]
    }),
  )

describe('pageKindOf (F10)', () => {
  it('maps internal paths to surfaces; only the widget iframe route is an embed', () => {
    expect(pageKindOf('/marketing/pricing')).toEqual({ surface: 'marketing', embed: false })
    expect(pageKindOf('/dashboard/serenity/bookings')).toEqual({ surface: 'app', embed: false })
    expect(pageKindOf('/platform/settings')).toEqual({ surface: 'admin', embed: false })
    expect(pageKindOf('/site/serenity/book')).toEqual({ surface: 'site', embed: false })
    expect(pageKindOf('/site/serenity/book/embed')).toEqual({ surface: 'site', embed: true })
    expect(pageKindOf('/domain/www.spa.ae/book/embed')).toEqual({ surface: 'domain', embed: true })
    expect(pageKindOf('/domain/www.spa.ae')).toEqual({ surface: 'domain', embed: false })
    // A page slug that merely contains "embed" is not the widget route.
    expect(pageKindOf('/site/serenity/embed').embed).toBe(false)
    expect(pageKindOf('/dashboard/x/book/embed').embed).toBe(false)
  })
})

describe('contentSecurityPolicy (F10)', () => {
  const nonce = 'abc123=='

  it('strict nonce script policy on every surface, no unsafe-inline/eval for scripts in production', () => {
    for (const surface of ['marketing', 'app', 'admin', 'site', 'domain'] as const) {
      const d = directives(contentSecurityPolicy({ surface, embed: false, nonce }))
      expect(d['script-src']).toEqual(
        expect.arrayContaining(["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"]),
      )
      expect(d['script-src']).not.toContain("'unsafe-inline'")
      expect(d['script-src']).not.toContain("'unsafe-eval'")
      expect(d['object-src']).toEqual(["'none'"])
      expect(d['base-uri']).toEqual(["'self'"])
      expect(d['form-action']).toEqual(["'self'"])
      expect(d['frame-ancestors']).toEqual(["'self'"])
      expect(d['connect-src']).toEqual(["'self'"])
      expect(d['worker-src']).toEqual(["'self'"])
      expect(d['img-src']).toEqual(["'self'", 'data:', 'blob:', 'https:'])
      expect(d['font-src']).toEqual(["'self'", 'data:'])
      // Documented decision: inline styles (React style attributes, Radix/Puck <style> injection).
      expect(d['style-src']).toEqual(["'self'", "'unsafe-inline'"])
      expect(d['report-uri']).toEqual([`/api/csp-report?s=${surface}`])
      expect(d['upgrade-insecure-requests']).toBeUndefined()
    }
  })

  it('allows Turnstile only where a Turnstile form exists (not the admin console)', () => {
    for (const surface of ['marketing', 'app', 'site', 'domain'] as const) {
      const d = directives(contentSecurityPolicy({ surface, embed: false, nonce }))
      expect(d['script-src']).toContain(TURNSTILE_ORIGIN)
      expect(d['frame-src']?.slice(0, 2)).toEqual(["'self'", TURNSTILE_ORIGIN])
    }
    const admin = directives(contentSecurityPolicy({ surface: 'admin', embed: false, nonce }))
    expect(admin['script-src']).not.toContain(TURNSTILE_ORIGIN)
    expect(admin['frame-src']).toEqual(["'self'"])
  })

  it('frames only the Map/Video players, and only on spa sites + the app (Studio preview)', () => {
    for (const surface of ['app', 'site', 'domain'] as const) {
      const d = directives(contentSecurityPolicy({ surface, embed: false, nonce }))
      expect(d['frame-src']).toEqual([
        "'self'",
        TURNSTILE_ORIGIN,
        'https://www.google.com',
        'https://www.youtube-nocookie.com',
        'https://player.vimeo.com',
      ])
      // Uploaded videos play from /files only.
      expect(d['media-src']).toBeUndefined()
      expect(d['default-src']).toEqual(["'self'"])
    }
    for (const surface of ['marketing', 'admin'] as const) {
      const d = directives(contentSecurityPolicy({ surface, embed: false, nonce }))
      for (const origin of SITE_EMBED_ORIGINS) expect(d['frame-src']).not.toContain(origin)
    }
  })

  it('lets any site frame the booking widget, adds eval only in dev and upgrades only over https', () => {
    const embed = directives(contentSecurityPolicy({ surface: 'site', embed: true, nonce }))
    expect(embed['frame-ancestors']).toEqual(['*'])
    const dev = directives(contentSecurityPolicy({ surface: 'app', embed: false, nonce, dev: true }))
    expect(dev['script-src']).toContain("'unsafe-eval'")
    const https = directives(contentSecurityPolicy({ surface: 'app', embed: false, nonce, https: true }))
    expect(https['upgrade-insecure-requests']).toEqual([])
  })
})

describe('pageSecurityHeaders (F10)', () => {
  it('frames, opener isolation and HSTS per surface', () => {
    const page = pageSecurityHeaders({ nonce: 'n', internalPath: '/platform', https: true })
    expect(page['x-frame-options']).toBe('SAMEORIGIN')
    expect(page['cross-origin-opener-policy']).toBe('same-origin')
    expect(page['strict-transport-security']).toBe('max-age=31536000; includeSubDomains')
    expect(page['content-security-policy']).toContain("'nonce-n'")

    // WhatsApp Web reuses one named tab from the dashboard outbox.
    const app = pageSecurityHeaders({ nonce: 'n', internalPath: '/dashboard/x', https: false })
    expect(app['cross-origin-opener-policy']).toBe('same-origin-allow-popups')
    expect(app['strict-transport-security']).toBeUndefined()

    // A spa's own domain: no includeSubDomains (its other subdomains may be http-only).
    const custom = pageSecurityHeaders({ nonce: 'n', internalPath: '/domain/spa.ae/about', https: true })
    expect(custom['strict-transport-security']).toBe('max-age=31536000')

    const embed = pageSecurityHeaders({ nonce: 'n', internalPath: '/site/x/book/embed', https: true })
    expect(embed['x-frame-options']).toBeUndefined()
    expect(embed['cross-origin-opener-policy']).toBeUndefined()
    expect(embed['content-security-policy']).toContain('frame-ancestors *')
  })

  it('fresh 128-bit nonces', () => {
    const a = newNonce()
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/)
    expect(newNonce()).not.toBe(a)
  })
})

describe('API + HTML design policies (F10)', () => {
  it('APIs load nothing and cannot be framed', () => {
    expect(directives(API_CSP)).toEqual({
      'default-src': ["'none'"],
      'frame-ancestors': ["'none'"],
      'base-uri': ["'none'"],
      'form-action': ["'none'"],
    })
  })

  it('the design shell runs anything, but always sandboxed and only inside platform pages', () => {
    const d = directives(htmlDesignFrameCsp())
    expect(d.sandbox).toEqual(HTML_DESIGN_SANDBOX.split(' '))
    expect(d.sandbox).not.toContain('allow-same-origin')
    expect(d['frame-ancestors']).toEqual(["'self'"])
    expect(d['script-src']).toEqual(expect.arrayContaining(['*', "'unsafe-inline'"]))
    expect(d['object-src']).toEqual(["'none'"])
  })
})

describe('CSP reports (F10)', () => {
  it('reads CSP2 and Reporting API bodies, keeps only origins and paths', () => {
    expect(
      parseCspReports({
        'csp-report': {
          'document-uri': 'https://app.spamanagement.co/serenity/bookings?token=secret',
          'violated-directive': 'script-src-elem',
          'effective-directive': 'script-src-elem',
          'blocked-uri': 'https://evil.example/x.js?q=1',
        },
      }),
    ).toEqual([{ directive: 'script-src-elem', blocked: 'https://evil.example', path: '/serenity/bookings' }])
    expect(
      parseCspReports([
        {
          type: 'csp-violation',
          body: {
            documentURL: 'https://a.test/',
            effectiveDirective: 'script-src-elem',
            blockedURL: 'inline',
          },
        },
        { type: 'deprecation', body: {} },
      ]),
    ).toEqual([{ directive: 'script-src-elem', blocked: 'inline', path: '/' }])
  })

  it('drops extension noise and junk', () => {
    expect(
      parseCspReports({
        'csp-report': { 'effective-directive': 'script-src', 'blocked-uri': 'chrome-extension://abc/x.js' },
      }),
    ).toEqual([])
    expect(
      parseCspReports({
        'csp-report': {
          'effective-directive': 'img-src',
          'source-file': 'moz-extension://x',
          'blocked-uri': 'data',
        },
      }),
    ).toEqual([])
    expect(parseCspReports({ 'csp-report': { 'effective-directive': '<script>' } })).toEqual([])
    expect(parseCspReports('nope')).toEqual([])
    expect(parseCspReports(null)).toEqual([])
    expect(blockedSource('data:image/png;base64,xx')).toBe('data')
    expect(blockedSource('eval')).toBe('eval')
    expect(blockedSource('wss://x.test/socket')).toBe('wss://x.test')
    expect(blockedSource('about:blank')).toBe('about')
    expect(blockedSource('')).toBe('other')
  })
})
