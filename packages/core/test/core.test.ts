import { describe, expect, it } from 'vitest'
import {
  ALL_PERMISSIONS,
  asciiDigits,
  CUSTOM_ROLE_PERMISSIONS,
  callingCode,
  checkSlug,
  DEFAULT_EMAIL_FROM,
  matchRoot,
  normalizeSlug,
  PHONE_ROLES,
  parseRoots,
  phoneDisplay,
  resolvePermissions,
  resolveSurface,
  roleMayHold,
  SYSTEM_ROLES,
  toClientE164,
  toE164,
  toUaeE164,
  trimTrailing,
  trimTrailingSlashes,
  uaePhoneDisplay,
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
    expect(DEFAULT_EMAIL_FROM).toBe('spamanagement.co <ask@spamanagement.co>') // the only address (owner)
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

describe('trimTrailingSlashes', () => {
  it('drops only trailing slashes, linear on long runs', () => {
    expect(trimTrailingSlashes('https://a.test//')).toBe('https://a.test')
    expect(trimTrailingSlashes('/a/b')).toBe('/a/b')
    expect(trimTrailingSlashes('///')).toBe('')
    const t = Date.now()
    expect(trimTrailingSlashes(`${'/'.repeat(200_000)}x`)).toBe(`${'/'.repeat(200_000)}x`)
    expect(Date.now() - t).toBeLessThan(500)
  })

  it('trims any one character the same way', () => {
    expect(trimTrailing('a.test...', '.')).toBe('a.test')
    const t = Date.now()
    expect(trimTrailing(`${'.'.repeat(200_000)}x`, '.')).toBe(`${'.'.repeat(200_000)}x`)
    expect(Date.now() - t).toBeLessThan(500)
  })
})

describe('slugs', () => {
  it('normalizes and validates', () => {
    expect(normalizeSlug('  Serenity Spa & Wellness!! ')).toBe('serenity-spa-wellness')
    expect(normalizeSlug('--Lotus--Garden--')).toBe('lotus-garden')
    expect(normalizeSlug('-')).toBe('')
    const t = performance.now()
    expect(normalizeSlug(`${'-'.repeat(200_000)}x`)).toBe('x') // no quadratic hyphen trim
    expect(performance.now() - t).toBeLessThan(500)
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
      new Set(['calendar.view', 'calendar.ownStatus', 'timeclock.leave']),
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
    ['٠٥٠ ١٢٣ ٤٥٦٧', '971501234567'],
    ['۰۵۰۱۲۳۴۵۶۷', '971501234567'],
  ])('toUaeE164(%s)', (input, out) => expect(toUaeE164(input)).toBe(out))

  it.each([
    ['050 123 4567', '971501234567'],
    ['+971 (0)50 123 4567', '971501234567'],
    ['04 123 4567', '97141234567'],
    ['+44 7700 900123', '447700900123'],
    ['0044 20 7946 0958', '442079460958'],
    ['+1 (555) 010-0199', '15550100199'],
    ['+44 (0)20 7946 0958', '442079460958'],
    ['+44 07700 900123', '447700900123'],
    ['0049 030 1234567', '49301234567'],
    ['+39 06 1234 5678', '390612345678'],
    ['07700 900123', null],
    ['+971 50 123', null],
    ['12345', null],
    ['+0 123 456 789', null],
    ['call me', null],
    ['50+1234567', null],
    // Arabic-Indic and Extended Arabic-Indic (Persian) digits, also mixed with ASCII (QA M3).
    ['٠٥٠ ١٢٣ ٤٥٦٧', '971501234567'],
    ['+٩٧١ ٥٠ ١٢٣ ٤٥٦٧', '971501234567'],
    ['۰۵۰ ۱۲۳ ۴۵۶۷', '971501234567'],
    ['٠٤ 123 ٤٥٦٧', '97141234567'],
    ['+٤٤ ٧٧٠٠ ٩٠٠١٢٣', '447700900123'],
    ['٠٥٠ ١٢٣', null],
    // Pasted with invisible direction marks (WhatsApp / iOS Contacts / Arabic keyboards), as toUaeE164 accepts.
    ['\u202a+971 50 123 4567\u202c', '971501234567'],
    ['\u200f٠٥٠١٢٣٤٥٦٧', '971501234567'],
    ['\u061c٠٥٠١٢٣٤٥٦٧', '971501234567'],
    ['\u2066+971501234567\u2069', '971501234567'],
    ['\u200e+44 7700 900123\u200e', '447700900123'],
    ['\ufeff04 123 4567', '97141234567'],
    ['\u202bcall me\u202c', null],
  ])('toE164(%s)', (input, out) => expect(toE164(input)).toBe(out))

  // R38 client phones: no + / 00 = UAE mobile (as toUaeE164); + / 00 = any country, UAE still mobiles only.
  it.each([
    ['050 123 4567', '971501234567'],
    ['501234567', '971501234567'],
    ['971 50 123 4567', '971501234567'],
    ['+971 50 123 4567', '971501234567'],
    ['00971 50 123 4567', '971501234567'],
    ['+971 (0)50 123 4567', '971501234567'],
    ['٠٥٠ ١٢٣ ٤٥٦٧', '971501234567'],
    ['+٩٧١ ٥٠ ١٢٣ ٤٥٦٧', '971501234567'],
    ['‪+971 50 123 4567‬', '971501234567'],
    ['04 123 4567', null],
    ['+971 4 123 4567', null],
    ['+971 04 123 4567', null],
    ['0097141234567', null],
    ['447700900123', null],
    ['07700 900123', null],
    ['+44 7700 900123', '447700900123'],
    ['0044 7700 900123', '447700900123'],
    ['+44 (0)20 7946 0958', '442079460958'],
    ['+44 07700 900123', '447700900123'],
    ['0049 030 1234567', '49301234567'],
    ['+39 06 1234 5678', '390612345678'],
    ['+1 202-555-0123', '12025550123'],
    ['+966 50 123 4567', '966501234567'],
    ['+٤٤ ٧٧٠٠ ٩٠٠١٢٣', '447700900123'],
    ['+44 7700', null],
    ['+44 7700 900123 456789', null],
    ['+44 7700 9OO123', null],
    ['call me', null],
    ['++44 7700 900123', null],
    ['+44 +7700 900123', null],
    ['', null],
    // +971 keeps toUaeE164's leniency for stray text (imports, pasted contacts)
    ['+971 50 123 4567 (home)', '971501234567'],
    ['+971501234567,', '971501234567'],
    ['00971501234567 mobile', '971501234567'],
    ['+971-50-123-4567 ext', '971501234567'],
    ['+971 50 123 4567;', '971501234567'],
    ['+971 4 123 4567 (office)', null],
    // + / 00 and 9 digits from 5: a UAE mobile without 971, or +508 / +597: refused, never guessed as UAE
    ['+597 412345', null],
    ['+508 41 23 45', null],
    ['00597412345', null],
    ['+50 123 4567', null],
    ['+597 123 4567', '5971234567'],
    // trunk 0 right after the code; bracketed codes
    ['+4407700900123', '447700900123'],
    ['+390612345678', '390612345678'],
    ['(+44) 7700 900123', '447700900123'],
    ['(0044) 7700 900123', '447700900123'],
    ['(+1) 202-555-0123', '12025550123'],
    ['(+966) 50 123 4567', '966501234567'],
    ['(+971) 50 123 4567', '971501234567'],
  ])('toClientE164(%s)', (input, out) => expect(toClientE164(input)).toBe(out))

  it('reads back every edit prefill (uaePhoneDisplay) as the same client phone', () => {
    for (const e of [
      '971501234567',
      '447700900123',
      '12025550123',
      '390612345678',
      '49301234567',
      '966501234567',
    ])
      expect(toClientE164(uaePhoneDisplay(e))).toBe(e)
  })

  it('splits calling codes and shows / masks any number, UAE as before', () => {
    expect(
      ['12025550123', '79161234567', '447700900123', '390612345678', '966501234567', '971501234567'].map(
        callingCode,
      ),
    ).toEqual(['1', '7', '44', '39', '966', '971'])
    expect(phoneDisplay('971501234567')).toBe('+971 50 123 4567')
    expect(phoneDisplay('447700900123')).toBe('+447700900123')
    expect(phoneDisplay('')).toBe('')
    expect(phoneDisplay('971501234567', { mask: 'last4' })).toBe('+971 50 ••• 4567')
    expect(phoneDisplay('971501234567', { mask: 'last2' })).toBe('+971 50 ••• ••67')
    expect(phoneDisplay('447700900123', { mask: 'last4' })).toBe('+44 ••• 0123')
    expect(phoneDisplay('12025550123', { mask: 'last4' })).toBe('+1 ••• 0123')
    expect(phoneDisplay('966501234567', { mask: 'last2' })).toBe('+966 ••• ••67')
    expect(phoneDisplay('97141234567', { mask: 'last4' })).toBe('+971 ••• 4567')
    expect(phoneDisplay('3545551234', { mask: 'last4' })).toBe('+354 ••• 1234') // 7-digit national: 3 hidden
    expect(phoneDisplay('35412345', { mask: 'last4' })).toBe('+354 ••• 45') // 5-digit national: 3 hidden
    expect(phoneDisplay('1234567', { mask: 'last4' })).toBe('•••')
    // At least 3 national digits always hidden, whatever the length.
    for (const n of [
      '447700900123',
      '12025550123',
      '919876543210',
      '35412345',
      '6012345678',
      '4930123456789',
    ])
      for (const mask of ['last4', 'last2'] as const) {
        const cc = callingCode(n)
        const shown = phoneDisplay(n, { mask })
          .slice(cc.length + 1)
          .replace(/\D/g, '')
        expect(n.length - cc.length - shown.length).toBeGreaterThanOrEqual(3)
      }
  })

  it('maps Arabic-Indic digits to ASCII and leaves the rest', () => {
    expect(asciiDigits('٠١٢٣٤٥٦٧٨٩ ۰۱۲۳۴۵۶۷۸۹ +971')).toBe('0123456789 0123456789 +971')
  })

  it('builds links per mode', () => {
    expect(whatsappLink('971501234567', 'Hi & bye')).toBe('https://wa.me/971501234567?text=Hi%20%26%20bye')
    expect(whatsappLink('971501234567', 'x', 'desktop')).toBe('whatsapp://send?phone=971501234567&text=x')
  })
})
