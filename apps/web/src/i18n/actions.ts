'use server'
import { getAuth } from '@spa/auth'
import { isLocale } from '@spa/core/i18n'
import { refresh } from 'next/cache'
import { cookies, headers } from 'next/headers'
import { type ActionResult, fail, ok } from '@/lib/action'
import { getSession } from '@/server/session'
import { LOCALE_COOKIE } from './server'

/** Top-bar EN | ไทย toggle: saves the signed-in user's language (+ a cookie for pages before sign-in). */
export async function setLocaleAction(locale: string): Promise<ActionResult> {
  if (!isLocale(locale)) return fail('errors.generic')
  ;(await cookies()).set(LOCALE_COOKIE, locale, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' })
  if (await getSession()) {
    // updateUser also refreshes Better Auth's cached session cookie, so the next render already sees it.
    await getAuth().api.updateUser({ body: { locale }, headers: await headers() })
  }
  refresh()
  return ok()
}
