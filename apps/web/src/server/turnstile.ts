// F9 (G17): Cloudflare Turnstile on public, unauthenticated write entry points (booking page + widget, apply, contact).
// Keys unset → allowed everywhere (dev/test; production shows it red in the console Configuration card), so spas are
// never locked out before the owner adds them. Keys set → fail closed (core verifyTurnstileToken).
// Keys + the custom-domain switch come from the console (Settings → Bot check) first, then env (resolveTurnstile).
import { type ResolvedTurnstile, resolveTurnstile, verifyTurnstileToken } from '@spa/core'
import { platformDb } from '@spa/db'
import { cachedTurnstileSettings } from '@spa/services'
import { clientIp } from './rate-limit'

export type BotCheckAction = 'booking' | 'apply' | 'contact'

// One cached source per process (globalThis: route bundles are separate module graphs).
const g = globalThis as { __spaTurnstileCache?: ReturnType<typeof cachedTurnstileSettings> }
const source = () => {
  g.__spaTurnstileCache ??= cachedTurnstileSettings(() => platformDb())
  return g.__spaTurnstileCache
}

/** After a console save. */
export function invalidateTurnstileSettings() {
  g.__spaTurnstileCache?.invalidate()
}

/** Console settings over env. A database hiccup falls back to env alone (never blocks a page). */
export async function currentTurnstile(): Promise<ResolvedTurnstile> {
  try {
    return resolveTurnstile(await source()())
  } catch (e) {
    console.error('[turnstile] console settings unreadable, using env', e instanceof Error ? e.message : e)
    return resolveTurnstile(null)
  }
}

const skip = (r: ResolvedTurnstile, customDomain?: boolean) => !r.config || (customDomain && !r.customDomains)

/**
 * The widget's public site key, or null when this page needs no bot check: keys unset, or a spa's custom domain
 * while "Also check spa custom domains" is off (the widget only works on hostnames listed in Cloudflare).
 */
export async function turnstileSiteKey(opts: { customDomain?: boolean } = {}) {
  const r = await currentTurnstile()
  return skip(r, opts.customDomain) ? null : r.config!.siteKey
}

/** Server-side check of the widget token (siteverify with the visitor's IP). Mirrors `turnstileSiteKey`. */
export async function passesBotCheck(
  token: unknown,
  action: BotCheckAction,
  opts: { customDomain?: boolean } = {},
): Promise<boolean> {
  const r = await currentTurnstile()
  if (skip(r, opts.customDomain)) return true
  const verdict = await verifyTurnstileToken({
    secretKey: r.config!.secretKey,
    token,
    remoteIp: await clientIp(),
    action,
  })
  if (!verdict.ok) console.warn(`turnstile: ${action} rejected (${verdict.codes.join(', ') || 'no code'})`)
  return verdict.ok
}
