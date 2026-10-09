// Production config health (G9, console overview): which settings are present. Booleans + non-secret hints only:
// a value is never returned.
import { turnstileOnCustomDomains } from './turnstile'

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

function turnstileDetail(env: Env) {
  const site = set(env, 'TURNSTILE_SITE_KEY')
  const secret = set(env, 'TURNSTILE_SECRET_KEY')
  if (site !== secret) return site ? 'secret key missing' : 'site key missing'
  if (!site) return undefined
  return turnstileOnCustomDomains(env) ? 'incl. custom domains' : 'platform hosts (custom domains off)'
}

/** Read by the web app only: the worker's heartbeat flags leave these out (no false "worker sees it missing"). */
const WEB_ONLY = new Set(['TURNSTILE'])

/** Every production setting except the Resend key (shown on its own with its source). */
export function configChecks(env: Env = process.env): ConfigCheck[] {
  const backup = backupBucketSource(env)
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
      ok: set(env, 'TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY'),
      required: true,
      detail: turnstileDetail(env),
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
      effect: 'Spas cannot connect Instagram.',
    },
    {
      key: 'GOOGLE',
      label: 'GOOGLE_* (sign-in, Business Profile)',
      ok: set(env, 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'),
      required: false,
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
