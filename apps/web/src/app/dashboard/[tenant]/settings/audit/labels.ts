import type { Translator } from '@spa/core/i18n'
import type { AuditEntry } from '@spa/services'

/** Who did it: the member's name (as typed), "· platform support" for a super-admin, else former user / system. */
export function actorLabel(t: Translator, e: Pick<AuditEntry, 'actorName' | 'actorUserId' | 'support'>) {
  if (e.actorName) return e.support ? t('audit.actor.support', { name: e.actorName }) : e.actorName
  return e.actorUserId ? t('audit.actor.unknown') : t('audit.actor.system')
}
