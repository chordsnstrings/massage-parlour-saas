// Claude MCP connector (/api/mcp): housekeeping of OAuth clients registered through open dynamic client
// registration (RFC 7591). Registering grants nothing, but every registration stores a row; ones nobody approved
// are pruned so unauthenticated registration can't grow the table without bound.
import { type Db, oauthClient, oauthConsent } from '@spa/db'
import { and, lt, notExists, sql } from 'drizzle-orm'

/** How long a registered client may wait for its first consent (Claude registers and authorises within minutes). */
export const UNUSED_OAUTH_CLIENT_HOURS = 24

/**
 * Deletes OAuth clients older than `hours` that no user ever approved (no consent row). Their resource links and any
 * stray tokens go with them (FK cascade). Platform data: call with platformDb(). Returns the deleted client ids.
 */
export async function pruneUnusedOAuthClients(
  db: Db,
  opts: { now?: Date; hours?: number } = {},
): Promise<string[]> {
  const cutoff = new Date(
    (opts.now ?? new Date()).getTime() - (opts.hours ?? UNUSED_OAUTH_CLIENT_HOURS) * 3_600_000,
  )
  const rows = await db
    .delete(oauthClient)
    .where(
      and(
        lt(oauthClient.createdAt, cutoff),
        notExists(
          db
            .select({ one: sql`1` })
            .from(oauthConsent)
            .where(sql`${oauthConsent.clientId} = ${oauthClient.clientId}`),
        ),
      ),
    )
    .returning({ clientId: oauthClient.clientId })
  return rows.map((r) => r.clientId)
}
