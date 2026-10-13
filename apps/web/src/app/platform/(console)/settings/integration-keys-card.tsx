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
import { canonicalUrls } from '@/server/origin'
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

/** Label → URL rows with copy buttons (R29: what goes where in each Meta app). */
function UrlRows({ rows }: { rows: { label: string; url: string; testId: string }[] }) {
  return (
    <dl className="space-y-2">
      {rows.map((r) => (
        <div key={r.testId} data-testid={r.testId} className="space-y-1">
          <dt className="text-[13px] text-muted">{r.label}</dt>
          <dd className="flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-md border bg-subtle/60 px-2.5 py-1.5 font-mono text-xs">
              {r.url}
            </code>
            <CopyButton value={r.url} />
          </dd>
        </div>
      ))}
    </dl>
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
 * env. Secrets are write-only (last 4 only). Lists what to register with Google / Meta: canonical-domain URLs only (old
 * platform domains redirect there, so every connect starts on it).
 */
export async function IntegrationKeysCards() {
  const db = platformDb()
  const [status, saved] = await Promise.all([integrationKeysStatus(db), loadIntegrationKeys(db)])
  const env = resolveIntegrationEnv(saved)
  const ctx: Ctx = { status, sources: integrationKeySources(saved) }
  const origin = canonicalUrls().api('')
  const meta = metaUrls(origin)
  // App Domains: the canonical platform root (no port, no scheme).
  const rootDomain = new URL(canonicalUrls().marketing()).hostname
  const google = googleConfig(env) !== null
  const metaOn = metaConfig(env) !== null
  const facebookOn = facebookAppConfig(env) !== null
  // Only one of the two App 2 keys (no fallback to App 1's: the Facebook dialog rejects them).
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
              label="Authorised redirect URI (OAuth client → Web application)"
              urls={[googleRedirectUri(origin)]}
              testId="google-redirect-uris"
            />
            <p className="text-[13px] text-muted">
              Enable in the same Google Cloud project: {GOOGLE_APIS.join(', ')}. OAuth consent screen:
              External and published (In production; never onboard spas while it is in Testing), scopes
              business.manage, webmasters, openid and email; JavaScript origins empty. Keep this OAuth client:
              spas&apos; refresh tokens belong to it, so rotate only its secret.
            </p>
          </div>
        </CardBody>
      </Card>
      <Card data-testid="meta-keys">
        <CardHeader
          title="Meta (Instagram & Facebook)"
          description="Instagram DMs, comments and publishing, and Facebook Pages (Premium), for every spa through two Meta apps: a Meta app holds only one Instagram setup, so App 1 = Instagram API with Instagram login, App 2 = Facebook Login for Business. Values saved here win over META_APP_ID / META_APP_SECRET / META_WEBHOOK_VERIFY_TOKEN (App 1) and META_FB_APP_ID / META_FB_APP_SECRET / META_FB_CONFIG_ID (App 2) in the server env, key by key. Without App 1's three, the spa cards say Not configured."
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
                  missing="App 1 → Instagram → API setup with Instagram login → Business login settings → Instagram app ID (not the App ID under App settings → Basic)."
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
                  missing="App 1, same place → Instagram app secret (also checks webhook signatures)."
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
                  missing="Any random string; enter the same one in both apps' Webhooks settings."
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
              label="Facebook Login for Business config ID (App 2, optional)"
              name="META_FB_CONFIG_ID"
              hint={
                <SourceNote
                  k="META_FB_CONFIG_ID"
                  ctx={ctx}
                  missing="App 2 → Facebook Login for Business → Configurations → token type User access token → its ID. Without it, the dialog asks for the Page + Instagram permissions directly."
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
              label="Facebook App ID (App 2)"
              name="META_FB_APP_ID"
              hint={
                <SourceNote
                  k="META_FB_APP_ID"
                  ctx={ctx}
                  missing="App 2 → App settings → Basic → App ID. Needed for Facebook Page connect: the Facebook dialog doesn't take the Instagram app ID."
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
              label="Facebook App secret (App 2)"
              name="META_FB_APP_SECRET"
              hint={
                <SourceNote
                  k="META_FB_APP_SECRET"
                  ctx={ctx}
                  missing="App 2 → App settings → Basic → App secret (also checks its webhook signatures)."
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
          <div className="space-y-5 border-t pt-5 text-[13px]" data-testid="meta-setup">
            <p className="text-muted">
              Both apps: App settings → Basic → App Domains <code className="font-mono">{rootDomain}</code>;
              Strict Mode and Enforce HTTPS on; JavaScript SDK off. Paste each URL exactly — check Meta didn't
              add a trailing slash.
            </p>
            <div className="space-y-2" data-testid="meta-app-1">
              <p className="font-medium">
                App 1 · Instagram (Instagram API with Instagram login → Business login settings) → Instagram
                app ID, Instagram app secret, Webhook verify token
              </p>
              <UrlRows
                rows={[
                  { label: 'OAuth redirect URI', url: meta.callback, testId: 'meta-redirect-uris' },
                  {
                    label: 'Deauthorize callback URL',
                    url: meta.deauthorize,
                    testId: 'meta-deauthorize-url',
                  },
                  {
                    label: 'Data deletion request URL',
                    url: meta.dataDeletion,
                    testId: 'meta-data-deletion-url',
                  },
                  {
                    label: 'Webhooks callback URL + the verify token above (fields: messages, comments)',
                    url: meta.webhook,
                    testId: 'meta-webhook-url',
                  },
                ]}
              />
            </div>
            <div className="space-y-2" data-testid="meta-app-2">
              <p className="font-medium">
                App 2 · Facebook (Facebook Login for Business → Settings) → Facebook App ID, Facebook App
                secret, config ID
              </p>
              <UrlRows
                rows={[
                  {
                    label: 'Valid OAuth Redirect URIs',
                    url: meta.facebookCallback,
                    testId: 'meta-fb-redirect-uri',
                  },
                  {
                    label: 'Deauthorize callback URL (same)',
                    url: meta.deauthorize,
                    testId: 'meta-fb-deauthorize-url',
                  },
                  {
                    label: 'Data deletion request URL (same)',
                    url: meta.dataDeletion,
                    testId: 'meta-fb-data-deletion-url',
                  },
                  {
                    label:
                      'Webhooks → Instagram: same callback URL + same verify token (fields: messages, comments)',
                    url: meta.webhook,
                    testId: 'meta-fb-webhook-url',
                  },
                ]}
              />
              <p className="text-muted">
                Settings: Client OAuth login and Web OAuth login on, embedded browser OAuth login off.
                Configurations: one with token type User access token (Page + Instagram permissions); its ID
                goes into the config ID box.
              </p>
            </div>
          </div>
        </CardBody>
      </Card>
    </>
  )
}
