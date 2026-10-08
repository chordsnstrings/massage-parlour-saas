import type { en } from './en'

/** Spa-dashboard languages (docs/PLAN.md §14.6). Tenant sites keep their own EN + AR. */
export const LOCALES = ['en', 'th'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'en'
export const isLocale = (value: unknown): value is Locale => value === 'en' || value === 'th'

/** Plural message: picked with Intl.PluralRules(locale) on `params.count` (`other` is required; Thai only has it). */
export type Plural = { zero?: string; one?: string; two?: string; few?: string; many?: string; other: string }
export type Leaf = string | Plural
export type Params = Record<string, string | number>

type Widen<T> = T extends string
  ? string
  : T extends { other: string }
    ? Plural
    : { [K in keyof T]: Widen<T[K]> }
/** Shape every catalogue must have (EN is the source of truth): a missing or extra key in TH is a type error. */
export type Messages = Widen<typeof en>

type Paths<T> = {
  [K in keyof T & string]: T[K] extends string | { other: string } ? K : `${K}.${Paths<T[K]>}`
}[keyof T & string]
/** Dotted key of any message, e.g. `nav.calendar`, `errors.forbidden`. */
export type MessageKey = Paths<typeof en>

/** A message reference that travels across the server/client boundary (action results, DomainError). */
export type MessageRef = { key: MessageKey; params?: Params }
