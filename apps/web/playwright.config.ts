import { existsSync } from 'node:fs'
import { defineConfig, devices } from '@playwright/test'

const PORT = 3100
const local = (role: string) => `postgres://${role}:${role}_dev@localhost:5432/spa_test`
// Use a preinstalled Chromium when present (cloud sandbox); CI installs its own.
const chromium =
  process.env.PW_CHROMIUM ??
  (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined)

export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? 'github' : 'list',
  globalSetup: './e2e/global-setup.ts',
  use: { trace: 'retain-on-failure', launchOptions: chromium ? { executablePath: chromium } : {} },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: `node scripts/next.mjs dev -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      ROOT_DOMAIN: `localhost:${PORT}`,
      APP_URL: `http://app.localhost:${PORT}`,
      ADMIN_URL: `http://admin.localhost:${PORT}`,
      DATABASE_URL_OWNER: process.env.TEST_DATABASE_URL_OWNER ?? local('spa_owner'),
      DATABASE_URL_PLATFORM: process.env.TEST_DATABASE_URL_PLATFORM ?? local('spa_platform'),
      DATABASE_URL_APP: process.env.TEST_DATABASE_URL_APP ?? local('spa_app'),
      BETTER_AUTH_SECRET: 'e2e-secret-e2e-secret-e2e-secret-e2e',
      PLATFORM_ADMIN_EMAILS: 'admin@e2e.test',
      RESEND_API_KEY: '',
    },
  },
})
