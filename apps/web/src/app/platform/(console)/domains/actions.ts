'use server'
import { platformDb } from '@spa/db'
import {
  approveDomainOrder,
  checkDomain,
  DomainError,
  type DomainRun,
  forceDomainStatus,
  NamecheapError,
  rejectDomainOrder,
  removeDomain,
} from '@spa/services'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { type ActionResult, fail, ok } from '@/lib/action'
import { requirePlatformAdmin } from '@/server/access'
import { audit } from '@/server/audit'
import { invalidateSiteHost } from '@/server/sites'

// Super-admin only: platform role across every spa (the tenant pages use withTenant()).
const platformRun: DomainRun = (fn) => fn(platformDb())
const input = z.object({ id: z.uuid(), op: z.enum(['recheck', 'activate', 'deactivate', 'remove']) })
const VERB = {
  recheck: 'rechecked',
  activate: 'force_activated',
  deactivate: 'force_deactivated',
  remove: 'removed',
}

export async function adminDomainAction(id: string, op: string): Promise<ActionResult> {
  const { user } = await requirePlatformAdmin()
  const parsed = input.safeParse({ id, op })
  if (!parsed.success) return fail('Unknown domain or action')
  try {
    const before = await platformDb().query.domains.findFirst({
      where: (d, { eq }) => eq(d.id, parsed.data.id),
    })
    const { op } = parsed.data
    // Remove frees the hostname (and its Cloudflare hostname) for its real owner, e.g. a squatted claim.
    const d =
      op === 'recheck'
        ? await checkDomain(platformRun, parsed.data.id)
        : op === 'remove'
          ? await removeDomain(platformRun, parsed.data.id)
          : await forceDomainStatus(platformRun, parsed.data.id, op)
    invalidateSiteHost(d.hostname)
    await audit({
      tenantId: d.tenantId,
      actorUserId: user.id,
      action: `platform.domain.${VERB[op]}`,
      entity: 'domain',
      entityId: d.id,
      data: { hostname: d.hostname, from: before?.status, to: op === 'remove' ? null : d.status },
    })
    revalidatePath('/platform/domains')
    if (op === 'remove') return ok(`${d.hostname} removed`)
    if (op === 'activate') return ok(`${d.hostname} activated`)
    if (op === 'deactivate') return ok(`${d.hostname} deactivated`)
    return ok(`${d.hostname}: ${d.status}`)
  } catch (e) {
    if (e instanceof DomainError) return fail(e.message)
    throw e
  }
}

const orderInput = z.object({ id: z.uuid(), note: z.string().trim().max(300).default('') })

/** Buys the domain on the platform's Namecheap account and connects it to the spa. */
export async function approveDomainOrderAction(id: string): Promise<ActionResult> {
  const { user } = await requirePlatformAdmin()
  const parsed = orderInput.safeParse({ id })
  if (!parsed.success) return fail('Unknown request')
  try {
    const order = await approveDomainOrder(parsed.data.id, user.id)
    await audit({
      tenantId: order.tenantId,
      actorUserId: user.id,
      action: 'platform.domain_order.purchased',
      entity: 'domain_order',
      entityId: order.id,
      data: {
        domain: order.domain,
        chargedUsd: order.chargedUsd,
        priceAed: order.priceAed,
        note: order.error,
      },
    })
    revalidatePath('/platform/domains')
    return order.error
      ? fail(`Bought ${order.domain}. ${order.error}`)
      : ok(`Bought ${order.domain} and pointed it at the spa`)
  } catch (e) {
    revalidatePath('/platform/domains')
    if (e instanceof DomainError || e instanceof NamecheapError) return fail(e.message)
    throw e
  }
}

export async function rejectDomainOrderAction(id: string, note: string): Promise<ActionResult> {
  const { user } = await requirePlatformAdmin()
  const parsed = orderInput.safeParse({ id, note })
  if (!parsed.success) return fail('Unknown request')
  try {
    const order = await rejectDomainOrder(parsed.data.id, user.id, parsed.data.note)
    await audit({
      tenantId: order.tenantId,
      actorUserId: user.id,
      action: 'platform.domain_order.rejected',
      entity: 'domain_order',
      entityId: order.id,
      data: { domain: order.domain, note: order.note },
    })
    revalidatePath('/platform/domains')
    return ok(`Declined ${order.domain}`)
  } catch (e) {
    if (e instanceof DomainError) return fail(e.message)
    throw e
  }
}
