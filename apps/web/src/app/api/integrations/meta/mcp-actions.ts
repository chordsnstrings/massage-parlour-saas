'use server'
import { AiBudgetExceededError, AiDisabledError, META_TOOL_GROUPS, runMetaAgent } from '@spa/ai'
import { tenants, withTenant } from '@spa/db'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { type ActionResult, fail, formObject, ok } from '@/lib/action'
import { guard } from '@/server/access'
import { fixtureClient } from '@/server/ai-fixture'
import { audit } from '@/server/audit'

/** R7: the spa's "AI tools via Meta MCP" switches (tool groups + autopilot for public replies). */
export async function saveMetaMcpAction(slug: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'ai.manage')
  if (error) return fail(error)
  const f = formObject(fd)
  const groups = Object.fromEntries(META_TOOL_GROUPS.map((g) => [g, f[`group_${g}`] === 'on']))
  const metaMcp = { groups, autopilot: f.autopilot === 'on' }
  await withTenant(ctx.tenant.id, async (tx) => {
    const [cur] = await tx
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenant.id))
    await tx
      .update(tenants)
      .set({ settings: { ...(cur?.settings ?? {}), metaMcp } })
      .where(eq(tenants.id, ctx.tenant.id))
  })
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: 'ai.mcp.settings.updated',
    data: metaMcp,
  })
  revalidatePath(`/dashboard/${slug}/settings/integrations`)
  return ok('settings.integrations.mcp.saved')
}

/** Runs the Meta tools assistant on a staff instruction; its write tools audit themselves (ai.mcp.<tool>). */
export async function askMetaAiAction(slug: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'ai.approve')
  if (error) return fail(error)
  const instruction = String(fd.get('instruction') ?? '').trim()
  if (instruction.length < 3 || instruction.length > 1000)
    return fail('settings.integrations.mcp.errInstruction', {
      instruction: 'settings.integrations.mcp.errInstruction',
    })
  let r: Awaited<ReturnType<typeof runMetaAgent>>
  try {
    r = await runMetaAgent({
      tenantId: ctx.tenant.id,
      instruction,
      userId: ctx.user.id,
      client: fixtureClient(slug),
    })
  } catch (e) {
    if (e instanceof AiBudgetExceededError) return fail('ai.errBudget')
    if (e instanceof AiDisabledError) return fail('ai.errDisabled')
    console.error('meta agent failed', e)
    return fail('ai.errBusy')
  }
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: 'ai.mcp.run',
    data: { instruction: instruction.slice(0, 300), calls: r.calls, costUsd: r.costUsd },
  })
  for (const p of ['inbox', 'ai/content', 'messages']) revalidatePath(`/dashboard/${slug}/${p}`)
  const reply = r.reply.slice(0, 300)
  return reply
    ? ok({ key: 'settings.integrations.mcp.done', params: { reply } }, { reply, calls: r.calls })
    : ok('settings.integrations.mcp.doneEmpty', { calls: r.calls })
}
