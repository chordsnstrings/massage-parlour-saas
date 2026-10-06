import { forgetInstagramUser, metaConfig, parseSignedRequest } from '@spa/services'
import type { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

/** Meta "Deauthorize callback": the account owner removed our app — drop the token everywhere. */
export async function POST(req: NextRequest) {
  const cfg = metaConfig()
  if (!cfg) return new Response('Instagram is not configured', { status: 503 })
  const form = await req.formData().catch(() => null)
  const data = parseSignedRequest(String(form?.get('signed_request') ?? ''), cfg.appSecret)
  const userId = data?.user_id
  if (!data || (typeof userId !== 'string' && typeof userId !== 'number'))
    return new Response('Invalid request', { status: 400 })
  await forgetInstagramUser(String(userId))
  return Response.json({ ok: true })
}
