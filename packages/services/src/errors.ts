import type { MessageRef } from '@spa/core/i18n/types'

/** Postgres error code from a (possibly drizzle-wrapped) error. */
export const pgCode = (e: unknown): string | undefined =>
  (e as { code?: string })?.code ?? (e as { cause?: { code?: string } })?.cause?.code

/** Violated constraint/index name from a (possibly drizzle-wrapped) Postgres error. */
export const pgConstraint = (e: unknown): string | undefined =>
  (e as { constraint?: string })?.constraint ?? (e as { cause?: { constraint?: string } })?.cause?.constraint

/**
 * A rule violation the user can fix. `message` stays English (logs, tests); `i18n` names the catalogue message
 * (`@spa/core/i18n`) the dashboard shows instead, in the viewer's language (web: `failDomain` in lib/action.ts).
 */
export class DomainError extends Error {
  constructor(
    message: string,
    readonly code: 'slot_taken' | 'not_found' | 'invalid' | 'no_room' | 'no_staff' = 'invalid',
    readonly i18n?: MessageRef,
  ) {
    super(message)
  }
}
