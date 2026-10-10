'use client'
// Client side of the super-admin console i18n (R22). The console and admin sign-in layouts wrap their pages in
// <ConsoleI18nProvider> with the viewer's catalogue; console client components call useConsoleT() / useConsoleI18n().
// The provider also drives the shared UI kit + auth forms (their `useT()` reads `ui.*` / `auth.*`, which the console
// catalogue mirrors) and Radix's reading direction, so dialogs, menus and toasts follow the console language.
import type { Format } from '@spa/core/i18n/format'
import { createFormat } from '@spa/core/i18n/format'
import { createTranslator, type Translator } from '@spa/core/i18n/translate'
import type { ConsoleLocale } from '@spa/core/i18n/types'
import type { ConsoleKey, ConsoleMessages, ConsoleTranslator } from '@spa/core/i18n/console/types'
import { Direction } from 'radix-ui'
import { createContext, useContext, useMemo } from 'react'
import { KitI18nProvider } from './client'

type ConsoleI18n = { locale: ConsoleLocale; dir: 'ltr' | 'rtl'; t: ConsoleTranslator; fmt: Format }

const Ctx = createContext<ConsoleI18n | null>(null)

export function ConsoleI18nProvider({
  locale,
  messages,
  children,
}: {
  locale: ConsoleLocale
  messages: ConsoleMessages
  children: React.ReactNode
}) {
  const value = useMemo<ConsoleI18n>(
    () => ({
      locale,
      dir: locale === 'ar' ? 'rtl' : 'ltr',
      t: createTranslator<ConsoleKey, ConsoleLocale>(locale, messages),
      fmt: createFormat(locale),
    }),
    [locale, messages],
  )
  // Shared kit components only read `ui.*` / `auth.*` / `errors.*` keys (same paths in both catalogues).
  const kit = useMemo(
    () => ({ locale: value.locale, dir: value.dir, t: value.t as unknown as Translator, fmt: value.fmt }),
    [value],
  )
  return (
    <Ctx.Provider value={value}>
      <KitI18nProvider value={kit}>
        <Direction.Provider dir={value.dir}>{children}</Direction.Provider>
      </KitI18nProvider>
    </Ctx.Provider>
  )
}

export function useConsoleI18n(): ConsoleI18n {
  const value = useContext(Ctx)
  if (!value) throw new Error('useConsoleI18n() outside <ConsoleI18nProvider> (console/admin sign-in layouts)')
  return value
}

export const useConsoleT = () => useConsoleI18n().t
