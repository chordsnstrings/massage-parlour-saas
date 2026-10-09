import path from 'node:path'
import type { NextConfig } from 'next'

const monorepoRoot = path.resolve(process.cwd(), '../..')
const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: monorepoRoot,
  transpilePackages: ['@spa/core', '@spa/db', '@spa/auth', '@spa/ai', '@spa/services'],
  serverExternalPackages: ['pg', 'exceljs'],
  poweredByHeader: false,
  allowedDevOrigins: ['*.localhost'],
  devIndicators: false,
  // F10 security headers. Pages (everything src/proxy.ts matches) get CSP with a per-request nonce, X-Frame-Options,
  // COOP and HSTS from the proxy (@spa/core pageSecurityHeaders); this only adds what is the same everywhere, plus the
  // headers of the paths the proxy skips. Never set CSP/XFO/HSTS here for a proxied path: a second CSP header would be
  // enforced as well, and only the first HSTS header counts. Values mirror @spa/core security-headers.ts.
  async headers() {
    const httpsOnly = [{ type: 'header' as const, key: 'x-forwarded-proto', value: 'https' }]
    const hsts = { key: 'Strict-Transport-Security', value: 'max-age=31536000' }
    // JSON / redirect endpoints (Better Auth + OAuth/MCP, webhooks, reports): nothing may load, frame or submit.
    const apiCsp = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value:
              'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), bluetooth=(), midi=(), magnetometer=(), gyroscope=(), accelerometer=(), display-capture=(), browsing-topics=()',
          },
        ],
      },
      // The HTML design shell (app/api/html-design/frame) sends its own sandbox CSP.
      {
        source: '/api/:path((?!html-design/frame$).*)',
        headers: [
          { key: 'Content-Security-Policy', value: apiCsp },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
      {
        source: '/.well-known/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: apiCsp },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
      // Stored files send their own sandbox CSP (app/files/serve.ts).
      { source: '/files/:path*', headers: [{ key: 'X-Frame-Options', value: 'SAMEORIGIN' }] },
      { source: '/api/:path*', has: httpsOnly, headers: [hsts] },
      { source: '/.well-known/:path*', has: httpsOnly, headers: [hsts] },
      { source: '/files/:path*', has: httpsOnly, headers: [hsts] },
    ]
  },
}

export default config
