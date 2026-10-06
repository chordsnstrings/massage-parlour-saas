'use client'
import { Loader2, Plus, ScanLine, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { Checkbox, Input, Label, Select } from '@/components/ui/input'
import { Sheet } from '@/components/ui/sheet'
import { toast } from '@/components/ui/toast'
import type { ActionResult } from '@/lib/action'
import { cn } from '@/lib/utils'
import { ReceiptThumb } from './receipt-thumb'

type Fields = {
  vendor: string | null
  date: string | null
  totalAed: number | null
  vatAed: number | null
  trn: string | null
  currency: string | null
  category: string | null
}
type Scan = {
  file: { id: string; url: string; name: string; contentType: string }
  status: string
  message: string
  fields?: Fields
  ocr?: Record<string, unknown>
}

const PAID_VIA = { cash: 'Cash', bank: 'Bank transfer', card: 'Card', owner: 'Paid by owner' } as const

/** "Add expense" sheet with "Scan receipt": photo → private file → vision model → prefilled fields. */
export function ExpenseSheet({
  action,
  scanUrl,
  categories,
  today,
  aiReady,
}: {
  action: (prev: ActionResult, fd: FormData) => Promise<ActionResult>
  scanUrl: string
  categories: { code: string; name: string }[]
  today: string
  aiReady: boolean
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [scan, setScan] = useState<Scan | null>(null)
  // Bumped when a scan returns fields so the inputs remount with the read values as defaults.
  const [version, setVersion] = useState(0)
  const picker = useRef<HTMLInputElement>(null)
  const f = scan?.fields

  async function upload(file: File) {
    if (file.size > 8 * 1024 * 1024) {
      toast.error('Files can be up to 8 MB.')
      return
    }
    setBusy(true)
    try {
      const body = new FormData()
      body.set('file', file)
      const res = await fetch(scanUrl, { method: 'POST', body })
      const data = (await res.json().catch(() => null)) as (Scan & { ok?: boolean; error?: string }) | null
      if (!res.ok || !data?.file) {
        toast.error(data?.error ?? 'Upload failed — please try again.')
        return
      }
      setScan(data)
      if (data.fields) setVersion((v) => v + 1)
    } catch {
      toast.error('Upload failed — check your connection.')
    } finally {
      setBusy(false)
      if (picker.current) picker.current.value = ''
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setScan(null)
      }}
      title="Record an expense"
      description="Enter the total you paid. Tick VAT if the invoice shows 5% VAT you can recover."
      trigger={
        <Button>
          <Plus /> Add expense
        </Button>
      }
    >
      <ActionForm
        action={action}
        onSuccess={() => {
          setOpen(false)
          setScan(null)
        }}
        className="space-y-5"
      >
        <div
          className={cn(
            'rounded-xl border border-dashed p-4 transition-colors',
            scan ? 'border-accent/40 bg-accent-soft/40' : 'bg-subtle/40',
          )}
        >
          <input
            ref={picker}
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            className="sr-only"
            tabIndex={-1}
            aria-label="Receipt photo"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void upload(file)
            }}
          />
          <input type="hidden" name="receiptFileId" value={scan?.file.id ?? ''} />
          <input type="hidden" name="ocr" value={scan?.ocr ? JSON.stringify(scan.ocr) : ''} />
          <div className="flex items-center gap-3">
            {scan ? (
              <ReceiptThumb url={scan.file.url} />
            ) : (
              <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-surface text-accent">
                {busy ? <Loader2 className="size-4 animate-spin" /> : <ScanLine className="size-4" />}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {busy ? 'Reading receipt…' : scan ? scan.file.name : 'Have the receipt?'}
              </p>
              <p className="text-[13px] text-muted">
                {scan
                  ? 'Attached to this expense'
                  : aiReady
                    ? 'Snap or upload it — we fill in the details.'
                    : 'Attach a photo or PDF to keep it with the expense.'}
              </p>
            </div>
            {scan ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Remove receipt"
                className="shrink-0"
                onClick={() => setScan(null)}
              >
                <X />
              </Button>
            ) : (
              <Button
                type="button"
                variant="secondary"
                className="min-h-11 shrink-0 sm:min-h-10"
                pending={busy}
                onClick={() => picker.current?.click()}
              >
                <ScanLine /> Scan receipt
              </Button>
            )}
          </div>
          <AnimatePresence initial={false}>
            {scan && (
              <motion.p
                key={scan.message}
                role="status"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className={cn(
                  'text-[13px]',
                  scan.status === 'read'
                    ? 'text-success'
                    : scan.status === 'currency'
                      ? 'text-warning'
                      : 'text-muted',
                )}
              >
                <span className="block pt-3">
                  {scan.message}
                  {f?.trn ? ` TRN ${f.trn}.` : ''}
                </span>
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        <div key={version} className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Date" name="expenseDate">
              <Input id="expenseDate" name="expenseDate" type="date" defaultValue={f?.date ?? today} />
            </Field>
            <Field label="Amount paid (AED)" name="amountAed">
              <Input
                id="amountAed"
                name="amountAed"
                inputMode="decimal"
                placeholder="0.00"
                defaultValue={f?.totalAed != null ? f.totalAed.toFixed(2) : undefined}
              />
            </Field>
          </div>
          <Field label="Category" name="accountCode">
            <Select id="accountCode" name="accountCode" defaultValue={f?.category ?? ''}>
              <option value="" disabled>
                Choose…
              </option>
              {categories.map((a) => (
                <option key={a.code} value={a.code}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Supplier" name="vendor">
            <Input id="vendor" name="vendor" placeholder="e.g. DEWA" defaultValue={f?.vendor ?? undefined} />
          </Field>
          <Field label="Note" name="description">
            <Input id="description" name="description" placeholder="Optional" />
          </Field>
          <Field label="Paid with" name="paidVia">
            <Select id="paidVia" name="paidVia" defaultValue="cash">
              {Object.entries(PAID_VIA).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Label className="flex items-center gap-2.5 text-sm font-normal">
            <Checkbox name="hasVat" defaultChecked={f ? (f.vatAed ?? 0) > 0 : true} /> Includes 5% VAT (on a
            tax invoice)
          </Label>
        </div>
        <SubmitButton className="w-full sm:w-auto">Record expense</SubmitButton>
      </ActionForm>
    </Sheet>
  )
}
