// Spa-dashboard i18n (EN + TH). Server code imports from here; client code imports the narrower subpaths
// (`@spa/core/i18n/translate`, `/format`, `/types`, `/en-ui`) so it never bundles both catalogues.
import { en } from './en'
import { th } from './th'
import { createTranslator } from './translate'
import type { Locale, Messages } from './types'

export { en } from './en'
export * from './format'
export * from './labels'
export { th } from './th'
export * from './translate'
export * from './types'

const catalogues: Record<Locale, Messages> = { en, th }

export const catalogue = (locale: Locale): Messages => catalogues[locale]

/** Translator for `locale`, falling back to English for anything missing. */
export const translator = (locale: Locale) => createTranslator(locale, catalogue(locale), en)
