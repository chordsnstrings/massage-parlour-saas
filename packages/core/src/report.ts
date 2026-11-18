// Error reporting without an SDK: builds a Sentry-compatible envelope and POSTs it when a DSN is configured.
// Used by the web server (instrumentation onRequestError), the client error boundary (via /api/client-error)
// and the worker. Never throws — reporting must not break the request it reports on.

export type ReportContext = {
  /** e.g. 'web', 'web-client', 'worker' */
  source: string
  tags?: Record<string, string | undefined>
  extra?: Record<string, unknown>
  request?: { url?: string; method?: string }
  environment?: string
  release?: string
}

type Dsn = { endpoint: string; publicKey: string }

export function parseDsn(dsn: string | undefined | null): Dsn | null {
  if (!dsn) return null
  try {
    const u = new URL(dsn)
    const projectId = u.pathname.split('/').filter(Boolean).pop()
    if (!u.username || !projectId) return null
    const prefix = u.pathname.slice(0, u.pathname.lastIndexOf('/'))
    return { endpoint: `${u.protocol}//${u.host}${prefix}/api/${projectId}/envelope/`, publicKey: u.username }
  } catch {
    return null
  }
}

/** Parses a V8 stack into Sentry frames (oldest first, as Sentry expects). */
export function stackFrames(stack: string | undefined) {
  if (!stack) return []
  const frames: { function?: string; filename?: string; lineno?: number; colno?: number; in_app: boolean }[] =
    []
  for (const line of stack.split('\n').slice(1, 40)) {
    const m = /^\s*at (?:(.+?) \()?(.*?):(\d+):(\d+)\)?\s*$/.exec(line)
    if (!m) continue
    const filename = m[2]
    frames.push({
      function: m[1] || '<anonymous>',
      filename,
      lineno: Number(m[3]),
      colno: Number(m[4]),
      in_app: !/node_modules|node:internal/.test(filename ?? ''),
    })
  }
  return frames.reverse()
}

/** Drops query strings (they can carry tokens) and keeps only scheme/host/path. */
const scrubUrl = (url: string | undefined) => {
  if (!url) return undefined
  try {
    const u = new URL(url, 'http://local')
    return u.origin === 'http://local' ? u.pathname : `${u.origin}${u.pathname}`
  } catch {
    return undefined
  }
}

export function buildEvent(err: unknown, ctx: ReportContext, eventId: string) {
  const e = err instanceof Error ? err : new Error(typeof err === 'string' ? err : JSON.stringify(err))
  const digest =
    typeof err === 'object' && err !== null && 'digest' in err
      ? String((err as { digest: unknown }).digest)
      : undefined
  const tags = Object.fromEntries(
    Object.entries({ source: ctx.source, digest, ...ctx.tags }).filter(([, v]) => v !== undefined),
  )
  return {
    event_id: eventId,
    timestamp: Date.now() / 1000,
    platform: ctx.source === 'web-client' ? 'javascript' : 'node',
    level: 'error',
    environment: ctx.environment ?? 'production',
    release: ctx.release,
    tags,
    extra: ctx.extra,
    request: ctx.request ? { url: scrubUrl(ctx.request.url), method: ctx.request.method } : undefined,
    exception: {
      values: [
        {
          type: e.name || 'Error',
          value: e.message.slice(0, 2000),
          stacktrace: { frames: stackFrames(e.stack) },
        },
      ],
    },
  }
}

export async function reportError(dsnValue: string | undefined | null, err: unknown, ctx: ReportContext) {
  const dsn = parseDsn(dsnValue)
  if (!dsn) return false
  try {
    const eventId = crypto.randomUUID().replace(/-/g, '')
    const event = buildEvent(err, ctx, eventId)
    const body = [
      JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString(), dsn: dsnValue }),
      JSON.stringify({ type: 'event' }),
      JSON.stringify(event),
    ].join('\n')
    const res = await fetch(dsn.endpoint, {
      method: 'POST',
      body,
      headers: {
        'content-type': 'application/x-sentry-envelope',
        'x-sentry-auth': `Sentry sentry_version=7, sentry_key=${dsn.publicKey}, sentry_client=spamanagement/1.0`,
      },
      signal: AbortSignal.timeout(3000),
    })
    return res.ok
  } catch {
    return false
  }
}
