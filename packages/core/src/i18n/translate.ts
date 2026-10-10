// Tiny in-house translator: dotted keys, `{param}` placeholders, plurals via Intl.PluralRules. No catalogue imports
// here, so client bundles only carry the messages they are handed.
import type { AnyLocale, Leaf, Locale, MessageKey, Params } from './types'

type Tree = { readonly [key: string]: unknown }

const CATEGORIES = new Set(['zero', 'one', 'two', 'few', 'many', 'other'])
/** Strings, and plural objects (`other` + only plural-category keys — an enum group with an `other` value isn't one). */
export const isLeaf = (node: unknown): node is Leaf =>
  typeof node === 'string' ||
  (typeof node === 'object' &&
    node !== null &&
    'other' in node &&
    Object.keys(node).every((k) => CATEGORIES.has(k)))

export function lookup(messages: Tree, key: string): Leaf | undefined {
  let node: unknown = messages
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined
    node = (node as Tree)[part]
  }
  return isLeaf(node) ? node : undefined
}

const plurals = new Map<AnyLocale, Intl.PluralRules>()
const pluralRules = (locale: AnyLocale) => {
  let rules = plurals.get(locale)
  if (!rules) {
    rules = new Intl.PluralRules(locale)
    plurals.set(locale, rules)
  }
  return rules
}

export function render(locale: AnyLocale, leaf: Leaf, params?: Record<string, string | number>) {
  const text =
    typeof leaf === 'string'
      ? leaf
      : (leaf[pluralRules(locale).select(Number(params?.count ?? 0)) as keyof typeof leaf] ?? leaf.other)
  if (!params) return text
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match))
}

/** Spa dashboard by default (`MessageKey`, EN/TH); the console uses `Translator<ConsoleKey, ConsoleLocale>`. */
export type Translator<K extends string = MessageKey, L extends AnyLocale = Locale> = {
  (key: K, params?: Params<K>): string
  locale: L
  /** True when `key` names a message (used for keys that arrive as plain strings, e.g. from action results). */
  has: (key: string) => key is K
  /** Translates a runtime string key, or returns undefined when it isn't one (params as they travel, untyped). */
  maybe: (key: string | undefined | null, params?: Params<string>) => string | undefined
}

/** `messages` = the locale's catalogue; `fallback` (usually EN) covers keys a partial catalogue lacks. */
export function createTranslator<K extends string = MessageKey, L extends AnyLocale = Locale>(
  locale: L,
  messages: Tree,
  fallback?: Tree,
): Translator<K, L> {
  const find = (key: string) => lookup(messages, key) ?? (fallback ? lookup(fallback, key) : undefined)
  // Nested `{ key }` params (e.g. a status word inside a sentence) are translated first.
  const flat = (params?: Params<string>) =>
    params &&
    Object.fromEntries(
      Object.entries(params).map(([name, v]) => [
        name,
        typeof v === 'object' ? t(v.key as K, v.params as Params<K>) : v,
      ]),
    )
  const t = ((key: K, params?: Params<K>) => {
    const leaf = find(key)
    return leaf === undefined ? key : render(locale, leaf, flat(params))
  }) as Translator<K, L>
  t.locale = locale
  t.has = (key: string): key is K => find(key) !== undefined
  t.maybe = (key, params) => {
    if (!key) return undefined
    const leaf = find(key)
    return leaf === undefined ? undefined : render(locale, leaf, flat(params))
  }
  return t
}
