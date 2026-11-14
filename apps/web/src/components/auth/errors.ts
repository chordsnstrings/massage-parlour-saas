'use client'
// Auth-page i18n helpers: Better Auth error codes → `auth.errors.*`, and an English fallback translator for auth forms
// mounted outside an <I18nProvider> (the super-admin login reuses LoginForm).
import { auth } from '@spa/core/i18n/en/auth'
import { ui } from '@spa/core/i18n/en-ui'
import { createTranslator, type Translator } from '@spa/core/i18n/translate'
import { useT } from '@/i18n/client'

const english = createTranslator('en', { auth, ui })

/** The viewer's translator when the auth catalogue is loaded, else English auth strings. */
export function useAuthT(): Translator {
  const t = useT()
  return t.has('auth.generic') ? t : english
}

type AuthError = { code?: string; message?: string; status?: number } | null | undefined

/** Text for a Better Auth client error in the viewer's language (unknown codes keep Better Auth's English). */
export function authErrorText(t: Translator, error: AuthError) {
  if (error?.status === 429) return t('auth.errors.RATE_LIMITED')
  return (error?.code && t.maybe(`auth.errors.${error.code}`)) || error?.message || t('auth.generic')
}
