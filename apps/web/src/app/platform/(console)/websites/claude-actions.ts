'use server'
import { oauthAccessToken, oauthConsent, oauthRefreshToken, platformDb } from '@spa/db'
import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { type ActionResult, fail, ok } from '@/lib/action'
import { requirePlatformAdmin } from '@/server/access'
import { audit } from '@/server/audit'

/**
 * "Connect Claude" card: revokes one of the signed-in super-admin's connected MCP clients. Deletes the consent (the
 * MCP route requires it on every call, so access stops at once) and that client's refresh/access tokens.
 */
export async function revokeClaudeClientAction(clientId: unknown): Promise<ActionResult> {
  const { user } = await requirePlatformAdmin()
  const parsed = z.string().min(1).max(200).safeParse(clientId)
  if (!parsed.success) return fail('Connection not found')
  const db = platformDb()
  const removed = await db.transaction(async (tx) => {
    const rows = await tx
      .delete(oauthConsent)
      .where(and(eq(oauthConsent.userId, user.id), eq(oauthConsent.clientId, parsed.data)))
      .returning({ id: oauthConsent.id })
    await tx
      .delete(oauthAccessToken)
      .where(and(eq(oauthAccessToken.userId, user.id), eq(oauthAccessToken.clientId, parsed.data)))
    await tx
      .delete(oauthRefreshToken)
      .where(and(eq(oauthRefreshToken.userId, user.id), eq(oauthRefreshToken.clientId, parsed.data)))
    return rows.length
  })
  if (!removed) return fail('Connection not found')
  await audit({
    actorUserId: user.id,
    action: 'platform.mcp.client_revoked',
    data: { clientId: parsed.data },
  })
  revalidatePath('/platform/websites')
  return ok('Disconnected — that Claude can no longer edit sites')
}
