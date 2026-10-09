'use client'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { Checkbox, Input, Textarea } from '@/components/ui/input'
import { useT } from '@/i18n/client'
import { saveBillingAction } from '../../actions'

export function BillingForm({
  slug,
  saleId,
  initial,
  canSaveToClient,
}: {
  slug: string
  saleId: string
  initial: { name: string; address: string; trn: string }
  canSaveToClient: boolean
}) {
  const t = useT()
  return (
    <ActionForm action={saveBillingAction.bind(null, slug, saleId)} className="space-y-4">
      <Field label={t('sales.invoice.name')} name="name">
        <Input
          id="name"
          name="name"
          defaultValue={initial.name}
          placeholder={t('sales.invoice.namePlaceholder')}
          required
        />
      </Field>
      <Field label={t('sales.invoice.address')} name="address">
        <Textarea id="address" name="address" rows={2} defaultValue={initial.address} />
      </Field>
      <Field label={t('sales.invoice.trn')} name="trn" hint={t('sales.invoice.trnHint')}>
        <Input id="trn" name="trn" inputMode="numeric" defaultValue={initial.trn} />
      </Field>
      {canSaveToClient && (
        <label className="flex items-center gap-2 text-sm">
          <Checkbox name="saveToClient" defaultChecked />
          {t('sales.invoice.saveToClient')}
        </label>
      )}
      <SubmitButton className="w-full">{t('sales.invoice.save')}</SubmitButton>
    </ActionForm>
  )
}
