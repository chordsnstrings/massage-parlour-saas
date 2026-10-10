// Client-safe console i18n helpers (no catalogue import): pass the `t` from getConsoleT() (server) or useConsoleT()
// (client). R22, docs/design/console-i18n.md.
import type { ConsoleLocale } from '../types'
import type { consoleEn } from './en'
import type { ConsoleTranslator } from './types'

type Status = (typeof consoleEn)['status']
export type StatusGroup = keyof Status

/** `consoleStatus(t, 'tenant', r.status)` → "active" / "نشط"; unknown values print as-is. */
export function consoleStatus<G extends StatusGroup>(
  t: ConsoleTranslator,
  group: G,
  value: (keyof Status[G] & string) | (string & {}) | null | undefined,
) {
  if (value == null || value === '') return ''
  return t.maybe(`status.${group}.${value}`) ?? String(value)
}

/** Document direction of a console language. */
export const consoleDir = (locale: ConsoleLocale): 'ltr' | 'rtl' => (locale === 'ar' ? 'rtl' : 'ltr')

/** Language switch labels: each language's own name (endonym), never translated. */
export const CONSOLE_LANGUAGE_NAMES: Record<ConsoleLocale, string> = { en: 'English', ar: 'العربية' }
