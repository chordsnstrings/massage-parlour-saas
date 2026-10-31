import { toClientE164 } from '@spa/core'
import { clients, type Tx } from '@spa/db'
import { and, eq } from 'drizzle-orm'
import { DomainError } from './errors'

/**
 * Finds a client by phone (`toClientE164`: UAE mobile, or any number with + / 00 and its country code) or creates
 * one. Used by online booking, walk-ins, sales, waitlist and DMs.
 */
export async function findOrCreateClient(
  tx: Tx,
  tenantId: string,
  input: { name: string; phone: string; source?: string; language?: string },
) {
  const phone = toClientE164(input.phone)
  if (!phone)
    throw new DomainError('Enter a UAE mobile (05X XXX XXXX) or a number with + and its country code')
  const [existing] = await tx
    .select()
    .from(clients)
    .where(and(eq(clients.tenantId, tenantId), eq(clients.phoneE164, phone)))
  if (existing) return existing
  const [created] = await tx
    .insert(clients)
    .values({
      tenantId,
      name: input.name.trim(),
      phoneE164: phone,
      source: input.source ?? null,
      language: input.language ?? 'en',
    })
    .onConflictDoNothing()
    .returning()
  if (created) return created
  const [raced] = await tx
    .select()
    .from(clients)
    .where(and(eq(clients.tenantId, tenantId), eq(clients.phoneE164, phone)))
  return raced!
}
