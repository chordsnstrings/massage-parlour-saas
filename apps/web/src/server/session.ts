import { getAuth } from '@spa/auth'
import { platformDb, session as sessions, user } from '@spa/db'
import { eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { cache } from 'react'
import { surfaceBaseOf } from '@/lib/paths'

export const getSession = cache(async () => {
  const h = await headers() // read first so pages are marked dynamic before any DB/env access
  const session = await getAuth().api.getSession({ headers: h })
  // The 5-minute cookie cache may still carry a session that was revoked (password reset signs out everywhere, F14)
  // or whose login was disabled (a rejected spa application, PLAN §18.3): read the rows so either ends at once.
  if (session) {
    const [row] = await platformDb()
      .select({ disabledAt: user.disabledAt })
      .from(sessions)
      .innerJoin(user, eq(user.id, sessions.userId))
      .where(eq(sessions.id, session.session.id))
    if (!row || row.disabledAt) return null
  }
  return session
})

/** Path the visitor actually requested (before host rewriting), for post-login redirects. */
export async function originalPath() {
  return (await headers()).get('x-original-path') ?? '/'
}

export async function requireUser() {
  const session = await getSession()
  if (!session) {
    const path = await originalPath()
    redirect(`${surfaceBaseOf(path)}/login?next=${encodeURIComponent(path)}`)
  }
  return session
}

/** Only allow same-site relative redirects. */
export const safeNext = (next: string | undefined | null, fallback = '/') =>
  next?.startsWith('/') && !next.startsWith('//') ? next : fallback
