/** Normalises a UAE mobile number to E.164 digits without '+', e.g. 0501234567 → 971501234567. */
export function toUaeE164(input: string): string | null {
  let digits = input.replace(/\D/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.startsWith('0')) digits = `971${digits.slice(1)}`
  if (digits.length === 9 && digits.startsWith('5')) digits = `971${digits}`
  return /^9715\d{8}$/.test(digits) ? digits : null
}

/**
 * Any phone number → E.164 digits without '+' (contact enquiries, PLAN §18.4): UAE mobiles as `toUaeE164`
 * (05…, 5…, 9715…), other UAE numbers with the trunk 0 (04 123 4567 → 97141234567), international numbers with +
 * or 00 (a trunk 0 after +971 is dropped). Null unless it can be a valid E.164 number (8–15 digits, no leading 0).
 */
export function toE164(input: string): string | null {
  const raw = input.trim()
  if (!raw || /[^\d\s+()./-]/.test(raw) || raw.lastIndexOf('+') > 0) return null
  const uae = toUaeE164(raw)
  if (uae) return uae
  let digits = raw.replace(/\D/g, '')
  if (raw.startsWith('+')) {
    // +971 0… → +971 …
  } else if (digits.startsWith('00')) digits = digits.slice(2)
  else if (digits.startsWith('0')) digits = `971${digits.slice(1)}`
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
