import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CLIENT_IP_HEADER, clientIpFrom, ipRateLimitKey, isIp, isIpv4, isIpv6 } from '../src'

const h = (init: Record<string, string>) => new Headers(init)

describe('clientIpFrom (F26)', () => {
  it('reads the Cf-Connecting-Ip header Caddy sets, trimmed and lower-cased', () => {
    expect(CLIENT_IP_HEADER).toBe('cf-connecting-ip')
    expect(clientIpFrom(h({ 'CF-Connecting-IP': ' 203.0.113.9 ' }))).toBe('203.0.113.9')
    expect(clientIpFrom(h({ 'cf-connecting-ip': '2001:DB8::7' }))).toBe('2001:db8::7')
  })

  it('never falls back to client-writable headers', () => {
    const spoofed = {
      'x-forwarded-for': '6.6.6.6, 203.0.113.9',
      'x-real-ip': '6.6.6.6',
      'do-connecting-ip': '6.6.6.6',
      'true-client-ip': '6.6.6.6',
    }
    expect(clientIpFrom(h(spoofed))).toBeNull()
    expect(clientIpFrom(h({ ...spoofed, 'cf-connecting-ip': '198.51.100.4' }))).toBe('198.51.100.4')
    expect(clientIpFrom(null)).toBeNull()
    expect(clientIpFrom(undefined)).toBeNull()
  })

  it('refuses anything that is not one address (lists, ports, zones, junk)', () => {
    for (const bad of [
      '',
      'unknown',
      '1.2.3.4, 5.6.7.8',
      '1.2.3.4:80',
      '[2001:db8::1]',
      'fe80::1%eth0',
      'x'.repeat(60),
    ])
      expect(clientIpFrom(h({ 'cf-connecting-ip': bad })), bad).toBeNull()
  })
})

describe('isIp', () => {
  it('accepts IPv4 and IPv6 forms', () => {
    for (const ok of ['0.0.0.0', '255.255.255.255', '10.1.2.3']) expect(isIpv4(ok), ok).toBe(true)
    for (const ok of [
      '::',
      '::1',
      '2001:db8::',
      '1:2:3:4:5:6:7:8',
      '1:2:3:4:5:6:7::',
      '::ffff:192.0.2.1',
      '64:ff9b::1.2.3.4',
    ])
      expect(isIpv6(ok), ok).toBe(true)
  })
  it('rejects malformed addresses', () => {
    for (const bad of ['256.1.1.1', '1.2.3', '01.2.3.4', '1.2.3.4.5', '1.2.3.-4'])
      expect(isIpv4(bad), bad).toBe(false)
    for (const bad of [
      '1.2.3.4',
      ':1',
      '1::2::3',
      '1:2:3:4:5:6:7:8:9',
      '1:2:3:4:5:6:7:8::',
      '12345::',
      'g::1',
      '::1.2.3',
    ])
      expect(isIpv6(bad), bad).toBe(false)
    expect(isIp('localhost')).toBe(false)
  })
})

describe('ipRateLimitKey', () => {
  it('keeps IPv4 and unwraps IPv4-mapped IPv6', () => {
    expect(ipRateLimitKey('203.0.113.9')).toBe('203.0.113.9')
    expect(ipRateLimitKey('::ffff:203.0.113.9')).toBe('203.0.113.9')
    expect(ipRateLimitKey('::ffff:cb00:7109')).toBe('203.0.113.9')
  })
  it('buckets IPv6 by /64, like Better Auth', () => {
    const a = ipRateLimitKey('2001:db8:0:1:aaaa::1')
    expect(a).toBe('2001:db8:0:1::/64')
    expect(ipRateLimitKey('2001:0DB8:0000:0001:ffff:ffff:ffff:ffff')).toBe(a)
    expect(ipRateLimitKey('2001:db8:0:2::1')).not.toBe(a)
  })
  it('shares one bucket without an IP', () => {
    expect(ipRateLimitKey(null)).toBe('unknown')
    expect(ipRateLimitKey('garbage')).toBe('unknown')
  })
})

describe('one helper for the client IP (F26)', () => {
  it('no app source reads an IP header directly', () => {
    const root = fileURLToPath(new URL('../../..', import.meta.url))
    const self = join('packages', 'core', 'src', 'client-ip.ts')
    const offenders: string[] = []
    for (const base of ['apps', 'packages'])
      for (const pkg of readdirSync(join(root, base))) {
        const src = join(base, pkg, 'src')
        let files: string[]
        try {
          files = readdirSync(join(root, src), { recursive: true }) as string[]
        } catch {
          continue
        }
        for (const f of files) {
          const rel = join(src, f)
          if (!/\.(ts|tsx|js|mjs)$/.test(f) || rel === self) continue
          if (
            /cf-connecting-ip|x-forwarded-for|x-real-ip|do-connecting-ip|true-client-ip/i.test(
              readFileSync(join(root, rel), 'utf8'),
            )
          )
            offenders.push(rel)
        }
      }
    expect(offenders, 'use clientIpFrom()/CLIENT_IP_HEADER from @spa/core instead').toEqual([])
  })
})
