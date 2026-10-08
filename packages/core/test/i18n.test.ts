import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createFormat,
  createTranslator,
  en,
  enumLabel,
  isLocale,
  lookup,
  permissionLabel,
  roleName,
  th,
  translator,
} from '../src/i18n'
import { ui } from '../src/i18n/en-ui'
import { isLeaf } from '../src/i18n/translate'
import { ALL_PERMISSIONS, PERMISSION_GROUPS, SYSTEM_ROLES } from '../src/permissions'

type Tree = { [key: string]: unknown }
const leaves = (tree: Tree, prefix = ''): [string, unknown][] =>
  Object.entries(tree).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null && !isLeaf(v)
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

  it('every namespace file exists in both languages and is wired into the aggregators', () => {
    const dir = join(__dirname, '../src/i18n')
    const files = (loc: string) =>
      readdirSync(join(dir, loc))
        .map((f) => f.replace(/\.ts$/, ''))
        .sort()
    expect(files('th')).toEqual([...files('en'), 'ui'].sort())
    for (const ns of files('en')) {
      const node = ns === 'domain' ? en.errors.domain : (en as Record<string, unknown>)[ns]
      expect(node, ns).toBeTypeOf('object')
    }
    expect(Object.keys(en).sort()).toEqual([...files('en').filter((n) => n !== 'domain'), 'ui'].sort())
  })

  it('permission labels cover the whole permission catalogue, in the same English', () => {
    const t = translator('en')
    for (const p of ALL_PERMISSIONS) {
      const [g, a] = p.split('.') as [keyof typeof PERMISSION_GROUPS, string]
      expect(permissionLabel(t, p)).toBe((PERMISSION_GROUPS[g].actions as Record<string, string>)[a])
    }
    for (const [key, role] of Object.entries(SYSTEM_ROLES))
      expect(roleName(t, { key, name: 'x' })).toBe(role.name)
    expect(roleName(translator('th'), { key: 'custom-1', name: 'Night shift' })).toBe('Night shift')
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

  it('labels enums and translates nested message params', () => {
    expect(enumLabel(translator('th'), 'bookingStatus', 'checked_in')).toBe('เช็กอินแล้ว')
    expect(enumLabel(translator('en'), 'bookingStatus', 'mystery')).toBe('mystery')
    expect(
      translator('th')('errors.domain.bookingStatusChange', {
        from: { key: 'errors.domain.word.bookingStatus.completed' },
        to: { key: 'errors.domain.word.bookingStatus.pending' },
      }),
    ).toBe('ไม่สามารถเปลี่ยนการจองจาก “เสร็จสิ้น” เป็น “รอยืนยัน” ได้')
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
    expect(f.weekdayDate(at)).toBe('พฤ. 8 ต.ค.')
    expect(f.dateTime(at)).toBe('8 ต.ค. 14:05')
    expect(f.monthShort(at)).toBe('ต.ค.')
  })
  it('builds every string itself (same output in Node and browsers, whatever their ICU data)', () => {
    const f = createFormat('en')
    expect(f.weekdayDate(at)).toBe('Thu 8 Oct')
    expect(f.dateShort('2026-09-30T21:00:00Z')).toBe('1 Oct') // Dubai is UTC+4
    expect(f.date('2026-09-15T08:00:00Z')).toBe('15 Sep 2026') // not ICU's "Sept"
    expect(f.monthShort(at)).toBe('Oct')
    expect(f.monthYear(at)).toBe('October 2026')
    expect(f.time('2026-10-07T20:00:00Z')).toBe('00:00')
    expect(f.dateTime('2026-10-07T20:30:00Z')).toBe('8 Oct, 00:30')
    expect(f.number(12345.5)).toBe('12,345.5')
    expect(f.aed(-50)).toBe('-AED\u00a050')
    expect(f.aed(0.1)).toBe('AED\u00a00.10')
    expect(f.aed(-0.001)).toBe('AED\u00a00')
  })
})
