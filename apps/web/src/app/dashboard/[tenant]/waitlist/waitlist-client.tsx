'use client'
import { CalendarPlus, Plus, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/form'
import { FormSheet } from '@/components/ui/form-sheet'
import { Input, Select, Textarea } from '@/components/ui/input'
import { useT } from '@/i18n/client'
import { useConfirmAction } from '../services/services-client'
import { addWaitlistAction, bookWaitlistAction, removeWaitlistAction } from './actions'

export function AddWaitlistSheet({
  slug,
  branches,
  branchId,
  date,
  services,
}: {
  slug: string
  branches: { id: string; name: string }[]
  branchId: string
  date: string
  services: { id: string; name: string }[]
}) {
  const t = useT()
  return (
    <FormSheet
      title={t('waitlist.sheet.title')}
      description={t('waitlist.sheet.sub')}
      trigger={
        <Button>
          <Plus /> {t('waitlist.add')}
        </Button>
      }
      action={addWaitlistAction.bind(null, slug)}
      submitLabel={t('waitlist.sheet.submit')}
    >
      {branches.length > 1 ? (
        <Field label={t('waitlist.sheet.branch')} name="branchId">
          <Select id="branchId" name="branchId" defaultValue={branchId}>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <input type="hidden" name="branchId" value={branchId} />
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('waitlist.sheet.clientName')} name="clientName">
          <Input id="clientName" name="clientName" autoComplete="off" required />
        </Field>
        <Field
          label={t('waitlist.sheet.clientPhone')}
          name="clientPhone"
          hint={t('waitlist.sheet.clientPhoneHint')}
        >
          <Input id="clientPhone" name="clientPhone" type="tel" inputMode="tel" required />
        </Field>
      </div>
      <Field label={t('waitlist.sheet.service')} name="serviceId">
        <Select id="serviceId" name="serviceId" defaultValue="">
          <option value="">{t('waitlist.anyService')}</option>
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t('waitlist.sheet.date')} name="date">
        <Input id="date" name="date" type="date" defaultValue={date} required />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label={t('waitlist.sheet.from')} name="from">
          <Input id="from" name="from" type="time" step={900} />
        </Field>
        <Field label={t('waitlist.sheet.until')} name="until" hint={t('waitlist.sheet.windowHint')}>
          <Input id="until" name="until" type="time" step={900} />
        </Field>
      </div>
      <Field label={t('waitlist.sheet.notes')} name="notes">
        <Textarea id="notes" name="notes" rows={2} maxLength={500} />
      </Field>
    </FormSheet>
  )
}

export function BookWaitlistSheet({
  slug,
  entryId,
  name,
  dateLabel,
  defaultTime,
  defaultVariant,
  variants,
  therapists,
}: {
  slug: string
  entryId: string
  name: string
  dateLabel: string
  defaultTime: string
  defaultVariant: string
  variants: { id: string; label: string }[]
  therapists: { id: string; name: string }[]
}) {
  const t = useT()
  return (
    <FormSheet
      title={t('waitlist.book.title', { name })}
      description={t('waitlist.book.sub', { date: dateLabel })}
      trigger={
        <Button size="sm" variant="secondary" aria-label={`${t('waitlist.book.action')} ${name}`}>
          <CalendarPlus /> {t('waitlist.book.action')}
        </Button>
      }
      action={bookWaitlistAction.bind(null, slug, entryId)}
      submitLabel={t('waitlist.book.submit')}
    >
      <Field label={t('waitlist.book.duration')} name="variantId">
        <Select id="variantId" name="variantId" defaultValue={defaultVariant || variants[0]?.id}>
          {variants.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t('waitlist.book.time')} name="time">
        <Input id="time" name="time" type="time" step={900} defaultValue={defaultTime} required />
      </Field>
      <Field label={t('waitlist.book.therapist')} name="staffId">
        <Select id="staffId" name="staffId" defaultValue="">
          <option value="">{t('waitlist.book.anyTherapist')}</option>
          {therapists.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </Field>
    </FormSheet>
  )
}

export function RemoveWaitlistButton({
  slug,
  entryId,
  name,
}: {
  slug: string
  entryId: string
  name: string
}) {
  const t = useT()
  const router = useRouter()
  const { pending, run } = useConfirmAction()
  return (
    <Button
      size="sm"
      variant="ghost"
      pending={pending}
      aria-label={`${t('waitlist.remove')} ${name}`}
      onClick={() =>
        run(
          t('waitlist.confirmRemove', { name }),
          () => removeWaitlistAction(slug, entryId),
          () => router.refresh(),
        )
      }
    >
      <X /> {t('waitlist.remove')}
    </Button>
  )
}
