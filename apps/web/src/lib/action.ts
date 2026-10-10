import { createTranslator, en, type MessageKey, type MessageRef, type Params } from '@spa/core/i18n'
import { type ConsoleKey, type ConsoleMessageRef, consoleEn } from '@spa/core/i18n/console'
import type { ZodError } from 'zod'
import { domainErrorRef } from '@/i18n/domain-errors'

/**
 * Server-action result. `message`/`error` are English (logs, tests); when the text came from the i18n catalogue,
 * `key` + `params` travel too and the client renders them in the viewer's language (`resultText`, i18n/client.tsx).
 * Field errors may be plain text or catalogue keys (Phase 2 turns zod messages into keys).
 * Keys come from the spa catalogue or, in super-admin console actions (R22), the console catalogue: their namespaces
 * never overlap except shared paths with identical English (packages/core/test/console-i18n.test.ts).
 */
export type ActionResult =
  | { ok: true; message?: string; key?: ResultKey; params?: Params<ResultKey>; data?: Record<string, unknown> }
  | {
      ok: false
      error: string
      key?: ResultKey
      params?: Params<ResultKey>
      fieldErrors?: Record<string, string>
    }
  | null

type ResultKey = MessageKey | ConsoleKey

/** Plain text, a catalogue key (`'errors.forbidden'`, console `'actions.planSaved'`) or a key with params. */
export type Msg = string | MessageRef | ConsoleMessageRef

const english = createTranslator('en', en)
const consoleEnglish = createTranslator<ConsoleKey, 'en'>('en', consoleEn)
const resolve = (m: Msg): { text: string; key?: ResultKey; params?: Params<ResultKey> } => {
  if (typeof m !== 'string') {
    const text = english.maybe(m.key, m.params) ?? consoleEnglish.maybe(m.key, m.params) ?? m.key
    return { text, key: m.key, params: m.params }
  }
  if (english.has(m)) return { text: english(m), key: m }
  return consoleEnglish.has(m) ? { text: consoleEnglish(m), key: m } : { text: m }
}
const withKey = (r: { key?: ResultKey; params?: Params<ResultKey> }) => ({
  ...(r.key ? { key: r.key } : {}),
  ...(r.params ? { params: r.params } : {}),
})

export const ok = (message?: Msg, data?: Record<string, unknown>): ActionResult => {
  const r = message === undefined ? undefined : resolve(message)
  return { ok: true, message: r?.text, ...(r ? withKey(r) : {}), data }
}
export const fail = (error: Msg, fieldErrors?: Record<string, string>): ActionResult => {
  const r = resolve(error)
  return { ok: false, error: r.text, ...withKey(r), fieldErrors }
}

/**
 * A services `DomainError` → failure in the viewer's language: its own `i18n` ref, else the `errors.domain.*` key its
 * English message maps to (i18n/domain-errors.ts). `error` stays the service's English text; unknown messages stay
 * English everywhere.
 */
export const failDomain = (
  e: { message: string; i18n?: MessageRef },
  fieldErrors?: Record<string, string>,
) => {
  const ref = e.i18n ?? domainErrorRef(e.message)
  if (!ref) return fail(e.message, fieldErrors)
  return {
    ...fail(ref, fieldErrors),
    error: e.i18n ? english(ref.key, ref.params) : e.message,
  } as ActionResult
}

export function fromZod(error: ZodError): ActionResult {
  const fieldErrors: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.join('.')
    if (key && !fieldErrors[key]) fieldErrors[key] = issue.message
  }
  return fail('errors.checkFields', fieldErrors)
}

/** FormData → plain object (checkbox groups with the same name become arrays). */
export function formObject(formData: FormData): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  for (const [key, raw] of formData.entries()) {
    if (key.startsWith('$ACTION')) continue
    const value = typeof raw === 'string' ? raw : raw.name
    const prev = out[key]
    out[key] = prev === undefined ? value : Array.isArray(prev) ? [...prev, value] : [prev, value]
  }
  return out
}
