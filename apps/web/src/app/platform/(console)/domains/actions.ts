'use server'
import { platformDb } from '@spa/db'
import { checkDomain, DomainError, type DomainRun, forceDomainStatus } from '@spa/services'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { type ActionResult, fail, ok } from '@/lib/action'
import { requirePlatformAdmin } from '@/server/access'
import { audit } from '@/server/audit'
import { invalidateSiteHost } from '@/server/sites'

// Super-admin only: platform role across every spa (the tenant pages use withTenant()).
const platformRun: DomainRun = (fn) => fn(platformDb())
const input = z.object({ id: z.uuid(), op: z.enum(['recheck', 'activate', 'deactivate']) })

export async function adminDomainAction(id: string, op: string): Promise<ActionResult> {
  const { user } = await requirePlatformAdmin()
  const parsed = input.safeParse({ id, op })
  if (!parsed.success) return fail('Unknown domain or action')
  try {
    const before = await platformDb().query.domains.findFirst({
      where: (d, { eq }) => eq(d.id, parsed.data.id),
    })
    const d =
      parsed.data.op === 'recheck'
        ? await checkDomain(platformRun, parsed.data.id)
        : await forceDomainStatus(platformRun, parsed.data.id, parsed.data.op)
    invalidateSiteHost(d.hostname)
    await audit({
      tenantId: d.tenantId,
      actorUserId: user.id,
      action: `platform.domain.${parsed.data.op === 'recheck' ? 'rechecked' : `force_${parsed.data.op}d`}`,
      entity: 'domain',
      entityId: d.id,
      data: { hostname: d.hostname, from: before?.status, to: d.status },
    })
    revalidatePath('/platform/domains')
    if (parsed.data.op === 'activate') return ok(`${d.hostname} activated`)
    if (parsed.data.op === 'deactivate') return ok(`${d.hostname} deactivated`)
    return ok(`${d.hostname}: ${d.status}`)
  } catch (e) {
    if (e instanceof DomainError) return fail(e.message)
    throw e
  }
}
