// Server side of the super-admin console i18n (R22, docs/design/console-i18n.md): English (default) or Arabic.
// The choice is the `console_locale` cookie on the admin host, set from the console user menu — a preference
// cookie (validated on every read, only 'en' | 'ar'), separate from the spa dashboard's `user.locale` (EN/TH), which
// a super-admin who is also a spa member keeps for the dashboard.
import { consoleCatalogue, consoleDir, consoleTranslator } from '@spa/core/i18n/console'
import { type ConsoleLocale, createFormat, isConsoleLocale } from '@spa/core/i18n'
import { cookies } from 'next/headers'
import { cache } from 'react'

export const CONSOLE_LOCALE_COOKIE = 'console_locale'

export const getConsoleLocale = cache(async (): Promise<ConsoleLocale> => {
  const value = (await cookies()).get(CONSOLE_LOCALE_COOKIE)?.value
  return isConsoleLocale(value) ? value : 'en'
})

/** `const t = await getConsoleT()` in console server components, actions, metadata and route handlers. */
export async function getConsoleT() {
  return consoleTranslator(await getConsoleLocale())
}

/** Locale + direction + translator + formatter (+ the catalogue for the client provider). */
export async function getConsoleI18n() {
  const locale = await getConsoleLocale()
  return {
    locale,
    dir: consoleDir(locale),
    t: consoleTranslator(locale),
    fmt: createFormat(locale),
    messages: consoleCatalogue(locale),
  }
}
