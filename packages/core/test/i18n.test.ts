import { describe, expect, it } from 'vitest'
import { createFormat, createTranslator, en, isLocale, lookup, th, translator } from '../src/i18n'
import { ui } from '../src/i18n/en-ui'

type Tree = { [key: string]: unknown }
const leaves = (tree: Tree, prefix = ''): [string, unknown][] =>
  Object.entries(tree).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null && !('other' in v)
      ? leaves(v as Tree, `${prefix}${k}.`)
      : [[`${prefix}${k}`, v]],
  )
const placeholders = (v: unknown) =>
  [...new Set(JSON.stringify(v).match(/\{\w+\}/g) ?? [])].filter((p) => p !== '{count}').sort()

describe('i18n catalogues', () => {
  it('TH has exactly the EN keys, with the same placeholders', () => {
    const e = new Map(leaves(en))
    const t = new Map(leaves(th))
    expect([...t.keys()].sort()).toEqual([...e.keys()].sort())
    for (const [key, value] of e) expect(placeholders(t.get(key)), key).toEqual(placeholders(value))
  })

  it('the UI-kit namespace is the standalone module the client falls back to', () => {
    expect(en.ui).toBe(ui)
  })
})

describe('translator', () => {
  it('translates, interpolates and falls back', () => {
    const t = translator('th')
    expect(t('nav.calendar')).toBe('ปฏิทิน')
    expect(t('shell.greeting.morning', { name: 'Aisha' })).toBe('สวัสดีตอนเช้า Aisha')
    expect(
      translator('en')('shell.plan.renews', { date: '1 Apr 2027', price: 'AED 24,000', interval: 'yr' }),
    ).toBe('Renews 1 Apr 2027 · AED 24,000/yr')
    const partial = createTranslator('th', { nav: {} }, en)
    expect(partial('nav.sales')).toBe('Sales')
    expect(partial('nope.missing' as never)).toBe('nope.missing')
  })

  it('picks plural forms per locale', () => {
    expect(translator('en')('validation.tooShort', { count: 1 })).toBe('Use at least 1 character')
    expect(translator('en')('validation.tooShort', { count: 10 })).toBe('Use at least 10 characters')
    expect(translator('th')('validation.tooShort', { count: 1 })).toBe('ใช้อย่างน้อย 1 ตัวอักษร')
  })

  it('recognises runtime string keys', () => {
    const t = translator('th')
    expect(t.has('errors.forbidden')).toBe(true)
    expect(t.has('Settings saved')).toBe(false)
    expect(t.maybe('errors.file.tooLarge', { size: '8 MB' })).toBe('ไฟล์ต้องมีขนาดไม่เกิน 8 MB')
    expect(t.maybe('Plain sentence.')).toBeUndefined()
    expect(lookup(en, 'nav.group')).toBeUndefined()
    expect(isLocale('th')).toBe(true)
    expect(isLocale('ar')).toBe(false)
  })
})

describe('format', () => {
  const at = new Date('2026-10-08T10:05:00Z') // 14:05 in Dubai
  it('keeps the English formats the dashboard already used', () => {
    const f = createFormat('en')
    expect(f.date(at)).toBe('8 Oct 2026')
    expect(f.dateTime(at)).toBe('8 Oct, 14:05')
    expect(f.aed(24000)).toMatch(/^AED\s24,000$/)
    expect(f.aed('12.5')).toMatch(/^AED\s12.50$/)
  })
  it('formats Thai with Gregorian years, Thai month names and Latin digits; money stays AED', () => {
    const f = createFormat('th')
    expect(f.date(at)).toBe('8 ต.ค. 2026')
    expect(f.monthYear(at)).toBe('ตุลาคม 2026')
    expect(f.time(at)).toBe('14:05')
    expect(f.percent(0.62)).toBe('62%')
    expect(f.aed(24000)).toMatch(/^AED\s24,000$/)
  })
})
