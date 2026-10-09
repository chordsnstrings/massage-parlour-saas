import { getAuth } from '@spa/auth'
import { platformDb, user } from '@spa/db'
import { eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { cache } from 'react'
import { surfaceBaseOf } from '@/lib/paths'

export const getSession = cache(async () => {
  const h = await headers() // read first so pages are marked dynamic before any DB/env access
  const session = await getAuth().api.getSession({ headers: h })
  // Spa applications (PLAN §18.3): a rejected applicant's login is disabled. Its sessions were revoked, but the
  // 5-minute cookie cache may still carry one — read the row so a disabled login is signed out everywhere at once.
  if (session) {
    const [row] = await platformDb()
      .select({ disabledAt: user.disabledAt })
      .from(user)
      .where(eq(user.id, session.user.id))
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
