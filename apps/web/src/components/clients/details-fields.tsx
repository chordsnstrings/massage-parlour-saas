'use client'
import { enumLabel } from '@spa/core/i18n'
import { Field } from '@/components/ui/form'
import { Input, Select, Textarea } from '@/components/ui/input'
import { useT } from '@/i18n/client'

export type ClientDetails = {
  name: string
  phone: string
  email: string
  gender: string
  language: string
  birthday: string
  nationality: string
  tags: string[]
  notes: string
}

/** Name, phone, gender, language, birthday, tags (+ extra profile fields when editing). */
export function ClientDetailsFields({
  value,
  showPhone = true,
  full = false,
}: {
  value?: Partial<ClientDetails>
  showPhone?: boolean
  full?: boolean
}) {
  const t = useT()
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <Field label={t('clients.field.name')} name="name" className="sm:col-span-2">
        <Input id="name" name="name" defaultValue={value?.name} autoComplete="off" required />
      </Field>
      {showPhone && (
        <Field label={t('clients.field.phone')} name="phone" hint={t('clients.field.phoneHint')}>
          <Input
            id="phone"
            name="phone"
            type="tel"
            inputMode="tel"
            defaultValue={value?.phone}
            placeholder="050 123 4567"
          />
        </Field>
      )}
      <Field label={t('clients.field.gender')} name="gender">
        <Select id="gender" name="gender" defaultValue={value?.gender ?? ''}>
          <option value="">{t('clients.field.notSet')}</option>
          <option value="female">{enumLabel(t, 'staffGender', 'female')}</option>
          <option value="male">{enumLabel(t, 'staffGender', 'male')}</option>
          <option value="other">{enumLabel(t, 'staffGender', 'other')}</option>
        </Select>
      </Field>
      <Field label={t('clients.field.language')} name="language" hint={t('clients.field.languageHint')}>
        <Select id="language" name="language" defaultValue={value?.language ?? 'en'}>
          <option value="en">{t('clients.lang.en')}</option>
          <option value="ar">{t('clients.lang.ar')}</option>
        </Select>
      </Field>
      <Field label={t('clients.field.birthday')} name="birthday">
        <Input id="birthday" name="birthday" type="date" defaultValue={value?.birthday} />
      </Field>
      {full && (
        <>
          <Field label={t('clients.field.email')} name="email">
            <Input id="email" name="email" type="email" defaultValue={value?.email} />
          </Field>
          <Field label={t('clients.field.nationality')} name="nationality">
            <Input id="nationality" name="nationality" defaultValue={value?.nationality} />
          </Field>
        </>
      )}
      <Field
        label={t('clients.field.tags')}
        name="tags"
        hint={t('clients.field.tagsHint')}
        className="sm:col-span-2"
      >
        <Input id="tags" name="tags" defaultValue={value?.tags?.join(', ')} placeholder="vip, regular" />
      </Field>
      {full && (
        <Field label={t('clients.field.notes')} name="notes" className="sm:col-span-2">
          <Textarea id="notes" name="notes" rows={4} defaultValue={value?.notes} />
        </Field>
      )}
    </div>
  )
}
