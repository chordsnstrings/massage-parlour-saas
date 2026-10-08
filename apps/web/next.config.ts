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
  async headers() {
    const common = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
      ...(process.env.NODE_ENV === 'production'
        ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
        : []),
    ]
    // The booking widget's iframe route (/book/embed, /s/{slug}/book/embed) is the only page other sites may frame.
    const embed = [
      ...common,
      { key: 'Content-Security-Policy', value: "frame-ancestors *; base-uri 'self'; object-src 'none'" },
    ]
    return [
      {
        source: '/:path((?!book/embed$|s/[^/]+/book/embed$).*)',
        headers: [
          ...common,
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'",
          },
        ],
      },
      { source: '/book/embed', headers: embed },
      { source: '/s/:slug/book/embed', headers: embed },
    ]
  },
}

export default config
