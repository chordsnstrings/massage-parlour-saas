'use server'
import { withTenant } from '@spa/db'
import {
  acquirePageLock,
  DomainError,
  getPageLock,
  PAGE_LOCK_TTL_MS,
  type PageLock,
  releasePageLock,
} from '@spa/services'
import { z } from 'zod'
import { type ActionResult, fail, failDomain, ok } from '@/lib/action'
import { studioGuard } from '@/server/access'
import { audit } from '@/server/audit'

/*
 * F29 editing lock for the Studio editor (super-admin tooling, EN UI): the open editor takes the page's soft lock and
 * renews it every 30 s (`editorLockAction` = take + heartbeat); others see who holds it and may take over (audited
 * `site.page.lock_taken_over`). Draft writers refuse a page locked by someone else (services site-locks.ts).
 */

const uuid = z.string().uuid()

const holderView = (lock: PageLock) => ({
  name: lock.holderName,
  since: lock.acquiredAt.toISOString(),
  until: lock.expiresAt.toISOString(),
})

/** Takes (or renews) the lock for the signed-in editor; `takeOver` replaces another editor's lock. */
export async function editorLockAction(
  slug: string,
  pageId: string,
  input?: { takeOver?: boolean },
): Promise<ActionResult> {
  const { ctx, error } = await studioGuard(slug, 'site.content')
  if (error) return fail(error)
  if (!uuid.safeParse(pageId).success) return fail('Page not found')
  let result: Awaited<ReturnType<typeof acquirePageLock>>
  try {
    result = await withTenant(ctx.tenant.id, (tx) =>
      acquirePageLock(tx, {
        tenantId: ctx.tenant.id,
        pageId,
        userId: ctx.user.id,
        holderName: ctx.user.name || ctx.user.email,
        takeOver: input?.takeOver === true,
      }),
    )
  } catch (e) {
    if (e instanceof DomainError) return failDomain(e)
    throw e
  }
  if (!result.ok) return ok(undefined, { held: false, holder: holderView(result.lock) })
  if (result.tookOverFrom)
    await audit({
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      impersonatorUserId: ctx.impersonating ? ctx.user.id : undefined,
      action: 'site.page.lock_taken_over',
      entity: 'site_page',
      entityId: pageId,
      data: { from: result.tookOverFrom.holderName, fromUserId: result.tookOverFrom.userId },
    })
  return ok(input?.takeOver ? 'You’re editing this page now' : undefined, {
    held: true,
    ttlMs: PAGE_LOCK_TTL_MS,
    until: result.lock.expiresAt.toISOString(),
  })
}

/** Who holds the page now (view-only editors poll this to offer editing once it frees). */
export async function editorLockStatusAction(slug: string, pageId: string): Promise<ActionResult> {
  const { ctx, error } = await studioGuard(slug, 'site.content')
  if (error) return fail(error)
  if (!uuid.safeParse(pageId).success) return fail('Page not found')
  const lock = await withTenant(ctx.tenant.id, (tx) => getPageLock(tx, ctx.tenant.id, pageId))
  return ok(undefined, {
    holder: lock && lock.userId !== ctx.user.id ? holderView(lock) : null,
    mine: lock?.userId === ctx.user.id,
  })
}

/** Frees the editor's own lock when it closes (best effort; otherwise it expires on its own). */
export async function releaseEditorLockAction(slug: string, pageId: string): Promise<ActionResult> {
  const { ctx, error } = await studioGuard(slug, 'site.content')
  if (error) return fail(error)
  if (!uuid.safeParse(pageId).success) return fail('Page not found')
  await withTenant(ctx.tenant.id, (tx) =>
    releasePageLock(tx, { tenantId: ctx.tenant.id, pageId, userId: ctx.user.id }),
  )
  return ok()
}
