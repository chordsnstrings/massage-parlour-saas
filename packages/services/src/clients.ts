import { toUaeE164 } from '@spa/core'
import { clients, type Tx } from '@spa/db'
import { and, eq } from 'drizzle-orm'
import { DomainError } from './errors'

/** Finds a client by UAE mobile (normalised) or creates one. Used by online booking, walk-ins and DMs. */
export async function findOrCreateClient(
  tx: Tx,
  tenantId: string,
  input: { name: string; phone: string; source?: string; language?: string },
) {
  const phone = toUaeE164(input.phone)
  if (!phone) throw new DomainError('Enter a UAE mobile number, e.g. 050 123 4567')
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
