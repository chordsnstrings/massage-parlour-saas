'use client'
import { LogoInput } from '@/components/media/logo-input'
import { Card } from '@/components/crm'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { useT } from '@/i18n/client'
import { saveLogoAction } from './actions'

/** Settings › Business: the spa logo shown at the top of the dashboard menu. */
export function LogoForm({ slug, current }: { slug: string; current: string | null }) {
  const t = useT()
  return (
    <Card title={t('logo.title')} sub={current ? t('logo.description') : t('logo.none')}>
        <ActionForm
          action={saveLogoAction.bind(null, slug)}
          resetOnSuccess
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
        >
          <Field label={t('logo.choose')} name="logo" className="min-w-0 flex-1">
            <LogoInput current={current} tooLargeText={t('logo.tooLarge', { size: '1 MB' })} />
          </Field>
          <div className="flex gap-2">
            <SubmitButton variant="secondary">{t('logo.upload')}</SubmitButton>
            {current && (
              <SubmitButton variant="ghost" name="intent" value="remove">
                {t('logo.remove')}
              </SubmitButton>
            )}
          </div>
        </ActionForm>
    </Card>
  )
}
