import { readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { auditLog, platformSettings } from '@spa/db'
import { desc, eq, inArray, like } from 'drizzle-orm'
import { ADMIN, admin, signInPlatformAdmin, testDb } from './helpers'

const KEY = 're_e2eConsoleKey_WXYZ'
const outbox = process.env.EMAIL_E2E_OUTBOX_DIR as string

test('console email settings: masked Resend key, test email, config health (G9)', async ({ page }) => {
  await rm(outbox, { recursive: true, force: true })
  await signInPlatformAdmin(page)
  // Overview: no key anywhere (playwright env has RESEND_API_KEY='') → red, values never shown.
  const resendRow = page.getByTestId('config-resend')
  await expect(resendRow).toHaveAttribute('data-ok', 'false')
  await expect(resendRow).toContainText('Missing')
  await expect(page.getByTestId('ops-health')).toBeVisible()
  await expect(page.getByTestId('config-backups')).toBeVisible()
  // F9: the e2e server runs with Cloudflare's Turnstile test keys → green (unset would be red).
  await expect(page.getByTestId('config-TURNSTILE')).toHaveAttribute('data-ok', 'true')
  // F11: the restore drill's role exists (bootstrap.sql) with CREATEDB only.
  await expect(page.getByTestId('config-drill-role')).toHaveAttribute('data-ok', 'true')
  await expect(page.getByTestId('config-drill-role')).toContainText('CREATEDB only')

  await page.goto(`${admin}/settings`)
  const card = page.getByTestId('email-settings')
  await expect(card).toContainText('key missing')
  await card.getByLabel('Resend API key').fill('not-a-key')
  await card.getByRole('button', { name: 'Save email settings' }).click()
  await expect(card.getByText('A Resend API key starts with re_')).toBeVisible()

  await card.getByLabel('Resend API key').fill(KEY)
  await card.getByLabel('From address').fill('E2E Spa <no-reply@e2e.test>')
  await card.getByRole('button', { name: 'Save email settings' }).click()
  await expect(page.getByText('Email settings saved')).toBeVisible()
  await page.reload()
  await expect(card).toContainText('Set ✓ (…WXYZ)')
  await expect(card).toContainText('key from console')
  await expect(card.getByLabel('Resend API key')).toHaveValue('')
  expect(await page.content()).not.toContain(KEY)

  const db = testDb()
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.id, 1))
  expect(row?.resendApiKeyEnc).toBeTruthy()
  expect(row?.resendApiKeyEnc).not.toContain(KEY) // encrypted (BETTER_AUTH_SECRET-derived key in e2e)
  const [audit] = await db
    .select()
    .from(auditLog)
    .where(like(auditLog.action, 'platform.email.updated'))
    .orderBy(desc(auditLog.createdAt))
    .limit(1)
  expect(JSON.stringify(audit?.data)).not.toContain('WXYZ')
  expect(audit?.data).toMatchObject({ key: 'replaced' })

  // Test email → the signed-in admin, with the console key + sender (mocked transport, no Resend call).
  await card.getByRole('button', { name: 'Send test email to me' }).click()
  await expect(page.getByText(`Test email sent to ${ADMIN.email}`)).toBeVisible()
  const files = await readdir(outbox)
  const mails = await Promise.all(files.map(async (f) => JSON.parse(await readFile(join(outbox, f), 'utf8'))))
  const test = mails.find((m) => m.subject === 'spamanagement test email')
  expect(test).toMatchObject({ to: ADMIN.email, from: 'E2E Spa <no-reply@e2e.test>', keyLast4: 'WXYZ' })
  expect(JSON.stringify(mails)).not.toContain(KEY)

  await page.goto(`${admin}/`)
  await expect(resendRow).toHaveAttribute('data-ok', 'true')
  await expect(resendRow).toContainText('from console')
  await expect(resendRow).toContainText('e2e.test')

  // Remove the key again so later specs see the default (env) state.
  await page.goto(`${admin}/settings`)
  await card.getByLabel('Remove the stored key').check()
  await card.getByLabel('From address').fill('')
  await card.getByRole('button', { name: 'Save email settings' }).click()
  await expect(page.getByText('Email settings saved')).toBeVisible()
  await page.reload()
  await expect(card).toContainText('key missing')
})

test('console sending domain (R18): Namecheap records, verification, one-off full-access key', async ({
  page,
}) => {
  // In-memory Resend (RESEND_E2E_FAKE): "SendOnly" keys are sending-access keys. A fresh domain per run.
  const domain = `r18-${Date.now()}.e2e.test`
  const STORED = 're_e2eSendOnlyKey_ABCD'
  const SETUP = 're_e2eFullAccessKey_EFGH'
  await signInPlatformAdmin(page)
  await page.goto(`${admin}/settings`)
  const card = page.getByTestId('email-settings')
  await card.getByLabel('Resend API key').fill(STORED)
  await card.getByLabel('From address').fill(`R18 Spa <ask@${domain}>`)
  await card.getByRole('button', { name: 'Save email settings' }).click()
  await expect(page.getByText('Email settings saved')).toBeVisible()
  await page.reload()
  const section = page.getByTestId('sending-domain')
  await expect(section).toContainText(domain)
  await expect(section.getByLabel('Full-access key for setup')).toHaveCount(0)

  // The stored key may only send → the section asks for a one-off full-access key.
  await section.getByRole('button', { name: 'Set up sending domain' }).click()
  await expect(section.getByText(/sending access only/)).toBeVisible()
  await expect(section.getByTestId('domain-records')).toHaveCount(0)
  await section.getByLabel('Full-access key for setup').fill(SETUP)
  await section.getByRole('button', { name: 'Set up sending domain' }).click()
  await expect(page.getByText(`${domain} added to Resend`)).toBeVisible()
  await expect(section.getByTestId('domain-status')).toHaveText('Not started')
  await expect(section).toContainText('region eu-west-1')
  // Namecheap rows (desktop table): MX send 10 + its warning, SPF TXT, DKIM host without the domain suffix.
  const rows = section.getByTestId('domain-records').locator('tbody tr')
  await expect(rows).toHaveCount(3)
  await expect(rows.nth(0)).toContainText('MX')
  await expect(rows.nth(0)).toContainText('send')
  await expect(rows.nth(0)).toContainText('feedback-smtp.eu-west-1.amazonses.com')
  await expect(rows.nth(0)).toContainText('10')
  await expect(rows.nth(0)).toContainText('Automatic')
  await expect(rows.nth(0).locator('td').nth(2).getByTestId('mx-warning')).toContainText('Custom MX')
  await expect(rows.nth(1)).toContainText('v=spf1 include:amazonses.com ~all')
  await expect(rows.nth(2).locator('td').nth(1).locator('code').first()).toHaveText('resend._domainkey')
  await expect(section.getByTestId('domain-records')).not.toContainText(`_domainkey.${domain}`)
  await expect(rows.nth(0).getByRole('button', { name: 'Copy' })).toBeVisible()

  // Check → Resend verifies → verified, with the sender it applies to.
  await section.getByRole('button', { name: 'Check verification' }).click()
  await expect(section.getByTestId('domain-status')).toHaveText('Verified')
  await expect(section.getByTestId('domain-verified')).toHaveText(
    `Sending works: staff email goes out from R18 Spa <ask@${domain}>.`,
  )
  await expect(rows.nth(2)).toContainText('Verified')
  // A second set up reuses the domain instead of adding it again.
  await section.getByRole('button', { name: 'Set up sending domain' }).click()
  await expect(page.getByText(`${domain} is already in Resend`)).toBeVisible()

  // 360 px: rows stack, no sideways page scroll.
  await page.setViewportSize({ width: 360, height: 780 })
  await expect(section.getByTestId('domain-records').locator('li').first()).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.setViewportSize({ width: 1280, height: 800 })

  // Keys never reach the page or the audit log.
  const html = await page.content()
  for (const k of [STORED, SETUP]) expect(html).not.toContain(k)
  const audits = await testDb()
    .select()
    .from(auditLog)
    .where(inArray(auditLog.action, ['platform.email.domain_setup', 'platform.email.domain_checked']))
    .orderBy(desc(auditLog.createdAt))
    .limit(3)
  expect(audits.map((a) => a.action)).toEqual([
    'platform.email.domain_setup',
    'platform.email.domain_checked',
    'platform.email.domain_setup',
  ])
  expect(audits[2]?.data).toEqual({ domain, created: true, status: 'not_started' })
  expect(audits[1]?.data).toEqual({ domain, status: 'verified' })
  expect(audits[0]?.data).toEqual({ domain, created: false, status: 'verified' })
  expect(JSON.stringify(audits)).not.toMatch(/re_|ABCD|EFGH/)

  // Back to the default (env) state for later specs.
  await card.getByLabel('Remove the stored key').check()
  await card.getByLabel('From address').fill('')
  await card.getByRole('button', { name: 'Save email settings' }).click()
  await expect(page.getByText('Email settings saved')).toBeVisible()
})
