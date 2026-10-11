// Server side of the spa-dashboard i18n (docs/PLAN.md §14.6). Locale = the signed-in user's `user.locale`, else the
// `spa_locale` cookie (pages before sign-in follow the last choice), else English.
import { catalogue, createFormat, isLocale, type Locale, translator } from '@spa/core/i18n'
import { platformDb, user } from '@spa/db'
import { eq } from 'drizzle-orm'
import { cookies } from 'next/headers'
import { cache } from 'react'
import { getSession } from '@/server/session'

export const LOCALE_COOKIE = 'spa_locale'

export const getLocale = cache(async (): Promise<Locale> => {
  const session = await getSession()
  if (session) {
    // Read from the row, not the session: Better Auth caches the session in a cookie for 5 minutes, and the toggle's
    // refresh re-renders within the same request (before the browser holds the updated cookie).
    const [row] = await platformDb()
      .select({ locale: user.locale })
      .from(user)
      .where(eq(user.id, session.user.id))
    if (isLocale(row?.locale)) return row.locale
  }
  const remembered = (await cookies()).get(LOCALE_COOKIE)?.value
  return isLocale(remembered) ? remembered : 'en'
})

/** `const t = await getT()` in server components, actions and route handlers. */
export async function getT() {
  return translator(await getLocale())
}

/** Locale + translator + formatter (+ the catalogue for the client provider). */
export async function getI18n() {
  const locale = await getLocale()
  return { locale, t: translator(locale), fmt: createFormat(locale), messages: catalogue(locale) }
}
