import { platformDb, platformSettings } from '@spa/db'
import { eq } from 'drizzle-orm'
import type { Metadata } from 'next'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { Checkbox, Input, Textarea } from '@/components/ui/input'
import { PageBody, PageHeader } from '@/components/ui/page'
import { saveCompanyAction } from '../actions'

export const metadata: Metadata = { title: 'Company' }

export default async function CompanyPage() {
  const s = await platformDb().query.platformSettings.findFirst({ where: eq(platformSettings.id, 1) })
  const v = (k: keyof NonNullable<typeof s>) => (s?.[k] as string | null | undefined) ?? ''
  const text = (name: keyof NonNullable<typeof s>, label: string, hint?: string, cls?: string) => (
    <Field label={label} name={name} hint={hint} className={cls}>
      <Input id={name} name={name} defaultValue={v(name)} />
    </Field>
  )
  return (
    <>
      <PageHeader
        title="Company"
        description="Your operating company — shown on invoices, the billing page and in Meta/Google applications."
      />
      <PageBody>
        <ActionForm action={saveCompanyAction} className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader title="Company" />
            <CardBody className="grid gap-5 sm:grid-cols-2">
              {text('companyName', 'Brand name', undefined, 'sm:col-span-2')}
              {text('legalName', 'Legal name')}
              {text('tradeLicence', 'Trade licence no.')}
              {text('trn', 'TRN', '15-digit VAT number')}
              {text('website', 'Website')}
              <Field label="Address" name="address" className="sm:col-span-2">
                <Textarea id="address" name="address" defaultValue={v('address')} />
              </Field>
            </CardBody>
          </Card>
          <div className="space-y-6">
            <Card>
              <CardHeader title="Contact" />
              <CardBody className="grid gap-5 sm:grid-cols-3">
                {text('email', 'Email')}
                {text('phone', 'Phone')}
                {text('whatsapp', 'WhatsApp', 'Shown to spas for billing questions')}
              </CardBody>
            </Card>
            <Card>
              <CardHeader
                title="Bank & invoicing"
                description="Spas see these details on their subscription page."
              />
              <CardBody className="grid gap-5 sm:grid-cols-2">
                {text('bankName', 'Bank')}
                {text('bankAccountName', 'Account name')}
                {text('iban', 'IBAN')}
                {text('swift', 'SWIFT')}
                {text('invoicePrefix', 'Invoice prefix', 'e.g. SM → SM-2026-0001')}
                <Field label="VAT rate (%)" name="vatRate">
                  <Input id="vatRate" name="vatRate" inputMode="decimal" defaultValue={s?.vatRate ?? '5'} />
                </Field>
                <label className="flex items-center gap-2.5 text-sm sm:col-span-2">
                  <Checkbox name="pricesIncludeVat" defaultChecked={s?.pricesIncludeVat ?? false} /> Plan
                  prices already include VAT
                </label>
              </CardBody>
            </Card>
          </div>
          <div className="flex justify-end xl:col-span-2">
            <SubmitButton size="lg">Save company details</SubmitButton>
          </div>
        </ActionForm>
      </PageBody>
    </>
  )
}
