'use client'
import { Check, FileUp, Loader2, Paperclip } from 'lucide-react'
import { motion } from 'motion/react'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { Input, Select, Textarea } from '@/components/ui/input'
import { Sheet } from '@/components/ui/sheet'
import { toast } from '@/components/ui/toast'
import type { ActionResult } from '@/lib/action'
import { appPath } from '@/lib/paths'
import { cn } from '@/lib/utils'

export type DocType = { key: string; label: string }
export type EditableDocument = {
  id: string
  scope: 'staff' | 'business'
  staffId: string | null
  /** The staff member's name (shown when they're no longer active). */
  owner?: string
  type: string
  typeLabel: string
  number: string | null
  issuedOn: string | null
  expiresOn: string | null
  notes: string | null
  fileUrl: string | null
}

type Uploaded = { id: string; url: string; name: string }

/** Uploads a scan as soon as it's picked (private, ≤ 8 MB) and hands its id to the form. */
export function ScanPicker({
  uploadUrl,
  current,
  onUploaded,
  label = 'Upload scan or photo',
}: {
  uploadUrl: string
  current?: string | null
  onUploaded?: (file: Uploaded) => void
  label?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [file, setFile] = useState<Uploaded | null>(null)
  const [removed, setRemoved] = useState(false)

  async function upload(f: File) {
    if (f.size > 8 * 1024 * 1024) {
      toast.error('Files can be up to 8 MB.')
      return
    }
    setBusy(true)
    try {
      const body = new FormData()
      body.set('file', f)
      const res = await fetch(uploadUrl, { method: 'POST', body })
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean
        error?: string
        file?: Uploaded
      } | null
      if (!res.ok || !data?.file) {
        toast.error(data?.error ?? 'Upload failed — please try again.')
        return
      }
      setFile(data.file)
      onUploaded?.(data.file)
    } catch {
      toast.error('Upload failed — check your connection.')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <div className="space-y-2">
      <input type="hidden" name="fileId" value={file?.id ?? ''} />
      {/* Hidden, so the choice is submitted even after the "Current file" row is replaced by the undo note. */}
      <input type="hidden" name="removeFile" value={current && removed && !file ? 'on' : ''} />
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        className="sr-only"
        tabIndex={-1}
        aria-label={label}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void upload(f)
        }}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          className="min-h-11 sm:min-h-10"
          pending={busy}
          onClick={() => input.current?.click()}
        >
          <FileUp /> {file || (current && !removed) ? 'Replace file' : label}
        </Button>
        {file ? (
          <motion.span
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex min-w-0 items-center gap-1.5 text-sm text-success"
          >
            <Check className="size-4 shrink-0" /> <span className="truncate">{file.name}</span>
          </motion.span>
        ) : current && !removed ? (
          <span className="flex items-center gap-3 text-sm">
            <a
              href={current}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-accent underline-offset-4 hover:underline"
            >
              <Paperclip className="size-4" /> Current file
            </a>
            <button
              type="button"
              onClick={() => setRemoved(true)}
              className="min-h-8 text-muted underline-offset-4 hover:text-danger hover:underline"
            >
              Remove
            </button>
          </span>
        ) : busy ? (
          <span className="flex items-center gap-1.5 text-sm text-muted">
            <Loader2 className="size-4 animate-spin" /> Uploading…
          </span>
        ) : current && removed ? (
          <motion.span
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center gap-2 text-sm text-muted"
          >
            The file will be deleted when you save.
            <button
              type="button"
              onClick={() => setRemoved(false)}
              className="min-h-8 text-accent underline-offset-4 hover:underline"
            >
              Undo
            </button>
          </motion.span>
        ) : (
          <span className="text-[13px] text-muted">JPG, PNG, WebP or PDF · up to 8 MB</span>
        )}
      </div>
    </div>
  )
}

/** Add or edit a staff or business document. */
export function DocumentSheet({
  slug,
  action,
  staff,
  staffTypes,
  businessTypes,
  doc,
  defaultStaffId,
  trigger,
}: {
  slug: string
  action: (prev: ActionResult, fd: FormData) => Promise<ActionResult>
  staff: { id: string; name: string }[]
  staffTypes: DocType[]
  businessTypes: DocType[]
  doc?: EditableDocument
  defaultStaffId?: string
  trigger: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState<'staff' | 'business'>(
    doc?.scope ?? (staff.length ? 'staff' : 'business'),
  )
  const types = scope === 'staff' ? staffTypes : businessTypes
  const knownType = !doc || types.some((t) => t.key === doc.type)

  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={doc ? `Edit ${doc.typeLabel.toLowerCase()}` : 'Add a document'}
      description="We'll remind you 60, 30 and 7 days before it expires, and on the day."
      trigger={trigger}
    >
      <ActionForm action={action} onSuccess={() => setOpen(false)} className="space-y-5">
        {doc && <input type="hidden" name="id" value={doc.id} />}
        <input type="hidden" name="scope" value={scope} />
        {!doc && (
          <fieldset className="space-y-1.5">
            <legend className="text-[13px] font-medium">Belongs to</legend>
            <div className="grid grid-cols-2 rounded-xl border bg-surface p-1">
              {(['staff', 'business'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={scope === s}
                  onClick={() => setScope(s)}
                  className={cn(
                    'relative min-h-10 rounded-lg px-3 text-sm font-medium transition-colors',
                    scope === s ? 'text-fg' : 'text-muted hover:text-fg',
                  )}
                >
                  {scope === s && (
                    <motion.span layoutId="doc-scope" className="absolute inset-0 rounded-lg bg-subtle" />
                  )}
                  <span className="relative">{s === 'staff' ? 'A staff member' : 'The business'}</span>
                </button>
              ))}
            </div>
          </fieldset>
        )}
        {scope === 'staff' && (
          <Field label="Staff member" name="staffId">
            <Select id="staffId" name="staffId" defaultValue={doc?.staffId ?? defaultStaffId ?? ''}>
              <option value="" disabled>
                Choose…
              </option>
              {/* A document of someone no longer active keeps its owner instead of falling to the first option. */}
              {doc?.staffId && !staff.some((s) => s.id === doc.staffId) && (
                <option value={doc.staffId}>{`${doc.owner ?? 'Current owner'} (inactive)`}</option>
              )}
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Document" name="type">
            <Select id="type" name="type" key={scope} defaultValue={doc?.type ?? ''}>
              <option value="" disabled>
                Choose…
              </option>
              {!knownType && doc && <option value={doc.type}>{doc.typeLabel}</option>}
              {types.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Number" name="number">
            <Input id="number" name="number" defaultValue={doc?.number ?? ''} placeholder="Optional" />
          </Field>
          <Field label="Issue date" name="issuedOn">
            <Input id="issuedOn" name="issuedOn" type="date" defaultValue={doc?.issuedOn ?? ''} />
          </Field>
          <Field label="Expiry date" name="expiresOn">
            <Input id="expiresOn" name="expiresOn" type="date" defaultValue={doc?.expiresOn ?? ''} />
          </Field>
        </div>
        <div className="space-y-1.5">
          <p className="text-[13px] font-medium">Scan</p>
          <ScanPicker
            uploadUrl={appPath(`/${slug}/documents/upload?scope=${scope}`)}
            current={doc?.fileUrl}
          />
        </div>
        <Field label="Notes" name="notes">
          <Textarea id="notes" name="notes" defaultValue={doc?.notes ?? ''} placeholder="Optional" />
        </Field>
        <SubmitButton className="w-full sm:w-auto">{doc ? 'Save changes' : 'Add document'}</SubmitButton>
      </ActionForm>
    </Sheet>
  )
}
