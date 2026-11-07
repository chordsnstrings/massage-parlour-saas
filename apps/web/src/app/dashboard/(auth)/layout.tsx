import type { Messages } from '@spa/core/i18n'
import { I18nProvider } from '@/i18n/client'
import { getI18n } from '@/i18n/server'

/**
 * Auth pages sit outside the spa shell: give their forms the viewer's language (`spa_locale` cookie before sign-in)
 * with only the namespaces they use, so the full dashboard catalogue isn't sent here.
 */
export default async function AuthPagesLayout({ children }: { children: React.ReactNode }) {
  const { locale, messages } = await getI18n()
  const { auth, common, errors, validation, logo, ui } = messages
  const subset = { auth, common, errors, validation, logo, ui } as unknown as Messages
  return (
    <I18nProvider locale={locale} messages={subset}>
      {children}
    </I18nProvider>
  )
}
