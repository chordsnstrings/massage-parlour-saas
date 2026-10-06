import { describe, expect, it } from 'vitest'
import {
  ALL_PERMISSIONS,
  checkSlug,
  normalizeSlug,
  resolvePermissions,
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
