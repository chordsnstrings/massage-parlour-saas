import { platformDb } from '@spa/db'
import { sql } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await platformDb().execute(sql`select 1`)
    // The deployed commit (short sha, set by update.sh) so a deploy can be confirmed without the /_status password.
    // R37: no worker state here (public on every host, spa sites too); it shows in the console + /_status only.
    return Response.json({ ok: true, release: process.env.APP_RELEASE || null })
  } catch {
    return Response.json({ ok: false }, { status: 503 })
  }
}
