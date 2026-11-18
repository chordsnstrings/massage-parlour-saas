'use server'
import { withTenant } from '@spa/db'
import { DomainError, mergeClients } from '@spa/services'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { type ActionResult, fail, failDomain, ok } from '@/lib/action'
import { guard } from '@/server/access'
import { audit } from '@/server/audit'

/** Merges `mergeId` into `keepId` (one transaction, services/client-merge.ts); audit keeps both ids. */
export async function mergeClientsAction(
  slug: string,
  keepId: string,
  mergeId: string,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'clients.merge')
  if (error) return fail(error)
  if (!z.uuid().safeParse(keepId).success || !z.uuid().safeParse(mergeId).success)
    return fail('clients.result.notFound')
  try {
    const { moved, merged } = await withTenant(ctx.tenant.id, (tx) => mergeClients(tx, keepId, mergeId))
    await audit({
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: 'client.merged',
      entity: 'client',
      entityId: keepId,
      data: { keptId: keepId, mergedId: mergeId, mergedName: merged.name, moved },
    })
    revalidatePath(`/dashboard/${slug}/clients`)
    return ok('clientsMerge.result.merged', { id: keepId })
  } catch (e) {
    if (e instanceof DomainError) return failDomain(e)
    throw e
  }
}
