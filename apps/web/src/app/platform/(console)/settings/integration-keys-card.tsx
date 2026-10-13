import { platformDb } from '@spa/db'
import {
  facebookAppConfig,
  googleConfig,
  googleRedirectUri,
  type IntegrationKey,
  type IntegrationKeySource,
  type IntegrationKeysStatus,
  type IntegrationSecretKey,
  integrationKeySources,
  integrationKeysStatus,
  loadIntegrationKeys,
  metaConfig,
  metaUrls,
  resolveIntegrationEnv,
} from '@spa/services'
import { Badge } from '@/components/ui/badge'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { CopyButton } from '@/components/ui/copy-button'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { Checkbox, Input } from '@/components/ui/input'
import { allPlatformUrls, canonicalUrls } from '@/server/origin'
import { saveGoogleKeysAction, saveMetaKeysAction } from '../actions'

/** The Google Cloud APIs the platform calls (integrations/google.ts GOOGLE_ENDPOINTS). */
const GOOGLE_APIS = [
  'My Business Account Management API',
  'My Business Business Information API',
  'Google My Business API',
  'My Business Place Actions API',
  'Google Search Console API',
]

type Ctx = {
  status: IntegrationKeysStatus
  sources: Record<IntegrationKey, IntegrationKeySource>
}

function SourceNote({ k, ctx, missing }: { k: IntegrationKey; ctx: Ctx; missing: string }) {
  const source = ctx.sources[k]
  const secret = (ctx.status.secrets as Partial<IntegrationKeysStatus['secrets']>)[k as IntegrationSecretKey]
  const text =
    source === 'console'
      ? secret
        ? `From console ✓ (…${secret.last4 ?? '????'}). Leave blank to keep it.`
        : 'From console. Blank = fall back to the server setting.'
      : source === 'env'
        ? `From the server setting (${k}). A value saved here wins over it.`
        : `Missing. ${missing}`
  return (
    <span data-testid={`source-${k}`} data-source={source ?? 'missing'}>
      {secret?.has && source !== 'console'
        ? `The stored value can't be decrypted (encryption key changed?); enter it again. ${text}`
        : text}
    </span>
  )
}

function UrlList({ label, urls, testId }: { label: string; urls: string[]; testId: string }) {
  return (
    <div className="space-y-1.5" data-testid={testId}>
      <p className="text-[13px] text-muted">{label}</p>
      {urls.map((u) => (
        <div key={u} className="flex items-center gap-2">
          <code className="min-w-0 flex-1 break-all rounded-md border bg-subtle/60 px-2.5 py-2 font-mono text-xs">
            {u}
          </code>
          <CopyButton value={u} />
        </div>
      ))}
    </div>
  )
}

function RemoveBox({ k, ctx, label }: { k: IntegrationSecretKey; ctx: Ctx; label: string }) {
  if (!ctx.status.secrets[k].has) return null
  return (
    <label className="flex items-center gap-2.5 text-sm sm:col-span-2">
      <Checkbox name={`clear_${k}`} /> {label}
    </label>
  )
}

/**
 * R29: the Google and Meta app keys, next to the Resend + Turnstile cards. Each key: console value, else the server
 * env. Secrets are write-only (last 4 only). Lists what to register with Google / Meta (one redirect URI per platform
 * domain, since a sign-in stays on the domain it starts on).
 */
export async function IntegrationKeysCards() {
  const db = platformDb()
  const [status, saved] = await Promise.all([integrationKeysStatus(db), loadIntegrationKeys(db)])
  const env = resolveIntegrationEnv(saved)
  const ctx: Ctx = { status, sources: integrationKeySources(saved) }
  const origins = allPlatformUrls().map((u) => u.api(''))
  const meta = metaUrls(canonicalUrls().api(''))
  const google = googleConfig(env) !== null
  const metaOn = metaConfig(env) !== null
  const facebookOn = facebookAppConfig(env) !== null
  // Only one of the two Facebook keys: the other falls back to the Instagram one (a mixed pair Meta rejects).
  const facebookHalf = ['META_FB_APP_ID', 'META_FB_APP_SECRET'].filter((k) => env[k]?.trim()).length === 1
  const clientId = env.GOOGLE_CLIENT_ID?.trim()
  const oddClientId = clientId && !clientId.endsWith('.apps.googleusercontent.com')
  return (
    <>
      <Card data-testid="google-keys">
        <CardHeader
          title="Google"
          description="Google Business Profile (reviews, posts, the Book button) and Search Console sitemaps; spas connect from Settings → Instagram & Google. Values saved here win over GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in the server env, key by key. Without both, the spa card says Not configured yet."
          action={
            <Badge tone={google ? 'success' : 'warning'} data-testid="google-keys-status">
              {google ? 'configured' : 'not configured'}
            </Badge>
          }
        />
        <CardBody className="space-y-5">
          <ActionForm action={saveGoogleKeysAction} className="grid gap-5 sm:grid-cols-2">
            <Field
              label="Client ID"
              name="GOOGLE_CLIENT_ID"
              hint={
                <>
                  <SourceNote
                    k="GOOGLE_CLIENT_ID"
                    ctx={ctx}
                    missing="Google Cloud → APIs & Services → Credentials → OAuth client (Web application)."
                  />
                  {oddClientId && (
                    <span className="block text-warning" data-testid="google-client-id-warning">
                      A Google OAuth client ID usually ends with .apps.googleusercontent.com — check it was
                      copied whole.
                    </span>
                  )}
                </>
              }
            >
              <Input
                id="GOOGLE_CLIENT_ID"
                name="GOOGLE_CLIENT_ID"
                autoComplete="off"
                defaultValue={status.plain.GOOGLE_CLIENT_ID ?? ''}
                placeholder="1234…apps.googleusercontent.com"
              />
            </Field>
            <Field
              label="Client secret"
              name="GOOGLE_CLIENT_SECRET"
              hint={
                <SourceNote
                  k="GOOGLE_CLIENT_SECRET"
                  ctx={ctx}
                  missing="Shown next to the client ID in Google Cloud."
                />
              }
            >
              <Input
                id="GOOGLE_CLIENT_SECRET"
                name="GOOGLE_CLIENT_SECRET"
                type="password"
                autoComplete="off"
                placeholder="GOCSPX-…"
              />
            </Field>
            <RemoveBox
              k="GOOGLE_CLIENT_SECRET"
              ctx={ctx}
              label="Remove the stored client secret (fall back to env)"
            />
            <div className="sm:col-span-2">
              <SubmitButton>Save Google keys</SubmitButton>
            </div>
          </ActionForm>
          <div className="space-y-4 border-t pt-5">
            <UrlList
              label="Authorised redirect URIs (OAuth client → Web application), one per platform domain"
              urls={origins.map((o) => googleRedirectUri(o))}
              testId="google-redirect-uris"
            />
            <p className="text-[13px] text-muted">
              Enable in the same Google Cloud project: {GOOGLE_APIS.join(', ')}. OAuth consent screen:
              External, scopes business.manage and webmasters.
            </p>
          </div>
        </CardBody>
      </Card>
      <Card data-testid="meta-keys">
        <CardHeader
          title="Meta (Instagram & Facebook)"
          description="Instagram DMs, comments and publishing, and Facebook Pages (Premium). Values saved here win over META_APP_ID / META_APP_SECRET / META_WEBHOOK_VERIFY_TOKEN / META_FB_CONFIG_ID / META_FB_APP_ID / META_FB_APP_SECRET in the server env, key by key. Without the first three, the spa cards say Not configured. Facebook Page connect uses the Facebook App ID/secret when set, else the Instagram ones."
          action={
            <div className="flex flex-wrap justify-end gap-1.5">
              <Badge tone={metaOn ? 'success' : 'warning'} data-testid="meta-keys-status">
                {metaOn ? 'configured' : 'not configured'}
              </Badge>
              <Badge
                tone={facebookOn && !facebookHalf ? 'success' : 'warning'}
                data-testid="meta-fb-keys-status"
              >
                {facebookHalf
                  ? 'Facebook keys incomplete'
                  : facebookOn
                    ? 'Facebook configured'
                    : 'Facebook not configured'}
              </Badge>
            </div>
          }
        />
        <CardBody className="space-y-5">
          <ActionForm action={saveMetaKeysAction} className="grid gap-5 sm:grid-cols-2">
            <Field
              label="Instagram app ID"
              name="META_APP_ID"
              hint={
                <SourceNote
                  k="META_APP_ID"
                  ctx={ctx}
                  missing="Instagram → API setup with Instagram login → Business login settings → Instagram app ID (not the Facebook App ID under App settings → Basic)."
                />
              }
            >
              <Input
                id="META_APP_ID"
                name="META_APP_ID"
                autoComplete="off"
                inputMode="numeric"
                defaultValue={status.plain.META_APP_ID ?? ''}
              />
            </Field>
            <Field
              label="Instagram app secret"
              name="META_APP_SECRET"
              hint={
                <SourceNote
                  k="META_APP_SECRET"
                  ctx={ctx}
                  missing="Same place → Instagram app secret (also checks webhook signatures)."
                />
              }
            >
              <Input id="META_APP_SECRET" name="META_APP_SECRET" type="password" autoComplete="off" />
            </Field>
            <Field
              label="Webhook verify token"
              name="META_WEBHOOK_VERIFY_TOKEN"
              hint={
                <SourceNote
                  k="META_WEBHOOK_VERIFY_TOKEN"
                  ctx={ctx}
                  missing="Any random string; enter the same one in the app's webhook settings."
                />
              }
            >
              <Input
                id="META_WEBHOOK_VERIFY_TOKEN"
                name="META_WEBHOOK_VERIFY_TOKEN"
                type="password"
                autoComplete="off"
              />
            </Field>
            <Field
              label="Facebook Login for Business config ID (optional)"
              name="META_FB_CONFIG_ID"
              hint={
                <SourceNote
                  k="META_FB_CONFIG_ID"
                  ctx={ctx}
                  missing="Optional: without it, Facebook Login asks for the Page + Instagram permissions directly."
                />
              }
            >
              <Input
                id="META_FB_CONFIG_ID"
                name="META_FB_CONFIG_ID"
                autoComplete="off"
                inputMode="numeric"
                defaultValue={status.plain.META_FB_CONFIG_ID ?? ''}
              />
            </Field>
            <Field
              label="Facebook App ID (for Facebook Page connect; leave empty when it is the same app)"
              name="META_FB_APP_ID"
              hint={
                <SourceNote
                  k="META_FB_APP_ID"
                  ctx={ctx}
                  missing="Optional: App settings → Basic → App ID. Empty = Facebook Login uses the Instagram app ID above."
                />
              }
            >
              <Input
                id="META_FB_APP_ID"
                name="META_FB_APP_ID"
                autoComplete="off"
                inputMode="numeric"
                defaultValue={status.plain.META_FB_APP_ID ?? ''}
              />
            </Field>
            <Field
              label="Facebook App secret"
              name="META_FB_APP_SECRET"
              hint={
                <SourceNote
                  k="META_FB_APP_SECRET"
                  ctx={ctx}
                  missing="Optional: App settings → Basic → App secret. Empty = the Instagram app secret above."
                />
              }
            >
              <Input id="META_FB_APP_SECRET" name="META_FB_APP_SECRET" type="password" autoComplete="off" />
            </Field>
            <RemoveBox
              k="META_APP_SECRET"
              ctx={ctx}
              label="Remove the stored Instagram app secret (fall back to env)"
            />
            <RemoveBox
              k="META_WEBHOOK_VERIFY_TOKEN"
              ctx={ctx}
              label="Remove the stored verify token (fall back to env)"
            />
            <RemoveBox
              k="META_FB_APP_SECRET"
              ctx={ctx}
              label="Remove the stored Facebook App secret (fall back to env)"
            />
            <div className="sm:col-span-2">
              <SubmitButton>Save Meta keys</SubmitButton>
            </div>
          </ActionForm>
          <div className="space-y-4 border-t pt-5">
            <UrlList
              label="Valid OAuth redirect URIs (Instagram business login + Facebook Login for Business), one per platform domain"
              urls={origins.flatMap((o) => [metaUrls(o).callback, metaUrls(o).facebookCallback])}
              testId="meta-redirect-uris"
            />
            <UrlList
              label="Webhook callback URL (subscribe to messages and comments)"
              urls={[meta.webhook]}
              testId="meta-webhook-url"
            />
            <UrlList
              label="Deauthorize callback URL"
              urls={[meta.deauthorize]}
              testId="meta-deauthorize-url"
            />
            <UrlList
              label="Data deletion request URL"
              urls={[meta.dataDeletion]}
              testId="meta-data-deletion-url"
            />
          </div>
        </CardBody>
      </Card>
    </>
  )
}
