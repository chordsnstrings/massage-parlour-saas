import { describe, expect, it } from 'vitest'
import {
  ALL_PERMISSIONS,
  checkSlug,
  DEFAULT_EMAIL_FROM,
  matchRoot,
  normalizeSlug,
  parseRoots,
  CUSTOM_ROLE_PERMISSIONS,
  PHONE_ROLES,
  resolvePermissions,
  roleMayHold,
  resolveSurface,
  SYSTEM_ROLES,
  toUaeE164,
  whatsappLink,
} from '../src'

describe('resolveSurface', () => {
  const root = 'spamanagement.ae'
  it.each([
    ['spamanagement.ae', { kind: 'marketing' }],
    ['www.spamanagement.ae', { kind: 'marketing' }],
    ['app.spamanagement.ae', { kind: 'app' }],
    ['ADMIN.spamanagement.ae:443', { kind: 'admin' }],
    ['pilot.spamanagement.ae', { kind: 'site', slug: 'pilot' }],
    ['a.b.spamanagement.ae', { kind: 'custom', hostname: 'a.b.spamanagement.ae' }],
    ['www.serenityspa.ae', { kind: 'custom', hostname: 'www.serenityspa.ae' }],
  ])('%s', (host, expected) => expect(resolveSurface(host, root)).toEqual(expected))

  it('handles the dev root with a port', () => {
    expect(resolveSurface('pilot.localhost:3000', 'localhost:3000')).toEqual({ kind: 'site', slug: 'pilot' })
    expect(resolveSurface('localhost:3000', 'localhost:3000')).toEqual({ kind: 'marketing' })
  })
})

describe('platform roots', () => {
  it('parses canonical + extra roots from comma or space separated config', () => {
    expect(parseRoots('SpaManagement.ae', 'old.example.com, other.example.com  third.example.com.')).toEqual([
      'spamanagement.ae',
      'old.example.com',
      'other.example.com',
      'third.example.com',
    ])
    expect(parseRoots('localhost:3000', undefined, '')).toEqual(['localhost:3000'])
  })

  it('matches a host to the most specific root it belongs to', () => {
    const roots = ['localhost:3100', 'spa.localhost:3100']
    expect(matchRoot('app.spa.localhost:3100', roots)).toBe('spa.localhost:3100')
    expect(matchRoot('app.localhost:3100', roots)).toBe('localhost:3100')
    expect(matchRoot('evilspamanagement.ae', ['spamanagement.ae'])).toBeNull()
    expect(matchRoot('www.serenityspa.ae', roots)).toBeNull()
  })

  it('serves spamanagement.co (canonical) and the old spamanagement.ae side by side', () => {
    const roots = parseRoots('spamanagement.co', 'spamanagement.ae')
    expect(roots).toEqual(['spamanagement.co', 'spamanagement.ae'])
    for (const root of roots) {
      expect(resolveSurface(root, roots)).toEqual({ kind: 'marketing' })
      expect(resolveSurface(`app.${root}`, roots)).toEqual({ kind: 'app' })
      expect(resolveSurface(`admin.${root}`, roots)).toEqual({ kind: 'admin' })
      expect(resolveSurface(`pilot.${root}`, roots)).toEqual({ kind: 'site', slug: 'pilot' })
    }
    expect(matchRoot('spamanagement.com', roots)).toBeNull()
    expect(DEFAULT_EMAIL_FROM).toBe('spamanagement.co <no-reply@spamanagement.co>')
  })

  it('resolves surfaces on every platform domain', () => {
    const roots = ['spamanagement.ae', 'spa-old.example.com']
    expect(resolveSurface('app.spa-old.example.com', roots)).toEqual({ kind: 'app' })
    expect(resolveSurface('spa-old.example.com', roots)).toEqual({ kind: 'marketing' })
    expect(resolveSurface('pilot.spa-old.example.com', roots)).toEqual({ kind: 'site', slug: 'pilot' })
    expect(resolveSurface('admin.spamanagement.ae', roots)).toEqual({ kind: 'admin' })
    expect(resolveSurface('www.serenityspa.ae', roots)).toEqual({
      kind: 'custom',
      hostname: 'www.serenityspa.ae',
    })
  })
})

describe('slugs', () => {
  it('normalizes and validates', () => {
    expect(normalizeSlug('  Serenity Spa & Wellness!! ')).toBe('serenity-spa-wellness')
    expect(checkSlug('serenity-spa')).toEqual({ ok: true })
    expect(checkSlug('ab').ok).toBe(false)
    expect(checkSlug('-bad').ok).toBe(false)
    expect(checkSlug('admin')).toEqual({ ok: false, reason: 'This name is reserved.' })
  })
})

describe('permissions', () => {
  it('owner has everything and system roles resolve from code', () => {
    expect(resolvePermissions({ key: 'owner', permissions: [] }).size).toBe(ALL_PERMISSIONS.length)
    expect(resolvePermissions({ key: 'therapist', permissions: ['billing.view'] })).toEqual(
      new Set(['calendar.view']),
    )
  })
  it('custom roles keep only known permissions', () => {
    expect(resolvePermissions({ key: 'custom_x', permissions: ['pos.use', 'nope.nope'] })).toEqual(
      new Set(['pos.use']),
    )
  })
  it('therapists never see client phones', () => {
    expect(SYSTEM_ROLES.therapist.permissions).not.toContain('clients.phone')
  })
  it('client phones: only owner, manager and receptionist — never other system roles or custom roles', () => {
    for (const key of Object.keys(SYSTEM_ROLES))
      expect(resolvePermissions({ key, permissions: [] }).has('clients.phone')).toBe(
        (PHONE_ROLES as readonly string[]).includes(key),
      )
    expect([...PHONE_ROLES].sort()).toEqual(['manager', 'owner', 'receptionist'])
    // A custom role row that somehow stores it (old data, hand edit) still never gets it.
    expect(resolvePermissions({ key: 'custom_x', permissions: ['clients.phone', 'clients.view'] })).toEqual(
      new Set(['clients.view']),
    )
    expect(CUSTOM_ROLE_PERMISSIONS).not.toContain('clients.phone')
    expect(roleMayHold('therapist', 'clients.phone')).toBe(false)
    expect(roleMayHold('receptionist', 'clients.phone')).toBe(true)
  })
})

describe('whatsapp', () => {
  it.each([
    ['050 123 4567', '971501234567'],
    ['+971 50 123 4567', '971501234567'],
    ['00971501234567', '971501234567'],
    ['501234567', '971501234567'],
    ['04 123 4567', null],
  ])('toUaeE164(%s)', (input, out) => expect(toUaeE164(input)).toBe(out))

  it('builds links per mode', () => {
    expect(whatsappLink('971501234567', 'Hi & bye')).toBe('https://wa.me/971501234567?text=Hi%20%26%20bye')
    expect(whatsappLink('971501234567', 'x', 'desktop')).toBe('whatsapp://send?phone=971501234567&text=x')
  })
})
