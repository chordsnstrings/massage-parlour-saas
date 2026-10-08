// Services throw English `DomainError(message)` (packages/services stays language-free). This maps a thrown message
// back to its `errors.domain.*` key (+ params) so the client can show it in the viewer's language. The table is
// derived from the EN catalogue (packages/core/src/i18n/en/domain.ts), whose values are the services' exact texts:
// messages without placeholders match exactly; `{param}` parts become regex captures. Unknown messages → undefined
// (the caller keeps the English text). Server-only in practice (imports the EN catalogue); used by `failDomain`.
import { en } from '@spa/core/i18n/en'
import type { MessageKey, MessageRef, Param, Params } from '@spa/core/i18n/types'

type Tree = { readonly [k: string]: unknown }

// Params whose captured English word is a status: translated through the lowercase `word.*` groups.
const WORD_PARAMS: Record<string, string> = {
  from: 'bookingStatus',
  to: 'bookingStatus',
  status: 'bookingStatus',
}
const WORD_OVERRIDE: Partial<Record<string, Record<string, string>>> = {
  saleAlready: { status: 'saleStatus' },
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

type Pattern = { re: RegExp; names: string[]; id: string }
const exact = new Map<string, string>()
const patterns: Pattern[] = []

const domain = en.errors.domain as Tree
for (const [id, value] of Object.entries(domain)) {
  if (id === 'word') continue
  const forms = typeof value === 'string' ? [value] : Object.values(value as Record<string, string>)
  for (const text of forms) {
    const names = [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string)
    if (names.length === 0) exact.set(text, id)
    else
      patterns.push({
        id,
        names,
        re: new RegExp(`^${escapeRe(text).replace(/\\\{\w+\\\}/g, '(.+?)')}$`),
      })
  }
}

const wordKey = (group: string, english: string): Param | undefined => {
  const words = (domain.word as Tree)[group] as Record<string, string> | undefined
  const value = words && Object.keys(words).find((k) => words[k] === english)
  return value ? { key: `errors.domain.word.${group}.${value}` as MessageKey } : undefined
}

/** `'Booking not found'` → `{ key: 'errors.domain.bookingNotFound' }`; unknown messages → undefined. */
export function domainErrorRef(message: string): MessageRef | undefined {
  const id = exact.get(message)
  if (id) return { key: `errors.domain.${id}` as MessageKey }
  for (const p of patterns) {
    const m = p.re.exec(message)
    if (!m) continue
    const params: Params = {}
    p.names.forEach((name, i) => {
      const raw = m[i + 1] as string
      const group = WORD_OVERRIDE[p.id]?.[name] ?? WORD_PARAMS[name]
      params[name] = name === 'count' ? Number(raw) : ((group && wordKey(group, raw)) ?? raw)
    })
    return { key: `errors.domain.${p.id}` as MessageKey, params }
  }
  return undefined
}
