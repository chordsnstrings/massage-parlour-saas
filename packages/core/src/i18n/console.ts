// Super-admin console i18n (R22, EN + AR; docs/design/console-i18n.md). Server code imports from here; client code
// imports the narrower subpaths (`@spa/core/i18n/console/labels`, `/console/types`) and gets its catalogue from the
// console layout's provider, so it never bundles both languages.
import { consoleAr } from './console/ar'
import { consoleEn } from './console/en'
import type { ConsoleKey, ConsoleMessages, ConsoleTranslator } from './console/types'
import { createTranslator } from './translate'
import type { ConsoleLocale } from './types'

export { consoleAr } from './console/ar'
export { consoleEn } from './console/en'
export * from './console/labels'
export type * from './console/types'

export const consoleCatalogue = (locale: ConsoleLocale): ConsoleMessages =>
  locale === 'ar' ? consoleAr : consoleEn

/** Translator for `locale`, falling back to English for anything missing. */
export const consoleTranslator = (locale: ConsoleLocale): ConsoleTranslator =>
  createTranslator<ConsoleKey, ConsoleLocale>(locale, consoleCatalogue(locale), consoleEn)
