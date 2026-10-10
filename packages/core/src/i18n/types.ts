import type { en } from './en'

/** Spa-dashboard languages (docs/PLAN.md §14.6). Tenant sites keep their own EN + AR. */
export const LOCALES = ['en', 'th'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'en'
export const isLocale = (value: unknown): value is Locale => value === 'en' || value === 'th'

/** Super-admin console languages (R22, docs/design/console-i18n.md): English + Arabic (RTL), its own catalogue. */
export const CONSOLE_LOCALES = ['en', 'ar'] as const
export type ConsoleLocale = (typeof CONSOLE_LOCALES)[number]
export const isConsoleLocale = (value: unknown): value is ConsoleLocale => value === 'en' || value === 'ar'
/** Every UI language the translator and formatter handle. */
export type AnyLocale = Locale | ConsoleLocale

/** Plural message: picked with Intl.PluralRules(locale) on `params.count` (`other` is required; Thai only has it). */
export type Plural = { zero?: string; one?: string; two?: string; few?: string; many?: string; other: string }
type PluralCategory = keyof Plural
/** A plural object has `other` and only plural-category keys (so an enum group with an `other` value isn't one). */
type IsPlural<T> = T extends { other: string }
  ? Exclude<keyof T, PluralCategory> extends never
    ? true
    : false
  : false
export type Leaf = string | Plural
/** A param is a plain value, or a nested message (`{ key }`) translated in the same language before interpolation. */
export type Param<K extends string = MessageKey> = string | number | { key: K; params?: Params<K> }
export type Params<K extends string = MessageKey> = Record<string, Param<K>>

/** Catalogue shape of a source tree: strings and plurals widened, so a translation must match keys, not text. */
export type Widen<T> = T extends string
  ? string
  : IsPlural<T> extends true
    ? Plural
    : { [K in keyof T]: Widen<T[K]> }
/** Shape every catalogue must have (EN is the source of truth): a missing or extra key in TH is a type error. */
export type Messages = Widen<typeof en>

/** Dotted keys of a catalogue tree. */
export type Paths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : IsPlural<T[K]> extends true ? K : `${K}.${Paths<T[K]>}`
}[keyof T & string]
/** Dotted key of any message, e.g. `nav.calendar`, `errors.forbidden`. */
export type MessageKey = Paths<typeof en>

/** A message reference that travels across the server/client boundary (action results, DomainError). */
export type MessageRef = { key: MessageKey; params?: Params }
