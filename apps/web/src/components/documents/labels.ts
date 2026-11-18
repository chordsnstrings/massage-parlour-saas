// Document labels in the viewer's language (client-safe). Known types are translated; older free-text types show as
// typed. Pass the `t` from getT()/getI18n() (server) or useT() (client).
import type { MessageKey, Translator } from '@spa/core/i18n'

/** `docTypeLabel(t, 'visa', 'Visa / residence permit')` → translated label, else the stored label/type. */
export const docTypeLabel = (t: Translator, type: string, fallback?: string) =>
  t.maybe(`documents.type.${type}`) ?? fallback ?? type

/** "Expired 3 days ago" / "Expires today" / "Expires in 12 days" (mirrors services `expiryPhrase`). */
export function expiryText(t: Translator, days: number | null) {
  if (days === null) return t('documents.expiry.none')
  if (days < 0) return t('documents.expiry.ago', { count: -days })
  if (days === 0) return t('documents.expiry.today')
  if (days === 1) return t('documents.expiry.tomorrow')
  return t('documents.expiry.in', { count: days })
}

export const docStatusKey = (status: string) => `documents.status.${status}` as MessageKey
