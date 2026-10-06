import { createHash } from 'node:crypto'
import { forgetInstagramUser, metaConfig, metaUrls, parseSignedRequest } from '@spa/services'
import type { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

const confirmation = (userId: string) =>
  createHash('sha256').update(`ig-delete:${userId}`).digest('hex').slice(0, 16)

/**
 * Meta "Data deletion request" callback: removes the account's token and profile data, then returns the status URL +
 * confirmation code Meta shows to the person. Spa customer conversations belong to the spa and stay with it.
 */
export async function POST(req: NextRequest) {
  const cfg = metaConfig()
  if (!cfg) return new Response('Instagram is not configured', { status: 503 })
  const form = await req.formData().catch(() => null)
  const data = parseSignedRequest(String(form?.get('signed_request') ?? ''), cfg.appSecret)
  const userId = data?.user_id
  if (!data || (typeof userId !== 'string' && typeof userId !== 'number'))
    return new Response('Invalid request', { status: 400 })
  const cleared = await forgetInstagramUser(String(userId))
  // Nothing matched is still a valid answer (we hold no data for that id); log it so ops can check unexpected ids.
  if (!cleared) console.info('instagram data-deletion: no connected account matched the request')
  const code = confirmation(String(userId))
  return Response.json({ url: `${metaUrls().dataDeletion}?code=${code}`, confirmation_code: code })
}

/**
 * Status page for the confirmation code. Deletion runs synchronously above, so every issued code is processed; the
 * wording holds whether or not an account matched (the code doesn't say which).
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams
    .get('code')
    ?.replace(/[^a-f0-9]/g, '')
    .slice(0, 16)
  if (!code) return new Response('Missing confirmation code', { status: 400 })
  return new Response(
    `Deletion request ${code}: processed. spamanagement.ae no longer holds an Instagram access token or profile details for this account (any it held were removed when the request arrived).`,
    { headers: { 'content-type': 'text/plain; charset=utf-8' } },
  )
}
