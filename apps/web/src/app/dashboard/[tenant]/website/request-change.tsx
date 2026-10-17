'use client'
import { Send } from 'lucide-react'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { Select, Textarea } from '@/components/ui/input'
import { useT } from '@/i18n/client'
import { requestChangeAction } from './request-actions'

/** R23: the spa asks the studio for a change (whole site or one page); the form clears once sent. */
export function RequestChangeForm({ slug, pages }: { slug: string; pages: { id: string; title: string }[] }) {
  const t = useT()
  return (
    <ActionForm action={requestChangeAction.bind(null, slug)} resetOnSuccess className="space-y-4">
      {pages.length > 0 && (
        <Field label={t('website.request.page')} name="pageId">
          <Select id="pageId" name="pageId" defaultValue="">
            <option value="">{t('website.wholeSite')}</option>
            {pages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label={t('website.request.body')} name="body" hint={t('website.request.bodyHint')}>
        <Textarea
          id="body"
          name="body"
          required
          minLength={3}
          maxLength={2000}
          rows={4}
          placeholder={t('website.request.placeholder')}
        />
      </Field>
      <SubmitButton>
        <Send /> {t('website.request.submit')}
      </SubmitButton>
    </ActionForm>
  )
}
