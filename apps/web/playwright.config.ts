import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.E2E_PORT ?? 3100)
const aiFixtureDir = path.join(tmpdir(), `spa-e2e-ai-${PORT}`)
// Staff emails land here as JSON once a Resend key is saved (email-settings.spec); never set in deploy env.
const emailOutboxDir = path.join(tmpdir(), `spa-e2e-mail-${PORT}`)
process.env.EMAIL_E2E_OUTBOX_DIR = emailOutboxDir
const local = (role: string) =>
  `postgres://${role}:${role}_dev@localhost:5432/${process.env.TEST_DB_NAME ?? 'spa_test'}`
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
    // E2E_SERVER=start serves the existing production build (`pnpm --filter @spa/web build`, same NEXT_PUBLIC_ROUTING).
    // CI uses it: the dev server compiles every route on demand and grew past 13 GB over the full suite (OOM).
    command: `node scripts/next.mjs ${process.env.E2E_SERVER === 'start' ? 'start' : 'dev'} -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      ...(process.env.E2E_ROUTING === 'path'
        ? {
            NEXT_PUBLIC_ROUTING: 'path',
            ROOT_DOMAIN: `localhost:${PORT}`,
            APP_URL: `http://localhost:${PORT}`,
            ADMIN_URL: `http://localhost:${PORT}/admin`,
          }
        : {
            ROOT_DOMAIN: `localhost:${PORT}`,
            APP_URL: `http://app.localhost:${PORT}`,
            ADMIN_URL: `http://admin.localhost:${PORT}`,
          }),
      DATABASE_URL_OWNER: process.env.TEST_DATABASE_URL_OWNER ?? local('spa_owner'),
      DATABASE_URL_PLATFORM: process.env.TEST_DATABASE_URL_PLATFORM ?? local('spa_platform'),
      DATABASE_URL_APP: process.env.TEST_DATABASE_URL_APP ?? local('spa_app'),
      BETTER_AUTH_SECRET: 'e2e-secret-e2e-secret-e2e-secret-e2e',
      // admin@e2e.test = signInPlatformAdmin; the join-* / listed-apply ones: admin-join.spec (no login until it runs).
      PLATFORM_ADMIN_EMAILS:
        'admin@e2e.test, join-confirm@e2e.test,,join-link@e2e.test,listed-apply@e2e.test,admin@e2e.test',
      // Prompt-based site editing (Studio Ask AI, Claude MCP) is limited to these accounts (owners of fixed e2e slugs).
      SITE_AI_EDITOR_EMAILS: 'owner-ai-editor@e2e.test,owner-mcp-editor@e2e.test',
      // A second platform domain (resolves to loopback): links and sign-in must follow whichever domain is used.
      EXTRA_ROOT_DOMAINS: `alt.localhost:${PORT}`,
      RESEND_API_KEY: '',
      // The suite signs up dozens of owners from one IP; a production build would otherwise rate-limit them.
      AUTH_RATE_LIMIT: 'off',
      // Canned AI replies per spa slug (ai-edit.spec): the gateway still meters and validates; no ModelArk call.
      // F9: Cloudflare's documented always-pass Turnstile test keys (dummy token, real siteverify call).
      TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
      TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
      AI_E2E_FIXTURE_DIR: aiFixtureDir,
      // F32 site import: the local fixture site (site-import.spec, port E2E_PORT + 1) is exempt from the SSRF rules.
      SITE_IMPORT_E2E_ALLOW: `127.0.0.1:${PORT + 1}`,
      EMAIL_E2E_OUTBOX_DIR: emailOutboxDir,
      // R18: the console's Resend domain setup talks to an in-memory fake (server/resend-fake.ts), never to Resend.
      RESEND_E2E_FAKE: '1',
    },
  },
})
