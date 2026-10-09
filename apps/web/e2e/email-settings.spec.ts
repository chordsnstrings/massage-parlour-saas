import { readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { auditLog, platformSettings } from '@spa/db'
import { desc, eq, like } from 'drizzle-orm'
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
