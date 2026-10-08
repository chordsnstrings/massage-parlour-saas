// Tiny in-house translator: dotted keys, `{param}` placeholders, plurals via Intl.PluralRules. No catalogue imports
// here, so client bundles only carry the messages they are handed.
import type { Leaf, Locale, MessageKey, Params } from './types'

type Tree = { readonly [key: string]: unknown }

const isLeaf = (node: unknown): node is Leaf =>
  typeof node === 'string' || (typeof node === 'object' && node !== null && 'other' in node)

export function lookup(messages: Tree, key: string): Leaf | undefined {
  let node: unknown = messages
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined
    node = (node as Tree)[part]
  }
  return isLeaf(node) ? node : undefined
}

const plurals = new Map<Locale, Intl.PluralRules>()
const pluralRules = (locale: Locale) => {
  let rules = plurals.get(locale)
  if (!rules) {
    rules = new Intl.PluralRules(locale)
    plurals.set(locale, rules)
  }
  return rules
}

export function render(locale: Locale, leaf: Leaf, params?: Params) {
  const text =
    typeof leaf === 'string'
      ? leaf
      : (leaf[pluralRules(locale).select(Number(params?.count ?? 0)) as keyof typeof leaf] ?? leaf.other)
  if (!params) return text
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match))
}

export type Translator = {
  (key: MessageKey, params?: Params): string
  locale: Locale
  /** True when `key` names a message (used for keys that arrive as plain strings, e.g. from action results). */
  has: (key: string) => key is MessageKey
  /** Translates a runtime string key, or returns undefined when it isn't one. */
  maybe: (key: string | undefined | null, params?: Params) => string | undefined
}

/** `messages` = the locale's catalogue; `fallback` (usually EN) covers keys a partial catalogue lacks. */
export function createTranslator(locale: Locale, messages: Tree, fallback?: Tree): Translator {
  const find = (key: string) => lookup(messages, key) ?? (fallback ? lookup(fallback, key) : undefined)
  const t = ((key: MessageKey, params?: Params) => {
    const leaf = find(key)
    return leaf === undefined ? key : render(locale, leaf, params)
  }) as Translator
  t.locale = locale
  t.has = (key: string): key is MessageKey => find(key) !== undefined
  t.maybe = (key, params) => {
    if (!key) return undefined
    const leaf = find(key)
    return leaf === undefined ? undefined : render(locale, leaf, params)
  }
  return t
}
