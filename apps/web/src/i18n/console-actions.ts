'use server'
import { isConsoleLocale } from '@spa/core/i18n'
import { refresh } from 'next/cache'
import { cookies } from 'next/headers'
import { type ActionResult, fail, ok } from '@/lib/action'
import { CONSOLE_LOCALE_COOKIE } from './console'

/**
 * Console user menu English | العربية (R22): remembers the super-admin's console language in a cookie on the admin
 * host (only 'en' | 'ar'; it changes nothing but this browser's own preference, so no permission check).
 */
export async function setConsoleLocaleAction(locale: string): Promise<ActionResult> {
  if (!isConsoleLocale(locale)) return fail('errors.generic')
  ;(await cookies()).set(CONSOLE_LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
    httpOnly: true,
  })
  refresh()
  return ok()
}
