'use client'
// R32 (D11): cash expenses reception pays from the drawer during the day (Daily close). They come off expected cash.
import { Plus, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { addDrawerExpenseAction, voidDrawerExpenseAction } from '@/app/dashboard/[tenant]/sales/actions'
import { useConfirmAction } from '@/app/dashboard/[tenant]/services/services-client'
import { Button } from '@/components/ui/button'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { Input, Select } from '@/components/ui/input'
import { useT } from '@/i18n/client'

export function DrawerExpenseForm({
  slug,
  branchId,
  date,
  categories,
}: {
  slug: string
  branchId: string
  date: string
  /** [code, translated name], 6900 Other first is not assumed: `defaultCode` picks it. */
  categories: { code: string; label: string }[]
}) {
  const t = useT()
  const router = useRouter()
  return (
    <ActionForm
      action={addDrawerExpenseAction.bind(null, slug, branchId, date)}
      onSuccess={() => router.refresh()}
      resetOnSuccess
      className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1fr)_auto] sm:items-end"
    >
      <Field label={t('sales.close.expenseWhat')} name="description">
        <Input id="description" name="description" maxLength={80} autoComplete="off" />
      </Field>
      <Field label={t('sales.close.expenseCategory')} name="accountCode">
        <Select id="accountCode" name="accountCode" defaultValue="6900">
          {categories.map((c) => (
            <option key={c.code} value={c.code}>
              {c.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t('sales.close.expenseAmount')} name="amountAed">
        <Input id="amountAed" name="amountAed" inputMode="decimal" className="tabular" />
      </Field>
      <SubmitButton>
        <Plus /> {t('sales.close.addExpense')}
      </SubmitButton>
    </ActionForm>
  )
}

export function VoidDrawerExpenseButton({
  slug,
  expenseId,
  label,
}: {
  slug: string
  expenseId: string
  label: string
}) {
  const t = useT()
  const router = useRouter()
  const { pending, run } = useConfirmAction()
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      pending={pending}
      aria-label={t('sales.close.voidExpense', { what: label })}
      onClick={() =>
        run(
          t('sales.close.voidExpenseConfirm', { what: label }),
          () => voidDrawerExpenseAction(slug, expenseId),
          () => router.refresh(),
        )
      }
    >
      <Trash2 /> {t('sales.close.void')}
    </Button>
  )
}
