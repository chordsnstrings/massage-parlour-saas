'use client'
import { enumLabel } from '@spa/core/i18n'
import { Loader2, Plus, ScanLine, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { Checkbox, Input, Label, Select } from '@/components/ui/input'
import { Sheet } from '@/components/ui/sheet'
import { toast } from '@/components/ui/toast'
import { useT } from '@/i18n/client'
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

const PAID_VIA = ['cash', 'bank', 'card', 'owner'] as const

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
  const t = useT()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [scan, setScan] = useState<Scan | null>(null)
  // Bumped when a scan returns fields so the inputs remount with the read values as defaults.
  const [version, setVersion] = useState(0)
  const picker = useRef<HTMLInputElement>(null)
  const f = scan?.fields

  async function upload(file: File) {
    if (file.size > 8 * 1024 * 1024) {
      toast.error(t('errors.file.tooLarge', { size: '8 MB' }))
      return
    }
    setBusy(true)
    try {
      const body = new FormData()
      body.set('file', file)
      const res = await fetch(scanUrl, { method: 'POST', body })
      const data = (await res.json().catch(() => null)) as (Scan & { ok?: boolean; error?: string }) | null
      if (!res.ok || !data?.file) {
        toast.error(t.maybe(data?.error) ?? data?.error ?? t('errors.file.uploadFailed'))
        return
      }
      setScan(data)
      if (data.fields) setVersion((v) => v + 1)
    } catch {
      toast.error(t('accounts.sheet.offline'))
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
      title={t('accounts.sheet.title')}
      description={t('accounts.sheet.description')}
      trigger={
        <Button>
          <Plus /> {t('accounts.sheet.trigger')}
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
            aria-label={t('accounts.sheet.receiptPhoto')}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void upload(file)
            }}
          />
          <input type="hidden" name="receiptFileId" value={scan?.file.id ?? ''} />
          <input type="hidden" name="ocr" value={scan?.ocr ? JSON.stringify(scan.ocr) : ''} />
          <div className="flex items-center gap-3">
            {scan ? (
              <ReceiptThumb url={scan.file.url} label={t('accounts.expenses.viewReceipt')} />
            ) : (
              <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-surface text-accent">
                {busy ? <Loader2 className="size-4 animate-spin" /> : <ScanLine className="size-4" />}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {busy ? t('accounts.sheet.reading') : scan ? scan.file.name : t('accounts.sheet.have')}
              </p>
              <p className="text-[13px] text-muted">
                {scan
                  ? t('accounts.sheet.attached')
                  : aiReady
                    ? t('accounts.sheet.snap')
                    : t('accounts.sheet.attach')}
              </p>
            </div>
            {scan ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t('accounts.sheet.remove')}
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
                <ScanLine /> {t('accounts.sheet.scan')}
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
                  {f?.trn ? ` ${t('accounts.sheet.trn', { trn: f.trn })}` : ''}
                </span>
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        <div key={version} className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label={t('accounts.sheet.date')} name="expenseDate">
              <Input id="expenseDate" name="expenseDate" type="date" defaultValue={f?.date ?? today} />
            </Field>
            <Field label={t('accounts.sheet.amount')} name="amountAed">
              <Input
                id="amountAed"
                name="amountAed"
                inputMode="decimal"
                placeholder="0.00"
                defaultValue={f?.totalAed != null ? f.totalAed.toFixed(2) : undefined}
              />
            </Field>
          </div>
          <Field label={t('accounts.sheet.category')} name="accountCode">
            <Select id="accountCode" name="accountCode" defaultValue={f?.category ?? ''}>
              <option value="" disabled>
                {t('accounts.sheet.choose')}
              </option>
              {categories.map((a) => (
                <option key={a.code} value={a.code}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('accounts.sheet.supplier')} name="vendor">
            <Input
              id="vendor"
              name="vendor"
              placeholder={t('accounts.sheet.supplierPh')}
              defaultValue={f?.vendor ?? undefined}
            />
          </Field>
          <Field label={t('accounts.sheet.note')} name="description">
            <Input id="description" name="description" placeholder={t('common.optional')} />
          </Field>
          <Field label={t('accounts.sheet.paidWith')} name="paidVia">
            <Select id="paidVia" name="paidVia" defaultValue="cash">
              {PAID_VIA.map((k) => (
                <option key={k} value={k}>
                  {enumLabel(t, 'expensePaidVia', k)}
                </option>
              ))}
            </Select>
          </Field>
          <Label className="flex items-center gap-2.5 text-sm font-normal">
            <Checkbox name="hasVat" defaultChecked={f ? (f.vatAed ?? 0) > 0 : true} />{' '}
            {t('accounts.sheet.hasVat')}
          </Label>
        </div>
        <SubmitButton className="w-full sm:w-auto">{t('accounts.sheet.submit')}</SubmitButton>
      </ActionForm>
    </Sheet>
  )
}
