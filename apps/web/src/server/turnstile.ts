// F9 (G17): Cloudflare Turnstile on public, unauthenticated write entry points (booking page + widget, apply, contact).
// Keys unset → allowed everywhere (dev/test; production shows it red in the console Configuration card), so spas are
// never locked out before the owner adds them. Keys set → fail closed (core verifyTurnstileToken).
import { turnstileConfig, turnstileOnCustomDomains, verifyTurnstileToken } from '@spa/core'
import { clientIp } from './rate-limit'

export type BotCheckAction = 'booking' | 'apply' | 'contact'

/**
 * The widget's public site key, or null when this page needs no bot check: keys unset, or a spa's custom domain
 * while `TURNSTILE_CUSTOM_DOMAINS` is off (the widget only works on hostnames listed in Cloudflare).
 */
export function turnstileSiteKey(opts: { customDomain?: boolean } = {}) {
  const config = turnstileConfig()
  if (!config || (opts.customDomain && !turnstileOnCustomDomains())) return null
  return config.siteKey
}

/** Server-side check of the widget token (siteverify with the visitor's IP). Mirrors `turnstileSiteKey`. */
export async function passesBotCheck(
  token: unknown,
  action: BotCheckAction,
  opts: { customDomain?: boolean } = {},
): Promise<boolean> {
  const config = turnstileConfig()
  if (!config || (opts.customDomain && !turnstileOnCustomDomains())) return true
  const verdict = await verifyTurnstileToken({
    secretKey: config.secretKey,
    token,
    remoteIp: await clientIp(),
    action,
  })
  if (!verdict.ok) console.warn(`turnstile: ${action} rejected (${verdict.codes.join(', ') || 'no code'})`)
  return verdict.ok
}
