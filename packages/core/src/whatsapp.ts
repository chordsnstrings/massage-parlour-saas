/** Normalises a UAE mobile number to E.164 digits without '+', e.g. 0501234567 → 971501234567. */
export function toUaeE164(input: string): string | null {
  let digits = input.replace(/\D/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.startsWith('0')) digits = `971${digits.slice(1)}`
  if (digits.length === 9 && digits.startsWith('5')) digits = `971${digits}`
  return /^9715\d{8}$/.test(digits) ? digits : null
}

/** Countries whose international numbers keep a leading 0 after the country code (Italy +39 06…, …). */
const KEEPS_LEADING_ZERO = new Set(['39', '378', '379', '225', '229', '241', '242'])

/**
 * Any phone number → E.164 digits without '+' (contact enquiries, PLAN §18.4): UAE mobiles as `toUaeE164`
 * (05…, 5…, 9715…), other UAE numbers with the trunk 0 (04 123 4567 → 97141234567), international numbers with +
 * or 00. A trunk 0 is dropped: '(0)' anywhere (+44 (0)20 …), after +971, and after a country code typed apart
 * (+44 07700 …, 0049 030 …) unless that country keeps it. Null unless it can be a valid E.164 number (8–15 digits,
 * no leading 0).
 */
export function toE164(input: string): string | null {
  const raw = input.replace(/\(\s*0\s*\)/g, ' ').trim()
  if (!raw || /[^\d\s+()./-]/.test(raw) || raw.lastIndexOf('+') > 0) return null
  const uae = toUaeE164(raw)
  if (uae) return uae
  let digits = raw.replace(/\D/g, '')
  if (raw.startsWith('+')) {
    // +971 0… → +971 …
  } else if (digits.startsWith('00')) digits = digits.slice(2)
  else if (digits.startsWith('0')) digits = `971${digits.slice(1)}`
  const cc = /^(?:\+|00)\s*(\d{1,3})[\s./-]+0/.exec(raw)?.[1]
  if (cc && !KEEPS_LEADING_ZERO.has(cc) && digits.startsWith(`${cc}0`))
    digits = cc + digits.slice(cc.length + 1)
  if (digits.startsWith('9710')) digits = `971${digits.slice(4)}`
  if (digits.startsWith('971') && !/^971\d{8,9}$/.test(digits)) return null
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : null
}

export type WhatsAppMode = 'desktop' | 'web' | 'mobile'

/** Click-to-send link; a human presses send in WhatsApp (no automation). */
export function whatsappLink(phoneE164: string, text: string, mode: WhatsAppMode = 'mobile'): string {
  const phone = phoneE164.replace(/\D/g, '')
  const t = encodeURIComponent(text)
  if (mode === 'desktop') return `whatsapp://send?phone=${phone}&text=${t}`
  if (mode === 'web') return `https://web.whatsapp.com/send?phone=${phone}&text=${t}`
  return `https://wa.me/${phone}?text=${t}`
}
