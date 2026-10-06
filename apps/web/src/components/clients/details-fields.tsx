import { Field } from '@/components/ui/form'
import { Input, Select, Textarea } from '@/components/ui/input'

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
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <Field label="Name" name="name" className="sm:col-span-2">
        <Input id="name" name="name" defaultValue={value?.name} autoComplete="off" required />
      </Field>
      {showPhone && (
        <Field label="UAE mobile" name="phone" hint="Used for WhatsApp, e.g. 050 123 4567.">
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
      <Field label="Gender" name="gender">
        <Select id="gender" name="gender" defaultValue={value?.gender ?? ''}>
          <option value="">Not set</option>
          <option value="female">Female</option>
          <option value="male">Male</option>
          <option value="other">Other</option>
        </Select>
      </Field>
      <Field label="Language" name="language" hint="Intake forms open in this language.">
        <Select id="language" name="language" defaultValue={value?.language ?? 'en'}>
          <option value="en">English</option>
          <option value="ar">العربية (Arabic)</option>
        </Select>
      </Field>
      <Field label="Birthday" name="birthday">
        <Input id="birthday" name="birthday" type="date" defaultValue={value?.birthday} />
      </Field>
      {full && (
        <>
          <Field label="Email" name="email">
            <Input id="email" name="email" type="email" defaultValue={value?.email} />
          </Field>
          <Field label="Nationality" name="nationality">
            <Input id="nationality" name="nationality" defaultValue={value?.nationality} />
          </Field>
        </>
      )}
      <Field
        label="Tags"
        name="tags"
        hint="Separate with commas, e.g. vip, regular."
        className="sm:col-span-2"
      >
        <Input id="tags" name="tags" defaultValue={value?.tags?.join(', ')} placeholder="vip, regular" />
      </Field>
      {full && (
        <Field label="Notes" name="notes" className="sm:col-span-2">
          <Textarea id="notes" name="notes" rows={4} defaultValue={value?.notes} />
        </Field>
      )}
    </div>
  )
}
