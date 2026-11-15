// R47 (owner 2026-11-07): a spa's website shares its WhatsApp chats across several numbers (CRM Settings → "Website
// WhatsApp numbers"). Each visitor gets one, round robin, and keeps it 30 days in the first-party `spa_wa` cookie, so a
// returning client reaches the same person. Read by the design page (app/site-html, which also sets the cookie), the
// block pages (PublicSite: a new visitor's cookie is written by <WhatsappCookie>, server components can't set one) and
// the /book confirmation's WhatsApp link (an existing cookie only).
import { rotatedWhatsapp } from '@spa/core'
import { withTenant } from '@spa/db'
import { nextWhatsappTurn, websiteWhatsappRotation } from '@spa/services'

export const WA_COOKIE = 'spa_wa'
export const WA_COOKIE_DAYS = 30

/** The `spa_wa` value from a Cookie header (digits only), else null. */
export function waCookieOf(header: string | null | undefined) {
  return /(?:^|;\s*)spa_wa=(\d{8,15})(?:;|$)/.exec(header ?? '')?.[1] ?? null
}

/**
 * This visitor's number: the cookie's while it is still in the spa's rotation, else (`assign`) the next in turn;
 * null when the spa has no rotation (the branch WhatsApp stays). `fresh` = a new assignment to save in the cookie.
 */
export async function visitorWhatsapp(
  tenantId: string,
  cookie: string | null,
  opts: { assign: boolean },
): Promise<{ number: string; fresh: boolean } | null> {
  return withTenant(tenantId, async (tx) => {
    const list = await websiteWhatsappRotation(tx, tenantId)
    if (!list.length) return null
    if (cookie && list.includes(cookie)) return { number: cookie, fresh: false }
    if (!opts.assign) return null
    return { number: rotatedWhatsapp(list, await nextWhatsappTurn(tx, tenantId))!, fresh: true }
  })
}

/** Set-Cookie value (not HttpOnly: a block page's script writes the same cookie for a new visitor). */
export const waCookieHeader = (number: string, path: string, secure: boolean) =>
  `${WA_COOKIE}=${number}; Path=${path || '/'}; Max-Age=${WA_COOKIE_DAYS * 86_400}; SameSite=Lax${secure ? '; Secure' : ''}`
