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
  experimental: {
    // R24: the proxy buffers request bodies up to this size (beyond it the route gets a cut-off body). /api/mcp takes
    // a whole 5 MB HTML design JSON-escaped (@spa/ai SITE_MCP_MAX_REQUEST_BYTES ≈ 10.25 MB); server actions keep
    // their own 1 MB cap and /files/templates isn't proxied.
    proxyClientMaxBodySize: '11mb',
  },
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
      // Built-in pictures + fonts of the platform's own HTML designs (public/designs/{design}/{sha256-16}.{ext}, BE
      // RELAX v2.2): content-addressed, so cached for good; CORS because the design page is sandboxed (opaque origin,
      // fonts need it) and is served on spa hosts and own domains. Never rename or delete one: published designs link
      // them by URL. File paths only (the proxy matcher skips these extensions), never a spa page; a 404 stays no-store.
      {
        source: '/designs/:design/:file(.+\\.(?:webp|avif|png|jpe?g|svg|woff2?))',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Cross-Origin-Resource-Policy', value: 'cross-origin' },
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
