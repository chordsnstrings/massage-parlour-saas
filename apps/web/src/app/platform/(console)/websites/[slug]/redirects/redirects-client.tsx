'use client'
// R33 Redirects (console, English): the "Add redirect" and "Import list" sheets, Delete and Clear all.
import { ArrowRight, FileUp, Plus, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useConfirmAction } from '@/app/dashboard/[tenant]/services/services-client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { FormSheet } from '@/components/ui/form-sheet'
import { Input, Select, Textarea } from '@/components/ui/input'
import { Sheet } from '@/components/ui/sheet'
import {
  addRedirectAction,
  clearRedirectsAction,
  deleteRedirectAction,
  importRedirectsAction,
  type RedirectPreview,
} from '../redirect-actions'

/** A new-address choice: the site's live pages, online booking. */
export type RedirectTarget = { value: string; label: string }

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** The new address: a page from the list, or "Other path…" with a typed path. */
function TargetField({
  targets,
  label,
  hint,
  onChange,
}: {
  targets: RedirectTarget[]
  label: string
  hint?: string
  onChange?: () => void
}) {
  const [picked, setPicked] = useState(targets[0]?.value ?? 'other')
  return (
    <>
      <Field label={label} name="target" hint={hint}>
        <Select
          id="target"
          name="target"
          value={picked}
          onChange={(e) => {
            setPicked(e.target.value)
            onChange?.()
          }}
        >
          {targets.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
          <option value="other">Other path…</option>
        </Select>
      </Field>
      {picked === 'other' && (
        <Field label="Path on this site" name="toOther" hint="For example /services or /services?lang=ar">
          <Input id="toOther" name="toOther" placeholder="/services" autoComplete="off" onChange={onChange} />
        </Field>
      )}
    </>
  )
}

export function AddRedirectSheet({ slug, targets }: { slug: string; targets: RedirectTarget[] }) {
  return (
    <FormSheet
      title="Add redirect"
      description="An address of the old website → a page of this site. Live at once, on every address of the spa."
      trigger={
        <Button size="sm" className="h-10">
          <Plus /> Add redirect
        </Button>
      }
      action={addRedirectAction.bind(null, slug)}
      submitLabel="Add redirect"
    >
      <Field label="Old address" name="from" hint="A path like /old-page, or the full old URL.">
        <Input id="from" name="from" placeholder="/old-page" autoComplete="off" />
      </Field>
      <TargetField targets={targets} label="New address" />
    </FormSheet>
  )
}

function PreviewList({ preview }: { preview: RedirectPreview }) {
  return (
    <div className="space-y-3 rounded-lg border bg-subtle/40 p-3" data-testid="redirect-preview">
      <p className="text-sm font-medium">{preview.summary}</p>
      {preview.rows.length > 0 && (
        <ul className="max-h-56 space-y-1 overflow-y-auto text-[13px]">
          {preview.rows.map((r) => (
            <li key={r.from} className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 truncate">{r.from}</span>
              <ArrowRight className="size-3.5 shrink-0 text-muted" />
              <span className="min-w-0 truncate text-muted">{r.to}</span>
              {r.status !== 'new' && (
                <Badge className="ms-auto">{r.status === 'updated' ? 'Updated' : 'Already there'}</Badge>
              )}
            </li>
          ))}
        </ul>
      )}
      {preview.errors.length > 0 && (
        <ul className="max-h-40 space-y-1 overflow-y-auto text-[13px]" data-testid="redirect-errors">
          {preview.errors.map((e) => (
            <li key={`${e.line}:${e.text}`} className="text-danger">
              {e.line ? `Line ${e.line}: ` : ''}
              {e.error} <span className="break-all text-muted">{e.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Paste → Preview (a dry run: parsed rows + every line's problem) → "Add N redirects". */
export function ImportRedirectsSheet({ slug, targets }: { slug: string; targets: RedirectTarget[] }) {
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState<RedirectPreview | null>(null)
  const stale = () => setPreview(null)
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setPreview(null)
      }}
      title="Import list"
      description="Old addresses → pages of this site, live at once once added."
      className="md:max-w-2xl"
      trigger={
        <Button variant="secondary" size="sm" className="h-10">
          <FileUp /> Import list
        </Button>
      }
    >
      <ActionForm
        action={importRedirectsAction.bind(null, slug)}
        onSuccess={(r) => {
          const next = r.data?.preview as RedirectPreview | undefined
          if (next) setPreview(next)
          else {
            setOpen(false)
            setPreview(null)
          }
        }}
        className="space-y-5"
      >
        <Field
          label="Old addresses"
          name="lines"
          hint="Paste the Search Console 404 list, one URL per line, or “old new” pairs (one pair per line). Up to 500 lines."
        >
          <Textarea
            id="lines"
            name="lines"
            rows={8}
            onChange={stale}
            spellCheck={false}
            placeholder={'https://theirspa.ae/old-page\n/old-offers /offers'}
            className="font-mono text-[13px]"
          />
        </Field>
        <TargetField
          targets={targets}
          label="New address for lines with only an old address"
          onChange={stale}
        />
        {preview && <PreviewList preview={preview} />}
        <div className="flex flex-wrap gap-2">
          <SubmitButton name="intent" value="preview" variant={preview ? 'secondary' : 'primary'}>
            Preview
          </SubmitButton>
          {preview && preview.changes > 0 && (
            <SubmitButton name="intent" value="add">
              Add {plural(preview.changes, 'redirect', 'redirects')}
            </SubmitButton>
          )}
        </div>
      </ActionForm>
    </Sheet>
  )
}

export function DeleteRedirectButton({ slug, id, from }: { slug: string; id: string; from: string }) {
  const router = useRouter()
  const { pending, run } = useConfirmAction()
  return (
    <Button
      variant="ghost"
      size="sm"
      pending={pending}
      aria-label={`Delete redirect ${from}`}
      onClick={() =>
        run(
          `Delete the redirect for ${from}?`,
          () => deleteRedirectAction(slug, id),
          () => router.refresh(),
        )
      }
    >
      <Trash2 /> Delete
    </Button>
  )
}

export function ClearRedirectsButton({ slug, count }: { slug: string; count: number }) {
  const router = useRouter()
  const { pending, run } = useConfirmAction()
  return (
    <Button
      variant="danger"
      size="sm"
      className="h-10"
      pending={pending}
      onClick={() =>
        run(
          `Delete all ${plural(count, 'redirect', 'redirects')}? Their old addresses show the 404 page again.`,
          () => clearRedirectsAction(slug),
          () => router.refresh(),
        )
      }
    >
      <Trash2 /> Clear all
    </Button>
  )
}
