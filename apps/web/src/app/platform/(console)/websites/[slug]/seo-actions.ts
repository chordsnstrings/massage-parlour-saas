'use server'
import { withTenant } from '@spa/db'
import { runSeoCheck } from '@spa/services'
import { revalidatePath } from 'next/cache'
import { type ActionResult, fail, ok } from '@/lib/action'
import { studioGuard } from '@/server/access'
import { audit } from '@/server/audit'
import { revalidateStudio } from '@/server/studio'

/*
 * R30 "Check now" (console spa website page, SEO check card): the weekly search check run on demand by a
 * super-admin (the Website Studio). It only reads the live site and stores the result; "Draft fixes" is Write texts
 * with the search scope (write-texts-actions.ts, SITE_AI_EDITOR_EMAILS + 2FA).
 */
export async function checkSeoAction(slug: string): Promise<ActionResult> {
  const { ctx, error } = await studioGuard(slug, 'site.content')
  if (error) return fail(error)
  const tenantId = ctx.tenant.id
  const row = await withTenant(tenantId, (tx) => runSeoCheck(tx, tenantId, { trigger: 'manual' }))
  if (!row) return fail('Nothing is live yet — publish a page first.')
  await audit({
    tenantId,
    actorUserId: ctx.user.id,
    impersonatorUserId: ctx.impersonating ? ctx.user.id : undefined,
    action: 'site.seo_checked',
    entity: 'site',
    entityId: row.siteId,
    data: { counts: row.counts },
  })
  revalidateStudio(slug)
  revalidatePath(`/dashboard/${slug}/ai`)
  const n = row.counts.high + row.counts.medium
  return ok(
    n
      ? `Search check done: ${n} ${n === 1 ? 'thing' : 'things'} to improve.`
      : 'Search check done: all good.',
  )
}
