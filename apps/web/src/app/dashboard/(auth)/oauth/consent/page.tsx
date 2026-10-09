import { verifyOAuthQueryParams } from '@spa/auth'
import { oauthClient, platformDb, siteAiEditorStatus } from '@spa/db'
import { eq } from 'drizzle-orm'
import type { Metadata } from 'next'
import { AuthLayout } from '@/components/auth/auth-layout'
import { getT } from '@/i18n/server'
import { getSession } from '@/server/session'
import { ConsentForm } from './consent-form'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('auth.oauth.title') }
}

/**
 * OAuth consent for the Claude MCP connector (Better Auth MCP provider sends the browser here with a signed query).
 * Only SITE_AI_EDITOR_EMAILS super-admins with 2FA see Allow; the /oauth2/consent endpoint re-checks it (auth hook).
 */
export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const t = await getT()
  const session = await getSession()
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(await searchParams))
    for (const x of Array.isArray(v) ? v : v === undefined ? [] : [v]) params.append(k, x)
  const signed =
    Boolean(process.env.BETTER_AUTH_SECRET) &&
    (await verifyOAuthQueryParams(params.toString(), process.env.BETTER_AUTH_SECRET ?? '').catch(() => false))
  const clientId = params.get('client_id')
  // Sent here by the authorize hook (packages/auth) when the signed-in account may not connect Claude.
  if (session && params.get('not_enabled') === '1') {
    const status = await siteAiEditorStatus(platformDb(), session.user.id)
    return (
      <AuthLayout title={t('auth.oauth.title')}>
        <p className="mb-3 text-sm text-muted">{t('auth.oauth.account', { email: session.user.email })}</p>
        <p role="alert" className="rounded-xl border bg-subtle/50 p-3 text-sm">
          {status === 'needs2fa' ? t('auth.oauth.needs2fa') : t('auth.oauth.notEnabled')}
        </p>
      </AuthLayout>
    )
  }
  if (!session || !signed || !clientId)
    return (
      <AuthLayout title={t('auth.oauth.title')}>
        <p className="text-sm text-muted">{t('auth.oauth.expired')}</p>
      </AuthLayout>
    )
  const status = await siteAiEditorStatus(platformDb(), session.user.id)
  const [client] = await platformDb()
    .select({ name: oauthClient.name })
    .from(oauthClient)
    .where(eq(oauthClient.clientId, clientId))
    .limit(1)
  const name = client?.name?.trim() || 'Claude'
  return (
    <AuthLayout title={t('auth.oauth.title')} subtitle={t('auth.oauth.subtitle', { client: name })}>
      <div className="space-y-5">
        <p className="text-sm text-muted">{t('auth.oauth.account', { email: session.user.email })}</p>
        {status === 'ok' ? (
          <>
            <p className="text-sm">{t('auth.oauth.can')}</p>
            <ConsentForm />
          </>
        ) : (
          <p role="alert" className="rounded-xl border bg-subtle/50 p-3 text-sm">
            {status === 'needs2fa' ? t('auth.oauth.needs2fa') : t('auth.oauth.notEnabled')}
          </p>
        )}
      </div>
    </AuthLayout>
  )
}
