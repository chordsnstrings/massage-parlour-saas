// Production config health (G9, console overview): which settings are present. Booleans + non-secret hints only:
// a value is never returned.
import { type ResolvedTurnstile, resolveTurnstile, turnstileStatusText } from './turnstile'

type Env = Record<string, string | undefined>

export type ConfigCheck = {
  key: string
  label: string
  ok: boolean
  /** Red when missing (otherwise amber: the feature is simply off). */
  required: boolean
  /** Non-secret hint, e.g. "R2" or "invalid length". */
  detail?: string
  /** What breaks without it. */
  effect: string
}

const set = (env: Env, ...keys: string[]) => keys.every((k) => Boolean(env[k]?.trim()))

/** Off-site backup bucket the worker would use (mirrors apps/worker offsiteConfig). */
export function backupBucketSource(env: Env): 'R2' | 'S3' | null {
  const r2 = ['R2_ENDPOINT', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']
  if (r2.some((k) => env[k])) return set(env, ...r2) ? 'R2' : null
  return set(env, 'S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY') ? 'S3' : null
}

function encryptionKey(env: Env): { ok: boolean; detail?: string } {
  const raw = env.APP_ENCRYPTION_KEY?.trim()
  if (!raw) return { ok: false, detail: 'derived from BETTER_AUTH_SECRET' }
  let bytes = 0
  try {
    bytes = atob(raw).length
  } catch {}
  return bytes === 32 ? { ok: true } : { ok: false, detail: 'not 32 bytes base64' }
}

/** R29: where a Google / Meta key comes from (console, server env, or nowhere). */
export type KeySource = 'console' | 'env' | null

/** "from console" / "from env" / "from console + env" for the keys that are set. */
const sourceDetail = (sources: Record<string, KeySource> | undefined, keys: string[]) => {
  const found = [...new Set(keys.map((k) => sources?.[k]).filter(Boolean))]
  return found.length ? `from ${found.join(' + ')}` : undefined
}

/**
 * Facebook Page connect (F19): App 2's own Facebook App ID + secret (services `facebookAppConfig`, no fallback to the
 * Instagram app's keys, R29: the Facebook dialog rejects them). Needs the Instagram keys too (the Page-linked account's
 * DMs, comments and publishing run through them); only one of the two Facebook keys is a warning.
 */
function facebookApp(env: Env, sources: Record<string, KeySource> | undefined) {
  const own = ['META_FB_APP_ID', 'META_FB_APP_SECRET'].filter((k) => env[k]?.trim())
  const instagram = set(env, 'META_APP_ID', 'META_APP_SECRET', 'META_WEBHOOK_VERIFY_TOKEN')
  const detail =
    own.length === 1
      ? 'incomplete: set both Facebook App ID and secret'
      : own.length && !instagram
        ? 'needs the Instagram keys too (META_* row)'
        : own.length
          ? ['own Facebook app', sourceDetail(sources, own)].filter(Boolean).join(', ')
          : undefined
  return { ok: own.length === 2 && instagram, detail }
}

/** Read by the web app only: the worker's heartbeat flags leave these out (no false "worker sees it missing"). */
const WEB_ONLY = new Set(['TURNSTILE'])

/**
 * Every production setting except the Resend key (shown on its own with its source). `turnstile`: the console-aware
 * resolution (web console); without it the bot-check row reads env only (the worker's heartbeat flags). Google + Meta
 * keys (R29): pass the resolved record (`integrationEnv()`) as `env`; `keySources` adds where they come from.
 */
export function configChecks(
  env: Env = process.env,
  opts: { turnstile?: ResolvedTurnstile; keySources?: Record<string, KeySource> } = {},
): ConfigCheck[] {
  const backup = backupBucketSource(env)
  const turnstile = opts.turnstile ?? resolveTurnstile(null, env)
  const enc = encryptionKey(env)
  return [
    {
      key: 'backups',
      label: 'Off-site backups (R2_* / S3_*)',
      ok: Boolean(backup),
      required: true,
      detail: backup === 'S3' ? 'S3 file bucket fallback' : (backup ?? undefined),
      effect: 'No off-site database backup or restore drill.',
    },
    {
      key: 'APP_ENCRYPTION_KEY',
      label: 'APP_ENCRYPTION_KEY',
      ok: enc.ok,
      required: true,
      detail: enc.detail,
      effect: 'Integration tokens are encrypted with a key derived from the auth secret.',
    },
    {
      key: 'SENTRY_DSN',
      label: 'SENTRY_DSN',
      ok: set(env, 'SENTRY_DSN'),
      required: true,
      effect: 'Server and worker errors are not reported anywhere.',
    },
    {
      key: 'ARK_API_KEY',
      label: 'ARK_API_KEY (AI)',
      ok: set(env, 'ARK_API_KEY'),
      required: true,
      effect: 'AI features (content, replies, insights) are unavailable.',
    },
    {
      // F9: unset = public forms stay open (honeypot + per-IP limits only), so spas are never locked out.
      key: 'TURNSTILE',
      label: 'TURNSTILE_* (bot check)',
      ok: Boolean(turnstile.config),
      required: true,
      detail: turnstileStatusText(turnstile),
      effect:
        'Online booking, the booking widget, Apply and Contact have no bot check (honeypot + rate limits only).',
    },
    {
      key: 'VAPID',
      label: 'VAPID keys (push)',
      ok: set(env, 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'),
      required: false,
      effect: 'No browser push notifications for staff.',
    },
    {
      key: 'META',
      label: 'META_* (Instagram)',
      ok: set(env, 'META_APP_ID', 'META_APP_SECRET', 'META_WEBHOOK_VERIFY_TOKEN'),
      required: false,
      detail: sourceDetail(opts.keySources, ['META_APP_ID', 'META_APP_SECRET', 'META_WEBHOOK_VERIFY_TOKEN']),
      effect: 'Spas cannot connect Instagram.',
    },
    {
      key: 'META_FB',
      label: 'META_FB_APP_* (Facebook Page connect)',
      ...facebookApp(env, opts.keySources),
      required: false,
      effect: 'Spas cannot connect a Facebook Page.',
    },
    {
      key: 'GOOGLE',
      label: 'GOOGLE_* (sign-in, Business Profile)',
      ok: set(env, 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'),
      required: false,
      detail: sourceDetail(opts.keySources, ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']),
      effect: 'No Google sign-in or Business Profile reviews.',
    },
    {
      key: 'STRIPE',
      label: 'STRIPE_SECRET_KEY (platform invoices)',
      ok: set(env, 'STRIPE_SECRET_KEY'),
      required: false,
      effect: 'Platform invoices can only be paid by cash / bank transfer.',
    },
  ]
}

/** Presence flags only — what the worker reports in its heartbeat (worker-side env may differ from web). */
export const configFlags = (env: Env = process.env): Record<string, boolean> =>
  Object.fromEntries([
    ...configChecks(env)
      .filter((c) => !WEB_ONLY.has(c.key))
      .map((c) => [c.key, c.ok] as const),
    ['RESEND_API_KEY', set(env, 'RESEND_API_KEY')] as const,
  ])

/** pg_roles attributes of the restore-drill role (F11). */
export type DrillRole = {
  rolsuper: boolean
  rolcreatedb: boolean
  rolcreaterole: boolean
  rolbypassrls: boolean
  rolreplication: boolean
}

/**
 * F11: why a role must not run the restore drill (least privilege: CREATEDB, nothing more), or null when it is fit.
 * The worker refuses to run on a problem; the console Configuration card shows it for `spa_drill`.
 */
export function drillRoleProblem(r: DrillRole | null | undefined): string | null {
  if (!r) return 'role missing'
  const extra = [
    r.rolsuper && 'SUPERUSER',
    r.rolcreaterole && 'CREATEROLE',
    r.rolbypassrls && 'BYPASSRLS',
    r.rolreplication && 'REPLICATION',
  ].filter(Boolean)
  if (extra.length) return `has ${extra.join(', ')}`
  return r.rolcreatedb ? null : 'no CREATEDB'
}
