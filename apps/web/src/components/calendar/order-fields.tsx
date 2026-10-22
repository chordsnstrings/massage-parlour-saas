'use client'
// R32 booking order fields shared by New booking and Walk-in: phone line (P1–P4), client type, own client, and the
// fee + therapist commission (prefilled from the last amounts typed for the treatment, until reception edits them).
import { useState } from 'react'
import { Seg, Toggle } from '@/components/crm'
import { Field, FieldError } from '@/components/ui/form'
import { Input, Label } from '@/components/ui/input'
import { useT } from '@/i18n/client'
import type { CalendarData, CalVariant } from './types'

const PHONE_LINES = [1, 2, 3, 4] as const
const amountText = (v: number | string | null | undefined) =>
  v == null || v === '' ? '' : String(Number(v)).replace(/\.0+$/, '')

/** "Phone line" P1–P4 (number shown when set in Settings); submits `phoneLine`. */
export function PhoneLineField({
  lines,
  defaultValue,
}: {
  lines: CalendarData['phoneLines']
  defaultValue?: number | null
}) {
  const t = useT()
  const [value, setValue] = useState(defaultValue ? String(defaultValue) : '')
  // With numbers the four lines are long ("P4 · 050 444 4444"): a 2 × 2 grid so none is cut off on a phone.
  const withNumbers = lines.some((l) => l.number)
  return (
    <div className="space-y-1.5">
      <Label className="block">{t('calendar.fields.phoneLine')}</Label>
      <Seg
        label={t('calendar.fields.phoneLine')}
        value={value}
        onChange={setValue}
        className={withNumbers ? 'grid grid-cols-2' : 'grid grid-cols-4'}
        items={PHONE_LINES.map((n) => {
          const number = lines.find((l) => l.line === n)?.number
          return {
            value: String(n),
            label: number ? t('calendar.fields.phoneLineOption', { n, number }) : `P${n}`,
          }
        })}
      />
      <input type="hidden" name="phoneLine" value={value} />
      <FieldError name="phoneLine" />
    </div>
  )
}

/** "Client" Regular / New / Not set (picked by reception, never automatic); submits `clientType`. */
export function ClientTypeField({ defaultValue }: { defaultValue?: string | null }) {
  const t = useT()
  const [value, setValue] = useState(defaultValue ?? '')
  return (
    <div className="space-y-1.5">
      <Label className="block">{t('calendar.fields.clientType')}</Label>
      <Seg
        label={t('calendar.fields.clientType')}
        value={value}
        onChange={setValue}
        items={[
          { value: 'regular', label: t('enums.bookingClientType.regular') },
          { value: 'new', label: t('enums.bookingClientType.new') },
          { value: '', label: t('calendar.fields.clientTypeNone') },
        ]}
      />
      <input type="hidden" name="clientType" value={value} />
    </div>
  )
}

/** "Therapist's own client" switch; submits `ownLead=on|off`. */
export function OwnLeadField({ defaultChecked }: { defaultChecked?: boolean }) {
  const t = useT()
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{t('calendar.fields.ownLead')}</p>
        <p className="text-[13px] text-muted">{t('calendar.fields.ownLeadHint')}</p>
        <FieldError name="ownLead" />
      </div>
      <Toggle label={t('calendar.fields.ownLead')} name="ownLead" defaultChecked={defaultChecked} />
    </div>
  )
}

/**
 * "Fee (AED)" + "Commission (AED)" for one treatment, prefilled from the last amounts typed for it (else the list
 * price) and refilled when the treatment changes until the user edits them. Submits `feeAed` / `commissionAed`.
 */
export function TermsFields({
  variant,
  canCommission,
}: {
  variant: CalVariant | undefined
  canCommission: boolean
}) {
  const t = useT()
  const feeFor = (v?: CalVariant) => amountText(v?.lastFeeAed ?? v?.priceAed)
  const commissionFor = (v?: CalVariant) => amountText(v?.lastCommissionAed)
  const [fee, setFee] = useState(() => feeFor(variant))
  const [commission, setCommission] = useState(() => commissionFor(variant))
  const [edited, setEdited] = useState({ fee: false, commission: false })
  // Another treatment picked: refill what the user has not typed (state adjusted while rendering, no effect).
  const [shownFor, setShownFor] = useState(variant?.id)
  if (shownFor !== variant?.id) {
    setShownFor(variant?.id)
    if (!edited.fee) setFee(feeFor(variant))
    if (!edited.commission) setCommission(commissionFor(variant))
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={t('calendar.fields.fee')} name="feeAed">
        <Input
          id="feeAed"
          name="feeAed"
          inputMode="decimal"
          value={fee}
          onChange={(e) => {
            setFee(e.target.value)
            setEdited((x) => ({ ...x, fee: true }))
          }}
          className="tabular"
        />
      </Field>
      {canCommission && (
        <Field label={t('calendar.fields.commission')} name="commissionAed">
          <Input
            id="commissionAed"
            name="commissionAed"
            inputMode="decimal"
            value={commission}
            onChange={(e) => {
              setCommission(e.target.value)
              setEdited((x) => ({ ...x, commission: true }))
            }}
            className="tabular"
          />
        </Field>
      )}
    </div>
  )
}
