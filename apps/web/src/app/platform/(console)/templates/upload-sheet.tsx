'use client'
// R24: "Upload HTML" (≤ 5 MB) and "Import JSON" (≤ 11 MB: an export inlines its designs) post to the /files/templates
// route handler instead of a server action (whose request bodies are capped at 1 MB). The size is checked here first,
// so a file that is too large never leaves the browser and never ends on the generic error page.
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { FormSheet } from '@/components/ui/form-sheet'
import { Checkbox } from '@/components/ui/input'
import { toast } from '@/components/ui/toast'
import type { ActionResult } from '@/lib/action'
import { setHtmlPhoneFixesAction } from './actions'
import { htmlTooLarge, jsonTooLarge, MAX_HTML_UPLOAD_BYTES, MAX_TEMPLATE_JSON_BYTES } from './upload-limits'

/** `version` (R28 P5): a new version of an HTML template (`query`: `&id={templateId}`), waiting for its sign-off. */
type Kind = 'html' | 'json' | 'version'

const LIMIT: Record<Kind, [number, (bytes: number) => string]> = {
  html: [MAX_HTML_UPLOAD_BYTES, htmlTooLarge],
  json: [MAX_TEMPLATE_JSON_BYTES, jsonTooLarge],
  version: [MAX_HTML_UPLOAD_BYTES, htmlTooLarge],
}

/** The client-side size check (also used by the file field on choose). */
export function uploadTooLarge(kind: Kind, file: File | null | undefined): string | null {
  const [max, message] = LIMIT[kind]
  return file && file.size > max ? message(file.size) : null
}

export function TemplateUploadSheet({
  kind,
  query = '',
  ...sheet
}: Omit<React.ComponentProps<typeof FormSheet>, 'action'> & { kind: Kind; query?: string }) {
  const router = useRouter()
  const action = async (_prev: ActionResult, fd: FormData): Promise<ActionResult> => {
    const file = fd.get('file')
    const tooLarge = uploadTooLarge(kind, file instanceof File ? file : null)
    if (tooLarge) return { ok: false, error: tooLarge, fieldErrors: { file: tooLarge } }
    let res: Response
    try {
      res = await fetch(`/files/templates?kind=${kind}${query}`, { method: 'POST', body: fd })
    } catch {
      return { ok: false, error: 'Upload failed — check the connection and try again.' }
    }
    const json = res.headers.get('content-type')?.includes('application/json')
      ? ((await res.json().catch(() => null)) as ActionResult)
      : null
    if (!json || typeof json.ok !== 'boolean')
      return {
        ok: false,
        error: `Upload failed (HTTP ${res.status}). Try again${res.status === 413 ? ' with a smaller file' : ''}.`,
      }
    if (json.ok) router.refresh()
    return json
  }
  return <FormSheet {...sheet} action={action} />
}

/**
 * "Phone fixes" switch on an HTML template row (off = shown exactly like the file). `baked`: uploaded before R24 with
 * the old fixes saved into the file itself — off can't undo those, so the row says to upload the original again.
 */
export function PhoneFixesSwitch({
  id,
  name,
  on,
  baked = false,
}: {
  id: string
  name: string
  on: boolean
  baked?: boolean
}) {
  const router = useRouter()
  const [checked, setChecked] = useState(on)
  const [pending, start] = useTransition()
  return (
    <label
      className="inline-flex min-h-11 items-center gap-2 px-2 text-[13px]"
      title={
        baked
          ? 'Uploaded before 11 Oct 2026: the old phone fixes were saved into this file, so Off can’t show it exactly — upload the original file again (tick “Replace”).'
          : 'Off = shown exactly like the file (recommended). On = the platform adds a phone viewport and keeps images and wide elements inside phone screens — this changes how the design looks.'
      }
    >
      <Checkbox
        aria-label={`Phone fixes for ${name}`}
        checked={checked}
        disabled={pending}
        onChange={(e) => {
          const next = e.currentTarget.checked
          setChecked(next)
          start(async () => {
            const r = await setHtmlPhoneFixesAction(id, next)
            if (r?.ok) {
              toast.success(r.message ?? 'Saved')
              router.refresh()
            } else {
              setChecked(!next)
              toast.error(r?.error ?? 'Could not save')
            }
          })
        }}
      />
      <span className="max-lg:sr-only">Phone fixes</span>
      {baked && (
        <span className="text-[12px] text-muted" data-testid="phone-fixes-baked">
          · old upload: re-upload to show exactly
        </span>
      )}
    </label>
  )
}
