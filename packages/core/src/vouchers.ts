// F15 gift-card vouchers (QR → public check page) and F16 partner booking links: pure helpers.

/** A voucher's check token (`gift_cards.check_token`): 32 lowercase hex characters. */
export const VOUCHER_TOKEN = /^[0-9a-f]{32}$/
const TOKEN_IN_URL = /\/voucher\/([0-9a-f]{32})(?:[/?#]|$)/i

/** Path of the public voucher check page on the spa's site (after the site base). */
export const voucherPath = (token: string) => `/voucher/${token}`

/**
 * What staff typed or scanned at checkout: the voucher's QR (a check-page URL, e.g. from a scanner that types it)
 * gives its token; anything else is the gift card code (trimmed, upper case).
 */
export function giftCardInput(raw: string): { token: string } | { code: string } {
  const value = raw.trim()
  const m = TOKEN_IN_URL.exec(value)
  if (m?.[1]) return { token: m[1].toLowerCase() }
  if (VOUCHER_TOKEN.test(value.toLowerCase()) && !value.includes('-')) return { token: value.toLowerCase() }
  return { code: value.toUpperCase() }
}

/** F16 partner link code (`booking_partners.code`): 4–12 lowercase letters and digits. */
export const PARTNER_CODE = /^[a-z0-9]{4,12}$/

/** A new partner code: 6 characters without look-alikes (0/o, 1/l/i). */
export function newPartnerCode(random: () => number = Math.random) {
  const a = 'abcdefghjkmnpqrstuvwxyz23456789'
  return Array.from({ length: 6 }, () => a[Math.floor(random() * a.length)]).join('')
}

/** The booking link a poster's QR opens: `/book?src=qr`, plus `&partner={code}` for a partner's poster. */
export function posterBookingUrl(siteUrl: string, partnerCode?: string | null) {
  const u = new URL(`${siteUrl.replace(/\/$/, '')}/book`)
  u.searchParams.set('src', 'qr')
  if (partnerCode) u.searchParams.set('partner', partnerCode)
  return u.toString()
}
