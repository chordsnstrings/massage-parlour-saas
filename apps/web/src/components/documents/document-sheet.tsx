'use client'
import { Check, FileUp, Loader2, Paperclip } from 'lucide-react'
import { motion } from 'motion/react'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { Input, Select, Textarea } from '@/components/ui/input'
import { Sheet } from '@/components/ui/sheet'
import { toast } from '@/components/ui/toast'
import { useT } from '@/i18n/client'
import type { ActionResult } from '@/lib/action'
import { appPath } from '@/lib/paths'
import { cn } from '@/lib/utils'

/** `label` is the English fallback; known keys are shown via `documents.type.*`. */
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
  label,
}: {
  uploadUrl: string
  current?: string | null
  onUploaded?: (file: Uploaded) => void
  label?: string
}) {
  const t = useT()
  const text = label ?? t('documents.scan.upload')
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [file, setFile] = useState<Uploaded | null>(null)
  const [removed, setRemoved] = useState(false)

  async function upload(f: File) {
    if (f.size > 8 * 1024 * 1024) {
      toast.error(t('documents.scan.tooLarge'))
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
        key?: string
        file?: Uploaded
      } | null
      if (!res.ok || !data?.file) {
        toast.error(t.maybe(data?.key) ?? data?.error ?? t('errors.file.uploadFailed'))
        return
      }
      setFile(data.file)
      onUploaded?.(data.file)
    } catch {
      toast.error(t('documents.scan.offline'))
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
        aria-label={text}
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
          <FileUp /> {file || (current && !removed) ? t('documents.scan.replace') : text}
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
              <Paperclip className="size-4" /> {t('documents.scan.current')}
            </a>
            <button
              type="button"
              onClick={() => setRemoved(true)}
              className="min-h-8 text-muted underline-offset-4 hover:text-danger hover:underline"
            >
              {t('common.remove')}
            </button>
          </span>
        ) : busy ? (
          <span className="flex items-center gap-1.5 text-sm text-muted">
            <Loader2 className="size-4 animate-spin" /> {t('documents.scan.uploading')}
          </span>
        ) : current && removed ? (
          <motion.span
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center gap-2 text-sm text-muted"
          >
            {t('documents.scan.willDelete')}
            <button
              type="button"
              onClick={() => setRemoved(false)}
              className="min-h-8 text-accent underline-offset-4 hover:underline"
            >
              {t('documents.scan.undo')}
            </button>
          </motion.span>
        ) : (
          <span className="text-[13px] text-muted">{t('documents.scan.hint')}</span>
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
  const t = useT()
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState<'staff' | 'business'>(
    doc?.scope ?? (staff.length ? 'staff' : 'business'),
  )
  const types = scope === 'staff' ? staffTypes : businessTypes
  const knownType = !doc || types.some((dt) => dt.key === doc.type)

  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={
        doc
          ? t('documents.sheet.editTitle', {
              type: t.locale === 'en' ? doc.typeLabel.toLowerCase() : doc.typeLabel,
            })
          : t('documents.sheet.addTitle')
      }
      description={t('documents.sheet.description')}
      trigger={trigger}
    >
      <ActionForm action={action} onSuccess={() => setOpen(false)} className="space-y-5">
        {doc && <input type="hidden" name="id" value={doc.id} />}
        <input type="hidden" name="scope" value={scope} />
        {!doc && (
          <fieldset className="space-y-1.5">
            <legend className="text-[13px] font-medium">{t('documents.sheet.belongsTo')}</legend>
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
                  <span className="relative">
                    {s === 'staff' ? t('documents.sheet.staffOption') : t('documents.sheet.businessOption')}
                  </span>
                </button>
              ))}
            </div>
          </fieldset>
        )}
        {scope === 'staff' && (
          <Field label={t('documents.sheet.staffMember')} name="staffId">
            <Select id="staffId" name="staffId" defaultValue={doc?.staffId ?? defaultStaffId ?? ''}>
              <option value="" disabled>
                Choose…
              </option>
              {/* A document of someone no longer active keeps its owner instead of falling to the first option. */}
              {doc?.staffId && !staff.some((s) => s.id === doc.staffId) && (
                <option value={doc.staffId}>
                  {t('documents.filter.inactive', { name: doc.owner ?? t('documents.sheet.currentOwner') })}
                </option>
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
          <Field label={t('documents.sheet.document')} name="type">
            <Select id="type" name="type" key={scope} defaultValue={doc?.type ?? ''}>
              <option value="" disabled>
                Choose…
              </option>
              {!knownType && doc && <option value={doc.type}>{doc.typeLabel}</option>}
              {types.map((dt) => (
                <option key={dt.key} value={dt.key}>
                  {t.maybe(`documents.type.${dt.key}`) ?? dt.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('documents.sheet.number')} name="number">
            <Input
              id="number"
              name="number"
              defaultValue={doc?.number ?? ''}
              placeholder={t('common.optional')}
            />
          </Field>
          <Field label={t('documents.sheet.issued')} name="issuedOn">
            <Input id="issuedOn" name="issuedOn" type="date" defaultValue={doc?.issuedOn ?? ''} />
          </Field>
          <Field label={t('documents.sheet.expiry')} name="expiresOn">
            <Input id="expiresOn" name="expiresOn" type="date" defaultValue={doc?.expiresOn ?? ''} />
          </Field>
        </div>
        <div className="space-y-1.5">
          <p className="text-[13px] font-medium">{t('documents.sheet.scan')}</p>
          <ScanPicker
            uploadUrl={appPath(`/${slug}/documents/upload?scope=${scope}`)}
            current={doc?.fileUrl}
          />
        </div>
        <Field label={t('documents.sheet.notes')} name="notes">
          <Textarea
            id="notes"
            name="notes"
            defaultValue={doc?.notes ?? ''}
            placeholder={t('common.optional')}
          />
        </Field>
        <SubmitButton className="w-full sm:w-auto">
          {doc ? t('documents.sheet.save') : t('documents.add')}
        </SubmitButton>
      </ActionForm>
    </Sheet>
  )
}
