import { forgetInstagramUser, integrationEnv, metaSigningSecrets, parseSignedRequest } from '@spa/services'
import type { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * Meta "Deauthorize callback": the account owner removed our app — drop the token everywhere. Signed by the Instagram
 * app (Instagram Login) or the Facebook app (Facebook Page connect) when that is a separate one.
 */
export async function POST(req: NextRequest) {
  const secrets = metaSigningSecrets(await integrationEnv())
  if (!secrets.length) return new Response('Instagram is not configured', { status: 503 })
  const form = await req.formData().catch(() => null)
  const data = parseSignedRequest(String(form?.get('signed_request') ?? ''), secrets)
  const userId = data?.user_id
  if (!data || (typeof userId !== 'string' && typeof userId !== 'number'))
    return new Response('Invalid request', { status: 400 })
  await forgetInstagramUser(String(userId))
  return Response.json({ ok: true })
}
