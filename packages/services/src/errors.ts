/** Postgres error code from a (possibly drizzle-wrapped) error. */
export const pgCode = (e: unknown): string | undefined =>
  (e as { code?: string })?.code ?? (e as { cause?: { code?: string } })?.cause?.code

/** Violated constraint/index name from a (possibly drizzle-wrapped) Postgres error. */
export const pgConstraint = (e: unknown): string | undefined =>
  (e as { constraint?: string })?.constraint ?? (e as { cause?: { constraint?: string } })?.cause?.constraint

export class DomainError extends Error {
  constructor(
    message: string,
    readonly code: 'slot_taken' | 'not_found' | 'invalid' | 'no_room' | 'no_staff' = 'invalid',
  ) {
    super(message)
  }
}
