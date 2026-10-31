// F9 (G17): Cloudflare Turnstile bot check for public, unauthenticated forms (booking page + widget, apply, contact).
// The widget runs in the visitor's browser (components/turnstile.tsx); the server verifies its single-use token here.
type Env = Record<string, string | undefined>

export const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
/** Form field the client sends the token in (Turnstile's own default name). */
export const TURNSTILE_FIELD = 'cf-turnstile-response'

export type TurnstileConfig = { siteKey: string; secretKey: string }

/** Both keys set → bot checks on; anything less → off (the console Configuration card flags it red in production). */
export function turnstileConfig(env: Env = process.env): TurnstileConfig | null {
  const siteKey = env.TURNSTILE_SITE_KEY?.trim()
  const secretKey = env.TURNSTILE_SECRET_KEY?.trim()
  return siteKey && secretKey ? { siteKey, secretKey } : null
}

/** Custom spa domains need adding to the widget's hostname list first, so they opt in (`TURNSTILE_CUSTOM_DOMAINS=on`). */
export const turnstileOnCustomDomains = (env: Env = process.env) =>
  ['on', '1', 'true'].includes(env.TURNSTILE_CUSTOM_DOMAINS?.trim().toLowerCase() ?? '')

/** Keys + switch saved in the super-admin console (platform_settings; secret already decrypted). Null = not set there. */
export type TurnstileSettings = {
  siteKey?: string | null
  secretKey?: string | null
  customDomains?: boolean | null
}

export type SettingSource = 'console' | 'env' | 'missing'

export type ResolvedTurnstile = {
  /** Both keys present → bot checks on. */
  config: TurnstileConfig | null
  customDomains: boolean
  siteKeySource: SettingSource
  secretKeySource: SettingSource
  customDomainsSource: 'console' | 'env'
}

/** Console values win over env, each setting on its own (owner, 2026-10-09: keys are entered in the console). */
export function resolveTurnstile(
  saved: TurnstileSettings | null | undefined,
  env: Env = process.env,
): ResolvedTurnstile {
  const pick = (db: string | null | undefined, envKey: string): [string | null, SettingSource] => {
    const fromDb = db?.trim()
    if (fromDb) return [fromDb, 'console']
    const fromEnv = env[envKey]?.trim()
    return fromEnv ? [fromEnv, 'env'] : [null, 'missing']
  }
  const [siteKey, siteKeySource] = pick(saved?.siteKey, 'TURNSTILE_SITE_KEY')
  const [secretKey, secretKeySource] = pick(saved?.secretKey, 'TURNSTILE_SECRET_KEY')
  const consoleSwitch = typeof saved?.customDomains === 'boolean'
  return {
    config: siteKey && secretKey ? { siteKey, secretKey } : null,
    customDomains: consoleSwitch ? Boolean(saved?.customDomains) : turnstileOnCustomDomains(env),
    siteKeySource,
    secretKeySource,
    customDomainsSource: consoleSwitch ? 'console' : 'env',
  }
}

/** Configuration-card text for the bot check row: where each key comes from (never a value). */
export function turnstileStatusText(r: ResolvedTurnstile): string {
  if (!r.config) {
    if (r.siteKeySource === 'missing' && r.secretKeySource === 'missing') return 'keys missing'
    return r.siteKeySource === 'missing' ? 'site key missing' : 'secret key missing'
  }
  const src =
    r.siteKeySource === r.secretKeySource
      ? `from ${r.siteKeySource}`
      : `site key from ${r.siteKeySource}, secret from ${r.secretKeySource}`
  return `${src} · ${r.customDomains ? 'incl. custom domains' : 'platform hosts (custom domains off)'}`
}

export type TurnstileVerdict = { ok: boolean; codes: string[] }

/**
 * Server-side siteverify. Fails closed: a missing/oversized token, a non-200 answer, a network error or timeout, or
 * an action other than the one the widget was rendered with all return `ok: false`.
 */
export async function verifyTurnstileToken(opts: {
  secretKey: string
  token: unknown
  remoteIp?: string | null
  /** Widget `action` to expect; Cloudflare's test keys answer without one, so an empty action is accepted. */
  action?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}): Promise<TurnstileVerdict> {
  const { token } = opts
  if (typeof token !== 'string' || !token.trim()) return { ok: false, codes: ['missing-input-response'] }
  // Cloudflare: tokens are at most 2048 characters.
  if (token.length > 2048) return { ok: false, codes: ['invalid-input-response'] }
  const body = new URLSearchParams({ secret: opts.secretKey, response: token })
  if (opts.remoteIp && opts.remoteIp !== 'unknown') body.set('remoteip', opts.remoteIp)
  try {
    const res = await (opts.fetchImpl ?? fetch)(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
    })
    if (!res.ok) return { ok: false, codes: [`http-${res.status}`] }
    const data = (await res.json()) as { success?: boolean; action?: string; 'error-codes'?: string[] }
    const codes = data['error-codes'] ?? []
    if (data.success !== true) return { ok: false, codes }
    if (opts.action && data.action && data.action !== opts.action)
      return { ok: false, codes: ['action-mismatch'] }
    return { ok: true, codes }
  } catch (e) {
    return {
      ok: false,
      codes: [e instanceof Error && e.name === 'TimeoutError' ? 'timeout' : 'network-error'],
    }
  }
}
