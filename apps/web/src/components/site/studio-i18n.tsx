import { en, type Messages } from '@spa/core/i18n'
import { I18nProvider } from '@/i18n/client'

/**
 * R23 Website Studio in the (English-only) console: the editor, media library and image fields are shared with the
 * spa dashboard and read `media.*` / `common.*` keys, which the console has no catalogue for. This gives them the
 * English text of just those namespaces.
 */
export function StudioI18n({ children }: { children: React.ReactNode }) {
  const { ui, common, errors, validation, media } = en
  const messages = { ui, common, errors, validation, media } as unknown as Messages
  return (
    <I18nProvider locale="en" messages={messages}>
      {children}
    </I18nProvider>
  )
}
