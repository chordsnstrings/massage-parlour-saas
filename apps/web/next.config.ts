import path from 'node:path'
import type { NextConfig } from 'next'

const monorepoRoot = path.resolve(process.cwd(), '../..')
const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: monorepoRoot,
  transpilePackages: ['@spa/core', '@spa/db', '@spa/auth', '@spa/ai'],
  serverExternalPackages: ['pg'],
  poweredByHeader: false,
  allowedDevOrigins: ['*.localhost'],
}

export default config
