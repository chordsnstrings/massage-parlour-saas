// SSRF-guarded HTTP GET for the Studio site import (F32): the server fetches a spa's existing public website, so the
// address is attacker-controllable. Rules, re-checked on every redirect hop:
//   - http / https only, no credentials in the URL, default ports (80 / 443) only;
//   - every address the hostname resolves to must be public (no loopback, private, link-local, CGNAT, multicast,
//     metadata, IPv4-mapped/NAT64/6to4 tricks — `isPrivateAddress`); literal IPs are checked the same way;
//   - the connection is PINNED to the address that was checked (custom `lookup` on the socket), so a DNS-rebinding
//     host can't answer "public" to the check and "127.0.0.1" to the connect;
//   - overall deadline, response size cap while streaming (after decompression), at most 4 redirects.
import { lookup as dnsLookup } from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import type { LookupFunction } from 'node:net'
import { isIP } from 'node:net'
import zlib from 'node:zlib'
import { DomainError } from '../errors'
import { isPrivateAddress } from '../media'

export class ImportFetchError extends DomainError {}
/** The address itself is refused (scheme, credentials, port, private network) — not a network failure. */
export class ImportBlockedError extends ImportFetchError {}

export type ResolvedAddress = { address: string; family: 4 | 6 }
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>

export type SafeFetchOpts = {
  /** Hostname → addresses (default: the system resolver). Called once per hop; the socket uses its answer. */
  resolve?: Resolver
  /**
   * Exact `host:port` pairs exempt from the address and port rules — unit tests and the Playwright fixture server only
   * (web: `SITE_IMPORT_E2E_ALLOW`, never set in deploy env).
   */
  allow?: string[]
  /** Test seam: which resolved addresses are refused (default `isPrivateAddress`). */
  isBlocked?: (ip: string) => boolean
  /** Test seam: allowed ports (default 80 and 443). */
  ports?: number[]
  timeoutMs?: number
  maxBytes?: number
  maxRedirects?: number
  accept?: string
}

export type SafeResponse = {
  /** Final URL after redirects. */
  url: string
  status: number
  contentType: string
  /** Charset named by the Content-Type header, if any. */
  charset: string | null
  body: Buffer
}

export const IMPORT_USER_AGENT =
  'Mozilla/5.0 (compatible; SpaManagementBot/1.0; +https://spamanagement.co) site import'
/** Product token matched against robots.txt groups. */
export const IMPORT_BOT_TOKEN = 'SpaManagementBot'

const systemResolve: Resolver = async (hostname) =>
  (await dnsLookup(hostname, { all: true, verbatim: true })).map((a) => ({
    address: a.address,
    family: a.family === 6 ? 6 : 4,
  }))

/** Validates one hop and returns the address to connect to. */
async function checkHop(u: URL, o: SafeFetchOpts): Promise<ResolvedAddress> {
  if (u.protocol !== 'http:' && u.protocol !== 'https:')
    throw new ImportBlockedError('Only http:// and https:// addresses can be imported')
  if (u.username || u.password)
    throw new ImportBlockedError('Addresses with a user name or password aren’t allowed')
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80))
  const exempt = (o.allow ?? []).includes(`${host}:${port}`)
  if (!exempt && !(o.ports ?? [80, 443]).includes(port))
    throw new ImportBlockedError('That address uses a non-standard port')
  if (!host) throw new ImportBlockedError('That address isn’t valid')
  let addresses: ResolvedAddress[]
  const literal = isIP(host)
  if (literal) addresses = [{ address: host, family: literal === 6 ? 6 : 4 }]
  else {
    try {
      addresses = await (o.resolve ?? systemResolve)(host)
    } catch {
      throw new ImportFetchError(`Couldn’t find the site ${host}`)
    }
  }
  if (!addresses.length) throw new ImportFetchError(`Couldn’t find the site ${host}`)
  const blocked = o.isBlocked ?? isPrivateAddress
  // Any private answer refuses the whole host (a mixed answer is a rebinding / split-horizon setup).
  if (!exempt && addresses.some((a) => blocked(a.address)))
    throw new ImportBlockedError(
      'That address points to a private network — only public websites can be imported',
    )
  return addresses[0]!
}

type Raw = { status: number; headers: http.IncomingHttpHeaders; body: Buffer }

function request(u: URL, pinned: ResolvedAddress, o: SafeFetchOpts, signal: AbortSignal, maxBytes: number) {
  const mod = u.protocol === 'https:' ? https : http
  const host = u.hostname.replace(/^\[|\]$/g, '')
  // The socket connects to the checked address only, whatever the resolver would say now.
  const lookup = ((_h: string, opts: { all?: boolean }, cb: (...a: unknown[]) => void) => {
    if (opts?.all) cb(null, [{ address: pinned.address, family: pinned.family }])
    else cb(null, pinned.address, pinned.family)
  }) as unknown as LookupFunction
  return new Promise<Raw>((resolve, reject) => {
    const req = mod.request(
      {
        protocol: u.protocol,
        hostname: host,
        port: u.port || undefined,
        path: `${u.pathname}${u.search}`,
        method: 'GET',
        agent: false,
        lookup,
        signal,
        ...(u.protocol === 'https:' && !isIP(host) ? { servername: host } : {}),
        headers: {
          'user-agent': IMPORT_USER_AGENT,
          accept: o.accept ?? '*/*',
          'accept-language': 'en,ar;q=0.8',
          'accept-encoding': 'gzip, deflate, br',
        },
      },
      (res) => {
        const status = res.statusCode ?? 0
        if (status >= 300 && status < 400) {
          res.resume()
          resolve({ status, headers: res.headers, body: Buffer.alloc(0) })
          return
        }
        const declared = Number(res.headers['content-length'] ?? 0)
        const enc = String(res.headers['content-encoding'] ?? '').toLowerCase()
        if (declared > maxBytes && !enc) {
          req.destroy()
          reject(new ImportFetchError('The page is too large to import'))
          return
        }
        const stream =
          enc === 'gzip' || enc === 'x-gzip'
            ? res.pipe(zlib.createGunzip())
            : enc === 'deflate'
              ? res.pipe(zlib.createInflate())
              : enc === 'br'
                ? res.pipe(zlib.createBrotliDecompress())
                : res
        const chunks: Buffer[] = []
        let total = 0
        stream.on('data', (c: Buffer) => {
          total += c.length
          if (total > maxBytes) {
            req.destroy()
            stream.destroy()
            reject(new ImportFetchError('The page is too large to import'))
            return
          }
          chunks.push(c)
        })
        stream.on('end', () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks) }))
        stream.on('error', () => reject(new ImportFetchError('The site sent a broken response')))
      },
    )
    req.on('error', (e) => {
      if ((e as Error).name === 'AbortError') reject(new ImportFetchError('The site took too long to answer'))
      else if (e instanceof ImportFetchError) reject(e)
      else reject(new ImportFetchError(`Couldn’t reach ${host}`))
    })
    req.end()
  })
}

/** GET `raw` under the SSRF rules above. Throws ImportFetchError (a DomainError with a readable message). */
export async function safeFetch(raw: string, o: SafeFetchOpts = {}): Promise<SafeResponse> {
  const signal = AbortSignal.timeout(o.timeoutMs ?? 10_000)
  const maxBytes = o.maxBytes ?? 2 * 1024 * 1024
  let current: URL
  try {
    current = new URL(raw)
  } catch {
    throw new ImportBlockedError('That address isn’t valid')
  }
  for (let hop = 0; ; hop++) {
    const pinned = await checkHop(current, o)
    if (signal.aborted) throw new ImportFetchError('The site took too long to answer')
    const res = await request(current, pinned, o, signal, maxBytes)
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.location
      if (!location) throw new ImportFetchError(`The site answered ${res.status} without a new address`)
      if (hop >= (o.maxRedirects ?? 4)) throw new ImportFetchError('The site redirects too many times')
      try {
        current = new URL(location, current)
      } catch {
        throw new ImportFetchError('The site redirects to an invalid address')
      }
      continue
    }
    const header = String(res.headers['content-type'] ?? '')
    return {
      url: current.toString(),
      status: res.status,
      contentType: header.split(';')[0]!.trim().toLowerCase(),
      charset: header.match(/charset\s*=\s*"?([\w-]+)/i)?.[1]?.toLowerCase() ?? null,
      body: res.body,
    }
  }
}
