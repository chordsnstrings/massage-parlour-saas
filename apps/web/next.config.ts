import path from 'node:path'
import type { NextConfig } from 'next'

const monorepoRoot = path.resolve(process.cwd(), '../..')
const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: monorepoRoot,
  transpilePackages: ['@spa/core', '@spa/db', '@spa/auth', '@spa/ai', '@spa/services'],
  serverExternalPackages: ['pg', 'exceljs', 'pdfkit'],
  poweredByHeader: false,
  allowedDevOrigins: ['*.localhost'],
  devIndicators: false,
  // F10 security headers. Pages (everything src/proxy.ts matches) get CSP with a per-request nonce, X-Frame-Options,
  // COOP, HSTS and Permissions-Policy from the proxy (@spa/core pageSecurityHeaders); this only adds what is the same
  // everywhere, plus the headers of the paths the proxy skips. Never set CSP/XFO/HSTS/Permissions-Policy here for a
  // proxied path: a second header would be enforced as well (R24: a spa page showing an HTML design delegates the
  // motion sensors to it, which a second policy here would undo). Values mirror @spa/core security-headers.ts.
  async headers() {
    const httpsOnly = [{ type: 'header' as const, key: 'x-forwarded-proto', value: 'https' }]
    const hsts = { key: 'Strict-Transport-Security', value: 'max-age=31536000' }
    // JSON / redirect endpoints (Better Auth + OAuth/MCP, webhooks, reports): nothing may load, frame or submit.
    const apiCsp = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
    const permissions = {
      key: 'Permissions-Policy',
      value:
        'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), midi=(), magnetometer=(), gyroscope=(), accelerometer=(), display-capture=(), browsing-topics=()',
    }
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
      // The HTML design shell (app/api/html-design/frame) sends its own sandbox CSP and Permissions-Policy.
      {
        source: '/api/:path((?!html-design/frame$).*)',
        headers: [
          { key: 'Content-Security-Policy', value: apiCsp },
          { key: 'X-Frame-Options', value: 'DENY' },
          permissions,
        ],
      },
      {
        source: '/.well-known/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: apiCsp },
          { key: 'X-Frame-Options', value: 'DENY' },
          permissions,
        ],
      },
      // Stored files send their own sandbox CSP (app/files/serve.ts).
      { source: '/files/:path*', headers: [{ key: 'X-Frame-Options', value: 'SAMEORIGIN' }, permissions] },
      { source: '/api/:path*', has: httpsOnly, headers: [hsts] },
      { source: '/.well-known/:path*', has: httpsOnly, headers: [hsts] },
      { source: '/files/:path*', has: httpsOnly, headers: [hsts] },
    ]
  },
}

export default config
