'use client'
// R32 booking order forms shared by the calendar booking sheet and the booking page: Confirm / Fee & commission
// (fee per treatment + planned commission per therapist, prefilled) and Order details (phone line, client type, own
// client). The day lock (D6) is checked by the actions.
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  confirmBookingAction,
  saveBookingDetailsAction,
  saveBookingTermsAction,
} from '@/app/dashboard/[tenant]/calendar/actions'
import { ClientTypeField, OwnLeadField, PhoneLineField } from '@/components/calendar/order-fields'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { useT } from '@/i18n/client'

export type TermsItem = {
  id: string
  serviceName: string
  /** Prefill (AED): the stored fee/commission, else the last typed for the treatment, else the list price. */
  feeAed: number | string | null
  commissionAed: number | string | null
}

const text = (v: number | string | null | undefined) =>
  v == null || v === '' ? '' : String(Number(v)).replace(/\.0+$/, '')

/** Fee per treatment + planned commission (per therapist on it); `confirm` also confirms a pending booking. */
export function TermsForm({
  slug,
  bookingId,
  items,
  canCommission,
  confirm,
  onDone,
}: {
  slug: string
  bookingId: string
  items: TermsItem[]
  canCommission: boolean
  confirm?: boolean
  onDone?: () => void
}) {
  const t = useT()
  const router = useRouter()
  const one = items.length === 1
  const [values, setValues] = useState(() =>
    Object.fromEntries(
      items.flatMap((i) => [
        [`fee:${i.id}`, text(i.feeAed)],
        [`commission:${i.id}`, text(i.commissionAed)],
      ]),
    ),
  )
  const input = (key: string, label: string) => (
    <Field key={key} label={label} name={key}>
      <Input
        id={key}
        name={key}
        inputMode="decimal"
        value={values[key] ?? ''}
        onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
        className="tabular"
      />
    </Field>
  )
  return (
    <ActionForm
      action={(confirm ? confirmBookingAction : saveBookingTermsAction).bind(null, slug, bookingId)}
      onSuccess={() => {
        onDone?.()
        router.refresh()
      }}
      className="space-y-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {items.flatMap((i) => [
          input(
            `fee:${i.id}`,
            one ? t('calendar.fields.fee') : t('calendar.sheet.feeFor', { service: i.serviceName }),
          ),
          ...(canCommission
            ? [
                input(
                  `commission:${i.id}`,
                  one
                    ? t('calendar.fields.commission')
                    : t('calendar.sheet.commissionFor', { service: i.serviceName }),
                ),
              ]
            : []),
        ])}
      </div>
      <SubmitButton className="w-full sm:w-auto">
        {confirm ? t('calendar.sheet.confirm') : t('calendar.sheet.save')}
      </SubmitButton>
    </ActionForm>
  )
}

/** Phone line (phone bookings), client type and own client of an order. */
export function DetailsForm({
  slug,
  bookingId,
  source,
  phoneLines,
  phoneLine,
  clientType,
  ownLead,
  onDone,
}: {
  slug: string
  bookingId: string
  source: string
  phoneLines: { line: number; number: string | null }[]
  phoneLine: number | null
  clientType: string | null
  ownLead: boolean
  onDone?: () => void
}) {
  const t = useT()
  const router = useRouter()
  return (
    <ActionForm
      action={saveBookingDetailsAction.bind(null, slug, bookingId)}
      onSuccess={() => {
        onDone?.()
        router.refresh()
      }}
      className="space-y-4"
    >
      {source === 'phone' && <PhoneLineField lines={phoneLines} defaultValue={phoneLine} />}
      <ClientTypeField defaultValue={clientType} />
      <OwnLeadField defaultChecked={ownLead} />
      <SubmitButton className="w-full sm:w-auto">{t('calendar.sheet.save')}</SubmitButton>
    </ActionForm>
  )
}
