// R22: the super-admin console catalogue (EN + AR) — parity, the shared-namespace contract and the AR formatter.
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createFormat, en } from '../src/i18n'
import { consoleAr, consoleEn, consoleStatus, consoleTranslator } from '../src/i18n/console'
import * as actions from '../src/i18n/console/en/actions'
import * as aiPerformanceAudit from '../src/i18n/console/en/ai-performance-audit'
import * as applicationsEnquiriesAnnouncements from '../src/i18n/console/en/applications-enquiries-announcements'
import * as settingsPlansFlagsDomains from '../src/i18n/console/en/settings-plans-flags-domains'
import * as templatesWebsites from '../src/i18n/console/en/templates-websites'
import * as tenants from '../src/i18n/console/en/tenants'
import { ui } from '../src/i18n/en-ui'
import { isLeaf, lookup } from '../src/i18n/translate'

type Tree = { [key: string]: unknown }
const leaves = (tree: Tree, prefix = ''): [string, unknown][] =>
  Object.entries(tree).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null && !isLeaf(v)
      ? leaves(v as Tree, `${prefix}${k}.`)
      : [[`${prefix}${k}`, v]],
  )
const placeholders = (v: unknown) =>
  [...new Set(JSON.stringify(v).match(/\{\w+\}/g) ?? [])].filter((p) => p !== '{count}').sort()
const texts = (v: unknown) => (typeof v === 'string' ? [v] : Object.values(v as Record<string, string>))

/** Namespaces the console shares with the spa catalogue: same paths, same English (shared code reads them). */
const SHARED = ['ui', 'auth', 'errors', 'validation', 'common']

describe('console catalogue', () => {
  it('AR has exactly the EN keys, with the same placeholders and no empty text', () => {
    const e = new Map(leaves(consoleEn))
    const a = new Map(leaves(consoleAr))
    expect([...a.keys()].sort()).toEqual([...e.keys()].sort())
    for (const [key, value] of e) {
      expect(placeholders(a.get(key)), key).toEqual(placeholders(value))
      for (const text of [...texts(value), ...texts(a.get(key))]) expect(text.trim(), key).not.toBe('')
    }
  })

  it('every namespace file exists in both languages and is wired into the aggregators', () => {
    const dir = join(__dirname, '../src/i18n/console')
    const files = (loc: string) =>
      readdirSync(join(dir, loc))
        .map((f) => f.replace(/\.ts$/, ''))
        .sort()
    expect(files('ar')).toEqual([...files('en'), 'ui'].sort())
    // Each file's namespaces (its exports other than the domainErrors fragment) sit at the catalogue root.
    const groups = {
      actions,
      aiPerformanceAudit,
      applicationsEnquiriesAnnouncements,
      settingsPlansFlagsDomains,
      templatesWebsites,
      tenants,
    }
    for (const [file, mod] of Object.entries(groups))
      for (const [name, value] of Object.entries(mod))
        if (name !== 'domainErrors') expect((consoleEn as Tree)[name], `${file}.${name}`).toBe(value)
    expect(consoleEn.ui).toBe(ui)
  })

  it('page namespaces never reuse a spa namespace name; shared ones keep the spa English', () => {
    const spa = en as unknown as Tree
    const clash = Object.keys(consoleEn).filter((ns) => ns in spa && !SHARED.includes(ns))
    expect(clash, 'rename these console namespaces (ok()/fail() keys must be unambiguous)').toEqual([])
    for (const ns of SHARED)
      for (const [key, value] of leaves((consoleEn as Tree)[ns] as Tree, `${ns}.`)) {
        const own = lookup(spa, key)
        if (key.startsWith('errors.domain.'))
          expect(own, `${key}: copy the id and text from en/domain.ts`).toEqual(value)
        else if (own !== undefined) expect(value, `${key} differs from the spa catalogue`).toEqual(own)
      }
  })

  it('no DomainError id appears in two page-group fragments', () => {
    const ids = [
      actions,
      aiPerformanceAudit,
      applicationsEnquiriesAnnouncements,
      settingsPlansFlagsDomains,
      templatesWebsites,
      tenants,
    ].flatMap((m) => Object.keys(m.domainErrors))
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([])
  })
})

describe('console translator + Arabic formatting', () => {
  it('translates, picks Arabic plurals and falls back to English', () => {
    const ar = consoleTranslator('ar')
    expect(ar('chrome.nav.overview')).toBe('نظرة عامة')
    expect(ar('home.health.heartbeat', { count: 1 })).toBe('آخر نبضة قبل دقيقة واحدة')
    expect(ar('home.health.heartbeat', { count: 2 })).toBe('آخر نبضة قبل دقيقتين')
    expect(ar('home.health.heartbeat', { count: 5 })).toBe('آخر نبضة قبل 5 دقائق')
    expect(ar('home.health.heartbeat', { count: 12 })).toBe('آخر نبضة قبل 12 دقيقة')
    expect(consoleTranslator('en')('home.health.heartbeat', { count: 5 })).toBe('Last heartbeat 5 min ago')
    expect(ar.locale).toBe('ar')
    expect(ar.maybe('nope.missing')).toBeUndefined()
    expect(consoleStatus(ar, 'tenant', 'past_due')).toBe('متأخر السداد')
    expect(consoleStatus(consoleTranslator('en'), 'tenant', 'past_due')).toBe('past_due')
    expect(consoleStatus(ar, 'tenant', 'brand_new')).toBe('brand_new')
  })

  it('formats Arabic dates with Western digits and keeps amounts left-to-right', () => {
    const f = createFormat('ar')
    const d = new Date('2026-10-08T10:05:00Z')
    expect(f.date(d)).toBe('8 أكتوبر 2026')
    expect(f.weekdayDate(d)).toBe('الخميس 8 أكتوبر')
    expect(f.dateTime(d)).toBe('8 أكتوبر، 14:05')
    expect(f.number(1234567)).toBe('1,234,567')
    expect(f.aed(-1250)).toBe('⁦-AED 1,250⁩')
    expect(createFormat('en').aed(-1250)).toBe('-AED 1,250')
  })
})
