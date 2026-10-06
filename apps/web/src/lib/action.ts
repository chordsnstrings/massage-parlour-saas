import type { ZodError } from 'zod'

export type ActionResult =
  | { ok: true; message?: string; data?: Record<string, unknown> }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }
  | null

export const ok = (message?: string, data?: Record<string, unknown>): ActionResult => ({
  ok: true,
  message,
  data,
})
export const fail = (error: string, fieldErrors?: Record<string, string>): ActionResult => ({
  ok: false,
  error,
  fieldErrors,
})

export function fromZod(error: ZodError): ActionResult {
  const fieldErrors: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.join('.')
    if (key && !fieldErrors[key]) fieldErrors[key] = issue.message
  }
  return fail('Please check the highlighted fields.', fieldErrors)
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
