/** Arabic-Indic (U+0660–0669) and Extended Arabic-Indic / Persian (U+06F0–06F9) digits → ASCII. */
export const asciiDigits = (s: string) =>
  s
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))

/**
 * Invisible direction and zero-width marks (LRM/RLM/ALM, embeddings/overrides, isolates, BOM) that WhatsApp, iOS
 * Contacts and Arabic keyboards wrap pasted numbers in (QA M3; data-io cleanCell strips the same).
 */
const FORMAT_MARKS = /[\u200b-\u200f\u061c\u202a-\u202e\u2066-\u2069\ufeff]/g

/**
 * Normalises a UAE mobile number to E.164 digits without '+', e.g. 0501234567 → 971501234567 (Arabic-Indic
 * digits accepted).
 */
export function toUaeE164(input: string): string | null {
  let digits = asciiDigits(input).replace(/\D/g, '')
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
 * or 00 (Arabic-Indic digits read as ASCII, invisible direction marks dropped, QA M3). A trunk 0 is dropped: '(0)' anywhere (+44 (0)20 …), after +971, and after a country code typed apart
 * (+44 07700 …, 0049 030 …) unless that country keeps it. Null unless it can be a valid E.164 number (8–15 digits,
 * no leading 0).
 */
export function toE164(input: string): string | null {
  const raw = phoneText(input)
  return raw && (toUaeE164(raw) ?? intlDigits(raw))
}

/** Phone text for `toE164`: ASCII digits, no direction marks or '(0)'; null unless only digits, a leading +, ( ) . / - */
function phoneText(input: string): string | null {
  const raw = asciiDigits(input)
    .replace(FORMAT_MARKS, '')
    .replace(/\(\s*0\s*\)/g, ' ')
    .trim()
  return !raw || /[^\d\s+()./-]/.test(raw) || raw.lastIndexOf('+') > 0 ? null : raw
}

/** `toE164` after its UAE-mobile shortcut: landlines with the trunk 0, + / 00 international, trunk 0 rules. */
function intlDigits(raw: string): string | null {
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

/**
 * A client (customer) phone → E.164 digits without '+' (R38). Typed without + or 00 it is a UAE mobile, exactly as
 * `toUaeE164` (05…, 5…, 9715…; bare foreign digits are refused, so a mistyped UAE number is never saved as foreign);
 * with + or 00 any country as `toE164`, except that a UAE number must still be a mobile (no 04/02 landlines: WhatsApp).
 * '(+44) …' reads as '+44 …'; +971 numbers keep `toUaeE164`'s leniency (+971 50 123 4567 (home)); a trunk 0 right
 * after the code is dropped (+4407700… → 447700…) unless that country keeps it; +5X XXX XXXX (a UAE mobile without
 * 971, or a 6-digit +508 / +597 number) is refused, never guessed. Staff, spa, branch and signup phones stay
 * `toUaeE164`.
 */
export function toClientE164(input: string): string | null {
  const raw = asciiDigits(input)
    .replace(FORMAT_MARKS, '')
    .trim()
    .replace(/^\(\s*(\+|00)\s*(\d{1,3})\s*\)/, '$1$2 ')
  if (!/^(?:\+|00)/.test(raw)) return toUaeE164(raw)
  const typed = raw.replace(/\D/g, '').replace(/^00/, '')
  if (/^(?:971|0)/.test(typed)) {
    const uae = toE164(raw) ?? toUaeE164(raw)
    return uae && /^9715\d{8}$/.test(uae) ? uae : null
  }
  if (/^5\d{8}$/.test(typed)) return null
  const text = phoneText(raw)
  let digits = text && intlDigits(text)
  if (!digits) return null
  const cc = callingCode(digits)
  if (!KEEPS_LEADING_ZERO.has(cc) && digits.startsWith(`${cc}0`)) digits = cc + digits.slice(cc.length + 1)
  if (digits.startsWith('971')) return /^9715\d{8}$/.test(digits) ? digits : null
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : null
}

/** International calling code of E.164 digits (ITU: 1–3 digits, none is the start of another): 44…, 1…, 971…. */
export function callingCode(e164: string): string {
  const d = e164.replace(/\D/g, '')
  if (/^[17]/.test(d)) return d.slice(0, 1)
  if (/^(?:2[07]|3[0-469]|4[013-9]|5[1-8]|6[0-6]|8[1246]|9[0-58])/.test(d)) return d.slice(0, 2)
  return d.slice(0, 3)
}

/**
 * A stored phone (E.164 digits) for screens: UAE mobiles grouped (+971 50 123 4567), others +digits. `mask` (members
 * without phone access) always hides at least 3 digits, whatever the length or country code: 'last4' → +971 50 •••
 * 4567 / +44 ••• 0123, 'last2' → +971 50 ••• ••67 / +44 ••• ••23; under 8 digits → •••.
 */
export function phoneDisplay(e164: string, opts: { mask?: 'last4' | 'last2' } = {}): string {
  const d = e164.replace(/\D/g, '')
  const uae = /^971(\d{2})(\d{3})(\d{4})$/.exec(d)
  if (!opts.mask) return uae ? `+971 ${uae[1]} ${uae[2]} ${uae[3]}` : d && `+${d}`
  if (d.length < 8) return '•••'
  const dots = opts.mask === 'last2' ? '••' : ''
  if (uae) return `+971 ${uae[1]} ••• ${dots}${d.slice(dots ? -2 : -4)}`
  const cc = callingCode(d)
  const shown = Math.min(dots ? 2 : 4, d.length - cc.length - 3)
  return `+${cc} ••• ${dots}${shown > 0 ? d.slice(-shown) : ''}`.trimEnd()
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
