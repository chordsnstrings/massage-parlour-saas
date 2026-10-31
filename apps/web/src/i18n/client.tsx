'use client'
// Client side of the spa-dashboard i18n. The tenant layout wraps the dashboard in <I18nProvider> with the viewer's
// catalogue; anything outside it (super-admin, auth, public pages, the root Toaster) falls back to English UI-kit
// strings only, so those bundles never carry the catalogues.
import { ui } from '@spa/core/i18n/en-ui'
import { createFormat, type Format } from '@spa/core/i18n/format'
import { createTranslator, type Translator } from '@spa/core/i18n/translate'
import type { Locale, Messages } from '@spa/core/i18n/types'
import { createContext, useContext, useEffect, useMemo } from 'react'
import type { ActionResult } from '@/lib/action'

type I18n = { locale: Locale; t: Translator; fmt: Format }

const english: I18n = { locale: 'en', t: createTranslator('en', { ui }), fmt: createFormat('en') }
// Kept in sync by the provider so UI mounted outside its tree (the root Toaster) follows the dashboard language.
let outside: I18n = english

const Ctx = createContext<I18n | null>(null)

export function I18nProvider({
  locale,
  messages,
  children,
}: {
  locale: Locale
  messages: Messages
  children: React.ReactNode
}) {
  const value = useMemo<I18n>(
    () => ({ locale, t: createTranslator(locale, messages), fmt: createFormat(locale) }),
    [locale, messages],
  )
  useEffect(() => {
    outside = value
    document.documentElement.lang = locale
    return () => {
      outside = english
      document.documentElement.lang = 'en'
    }
  }, [value, locale])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useI18n = () => useContext(Ctx) ?? outside
export const useT = () => useI18n().t

/** Text of an action result in the viewer's language (catalogue key when present, else the server's text). */
export function resultText(t: Translator, result: NonNullable<ActionResult>) {
  const own = result.ok ? result.message : result.error
  return t.maybe(result.key, result.params) ?? own
}
