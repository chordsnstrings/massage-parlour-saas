import { getAuth } from '@spa/auth'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { cache } from 'react'

export const getSession = cache(async () => {
  const h = await headers() // read first so pages are marked dynamic before any DB/env access
  return getAuth().api.getSession({ headers: h })
})

/** Path the visitor actually requested (before host rewriting), for post-login redirects. */
export async function originalPath() {
  return (await headers()).get('x-original-path') ?? '/'
}

export async function requireUser() {
  const session = await getSession()
  if (!session) redirect(`/login?next=${encodeURIComponent(await originalPath())}`)
  return session
}

/** Only allow same-site relative redirects. */
export const safeNext = (next: string | undefined | null, fallback = '/') =>
  next?.startsWith('/') && !next.startsWith('//') ? next : fallback
