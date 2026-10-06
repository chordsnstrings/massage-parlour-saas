// Cloudflare for SaaS: custom hostnames on our zone (PLAN §3.3). Configured with CF_API_TOKEN (Zone → SSL and
// Certificates: Edit, Zone → Custom Hostnames: Edit) and CF_ZONE_ID; CF_CNAME_TARGET is what customers CNAME to
// (e.g. customers.spamanagement.ae). Without the token + zone id every caller skips Cloudflare. Never log the token.

const API = 'https://api.cloudflare.com/client/v4'

export type CfConfig = { token: string; zoneId: string; fetch: typeof fetch }

/** Cloudflare settings from the environment, or null when custom hostnames aren't set up yet. */
export function cloudflareConfig(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): CfConfig | null {
  const token = env.CF_API_TOKEN?.trim()
  const zoneId = env.CF_ZONE_ID?.trim()
  if (!token || !zoneId) return null
  return { token, zoneId, fetch: fetchImpl }
}

export class CloudflareError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly codes: number[] = [],
  ) {
    super(message)
  }
}

/** Custom hostname as we mirror it: hostname status, certificate status and anything Cloudflare complains about. */
export type CfHostname = {
  id: string
  hostname: string
  status: string
  sslStatus: string | null
  /** Hostname and certificate are both live. */
  active: boolean
  /** Cloudflare gave up (blocked, moved, deleted or a timed-out certificate) — needs a person to look. */
  failed: boolean
  /** Optional pre-validation TXT record Cloudflare offers before the CNAME is in place. */
  ownership: { type: string; name: string; value: string } | null
  errors: string[]
}

type RawHostname = {
  id: string
  hostname: string
  status?: string
  ssl?: { status?: string; validation_errors?: { message?: string }[] } | null
  ownership_verification?: { type?: string; name?: string; value?: string } | null
  verification_errors?: string[]
}

const FAILED_STATUSES = new Set([
  'blocked',
  'moved',
  'deleted',
  'pending_deletion',
  'test_blocked',
  'test_failed',
])
const FAILED_SSL = new Set([
  'validation_timed_out',
  'issuance_timed_out',
  'deployment_timed_out',
  'deletion_timed_out',
  'deleted',
])

export function mapCfHostname(raw: RawHostname): CfHostname {
  const status = raw.status ?? 'pending'
  const sslStatus = raw.ssl?.status ?? null
  const errors = [
    ...(raw.verification_errors ?? []),
    ...(raw.ssl?.validation_errors ?? []).map((e) => e.message ?? '').filter(Boolean),
  ]
  const own = raw.ownership_verification
  return {
    id: raw.id,
    hostname: raw.hostname,
    status,
    sslStatus,
    active: status === 'active' && sslStatus === 'active',
    failed: FAILED_STATUSES.has(status) || (sslStatus !== null && FAILED_SSL.has(sslStatus)),
    ownership: own?.name && own.value ? { type: own.type ?? 'txt', name: own.name, value: own.value } : null,
    errors: [...new Set(errors)],
  }
}

type Envelope<T> = { success?: boolean; errors?: { code?: number; message?: string }[]; result?: T }

async function call<T>(cfg: CfConfig, method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await cfg.fetch(`${API}/zones/${encodeURIComponent(cfg.zoneId)}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${cfg.token}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    })
  } catch (error) {
    throw new CloudflareError(`Cloudflare could not be reached (${(error as Error).name})`, 0)
  }
  const json = (await res.json().catch(() => ({}))) as Envelope<T>
  if (!res.ok || json.success === false) {
    const errs = json.errors ?? []
    const message = errs
      .map((e) => e.message)
      .filter(Boolean)
      .join('; ')
    throw new CloudflareError(
      `Cloudflare: ${message || `HTTP ${res.status}`}`,
      res.status,
      errs.map((e) => e.code ?? 0),
    )
  }
  return json.result as T
}

/** Duplicate custom hostname (it already exists on our zone). */
const DUPLICATE = 1406
/** Certificate settings for every custom hostname: HTTP DCV, TLS ≥ 1.2. */
const SSL = { method: 'http', type: 'dv', settings: { min_tls_version: '1.2' } }

/** Creates the custom hostname (HTTP DCV certificate, TLS ≥ 1.2); returns the existing one if already there. */
export async function cfCreateHostname(cfg: CfConfig, hostname: string): Promise<CfHostname> {
  try {
    const raw = await call<RawHostname>(cfg, 'POST', '/custom_hostnames', { hostname, ssl: SSL })
    return mapCfHostname(raw)
  } catch (error) {
    if (error instanceof CloudflareError && error.codes.includes(DUPLICATE)) {
      const existing = await cfFindHostname(cfg, hostname)
      if (existing) return existing
    }
    throw error
  }
}

export async function cfGetHostname(cfg: CfConfig, id: string): Promise<CfHostname | null> {
  try {
    return mapCfHostname(await call<RawHostname>(cfg, 'GET', `/custom_hostnames/${encodeURIComponent(id)}`))
  } catch (error) {
    if (error instanceof CloudflareError && error.status === 404) return null
    throw error
  }
}

export async function cfFindHostname(cfg: CfConfig, hostname: string): Promise<CfHostname | null> {
  const rows = await call<RawHostname[]>(
    cfg,
    'GET',
    `/custom_hostnames?hostname=${encodeURIComponent(hostname)}`,
  )
  const hit = (rows ?? []).find((r) => r.hostname === hostname)
  return hit ? mapCfHostname(hit) : null
}

/** Deletes a custom hostname; a hostname that's already gone counts as deleted. */
export async function cfDeleteHostname(cfg: CfConfig, id: string): Promise<void> {
  try {
    await call<unknown>(cfg, 'DELETE', `/custom_hostnames/${encodeURIComponent(id)}`)
  } catch (error) {
    if (error instanceof CloudflareError && error.status === 404) return
    throw error
  }
}

/** Hostname states Cloudflare won't come back from on its own; a fresh hostname starts validation over. */
const RECREATE = new Set(['moved', 'deleted', 'pending_deletion', 'test_failed'])
/** Blocked by Cloudflare (abuse / high-risk) — only Cloudflare support can lift it, so retrying is pointless. */
const BLOCKED = new Set(['blocked', 'test_blocked'])

/**
 * Restarts a custom hostname Cloudflare gave up on: re-sends the certificate settings (a new validation for
 * timed-out certificates) or deletes and recreates a moved/deleted hostname. Blocked hostnames come back as-is.
 */
export async function cfRetryHostname(cfg: CfConfig, h: CfHostname): Promise<CfHostname> {
  if (!h.failed || BLOCKED.has(h.status)) return h
  if (RECREATE.has(h.status)) {
    await cfDeleteHostname(cfg, h.id)
    return cfCreateHostname(cfg, h.hostname)
  }
  const raw = await call<RawHostname>(cfg, 'PATCH', `/custom_hostnames/${encodeURIComponent(h.id)}`, {
    ssl: SSL,
  })
  return mapCfHostname(raw)
}
