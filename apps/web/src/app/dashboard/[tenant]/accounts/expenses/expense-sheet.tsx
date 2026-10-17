'use client'
import { enumLabel } from '@spa/core/i18n'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { Checkbox, Input, Label, Select } from '@/components/ui/input'
import { Sheet } from '@/components/ui/sheet'
import { useT } from '@/i18n/client'
import type { ActionResult } from '@/lib/action'
import { ReceiptScanBox, useReceiptScan } from './receipt-scan'

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
  const receipt = useReceiptScan(scanUrl)
  const { scan, setScan, version } = receipt
  const f = scan?.fields

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
        <ReceiptScanBox state={receipt} aiReady={aiReady} />
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
