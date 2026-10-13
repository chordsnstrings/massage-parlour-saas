import { expect, test } from '@playwright/test'
import { auditLog, platformSettings } from '@spa/db'
import { desc, eq, like } from 'drizzle-orm'
import { admin, app, base, signInPlatformAdmin, signUpOwner, testDb } from './helpers'

const GOOGLE_ID = 'e2e-r29.apps.googleusercontent.com'
const GOOGLE_SECRET = 'GOCSPX-e2eConsoleSecret-WXYZ'
const META_SECRET = 'e2e-meta-app-secret-ABCD'
const VERIFY = 'e2e-verify-token-9876'
// API routes answer on the bare platform host too (Node can't resolve *.localhost hosts for `request`).
const webhook = `${base}/api/integrations/meta/webhook`
const challenge = (token: string) =>
  `${webhook}?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(token)}&hub.challenge=r29-ok`

// R29: Google + Meta app keys saved in the console Company page win over env (unset for the e2e server); secrets are
// write-only (last 4), the spa cards and the Meta webhook use them without a restart; removed again at the end so
// gbp.spec / instagram.spec keep seeing the env-only "Not configured yet" state.
test('console Google + Meta keys: masked secrets, sources, spa cards and webhook use them', async ({
  browser,
}) => {
  test.setTimeout(180_000) // two surfaces, several reloads
  const ownerCtx = await browser.newContext()
  const adminCtx = await browser.newContext()
  const owner = await ownerCtx.newPage()
  const page = await adminCtx.newPage()
  const { slug } = await signUpOwner(owner, { plan: 'premium' })
  await owner.goto(`${app}/${slug}/settings/integrations`)
  await expect(owner.getByTestId('gbp-card').getByText('Not configured yet')).toBeVisible()
  expect((await owner.request.get(challenge(VERIFY))).status()).toBe(503)

  await signInPlatformAdmin(page)
  await page.goto(`${admin}/settings`)
  const google = page.getByTestId('google-keys')
  await expect(google.getByTestId('google-keys-status')).toHaveText('not configured')
  await expect(google.getByTestId('source-GOOGLE_CLIENT_ID')).toHaveAttribute('data-source', 'missing')
  await expect(google.getByTestId('google-redirect-uris')).toContainText('/api/integrations/google/callback')

  await google.getByLabel('Client ID', { exact: true }).fill('two words')
  await google.getByRole('button', { name: 'Save Google keys' }).click()
  await expect(google.getByText('No spaces — copy the value again')).toBeVisible()
  await google.getByLabel('Client ID', { exact: true }).fill(GOOGLE_ID)
  await google.getByLabel('Client secret', { exact: true }).fill(GOOGLE_SECRET)
  await google.getByRole('button', { name: 'Save Google keys' }).click()
  await expect(page.getByText('Google keys saved')).toBeVisible()
  await page.reload()
  await expect(google.getByTestId('google-keys-status')).toHaveText('configured')
  await expect(google.getByTestId('source-GOOGLE_CLIENT_ID')).toHaveAttribute('data-source', 'console')
  await expect(google.getByTestId('source-GOOGLE_CLIENT_SECRET')).toContainText('From console ✓ (…WXYZ)')
  await expect(google.getByLabel('Client ID', { exact: true })).toHaveValue(GOOGLE_ID)
  await expect(google.getByLabel('Client secret', { exact: true })).toHaveValue('')
  expect(await page.content()).not.toContain(GOOGLE_SECRET)

  const db = testDb()
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.id, 1))
  expect(row?.googleClientSecretEnc).toBeTruthy()
  expect(row?.googleClientSecretEnc).not.toContain(GOOGLE_SECRET) // sealed (BETTER_AUTH_SECRET-derived key in e2e)
  const [audit] = await db
    .select()
    .from(auditLog)
    .where(like(auditLog.action, 'platform.integrations.google.updated'))
    .orderBy(desc(auditLog.createdAt))
    .limit(1)
  expect(audit?.data).toEqual({ set: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'], removed: [] })
  expect(JSON.stringify(audit?.data)).not.toContain('WXYZ')

  // Meta: the three required keys from the console; the config id stays optional.
  const meta = page.getByTestId('meta-keys')
  await expect(meta.getByTestId('meta-webhook-url')).toContainText('/api/integrations/meta/webhook')
  await expect(meta.getByTestId('meta-data-deletion-url')).toContainText(
    '/api/integrations/meta/data-deletion',
  )
  await meta.getByLabel('Instagram app ID', { exact: true }).fill('1234567890')
  await meta.getByLabel('Instagram app secret', { exact: true }).fill(META_SECRET)
  await meta.getByLabel('Webhook verify token', { exact: true }).fill(VERIFY)
  await meta.getByRole('button', { name: 'Save Meta keys' }).click()
  await expect(page.getByText('Meta keys saved')).toBeVisible()
  await page.reload()
  await expect(meta.getByTestId('meta-keys-status')).toHaveText('configured')
  await expect(meta.getByTestId('source-META_APP_SECRET')).toContainText('(…ABCD)')
  await expect(meta.getByTestId('source-META_FB_CONFIG_ID')).toHaveAttribute('data-source', 'missing')
  expect(await page.content()).not.toContain(META_SECRET)
  expect(await page.content()).not.toContain(VERIFY)

  // The spa side picks the console keys up at once (no redeploy).
  await owner.reload()
  const gbp = owner.getByTestId('gbp-card')
  await expect(gbp.getByText('Not configured yet')).toHaveCount(0)
  await expect(gbp.getByRole('button', { name: 'Connect Google' })).toBeVisible()
  const ig = owner.getByTestId('instagram-card')
  await expect(ig.getByText('META_APP_SECRET')).toHaveCount(0)
  await expect(ig.getByRole('button', { name: 'Connect Instagram' })).toBeVisible()
  const ok = await owner.request.get(challenge(VERIFY))
  expect(ok.status()).toBe(200)
  expect(await ok.text()).toBe('r29-ok')
  expect((await owner.request.get(challenge('wrong'))).status()).toBe(403)

  // Overview: the config rows say where the keys come from.
  await page.goto(`${admin}/`)
  await expect(page.getByTestId('config-GOOGLE')).toHaveAttribute('data-ok', 'true')
  await expect(page.getByTestId('config-GOOGLE')).toContainText('from console')

  // Remove everything again so later specs see the env-only state.
  await page.goto(`${admin}/settings`)
  await google.getByLabel('Client ID', { exact: true }).fill('')
  await google.getByLabel('Remove the stored client secret').check()
  await google.getByRole('button', { name: 'Save Google keys' }).click()
  await expect(page.getByText('Google keys saved')).toBeVisible()
  await meta.getByLabel('Instagram app ID', { exact: true }).fill('')
  await meta.getByLabel('Remove the stored Instagram app secret').check()
  await meta.getByLabel('Remove the stored verify token').check()
  await meta.getByRole('button', { name: 'Save Meta keys' }).click()
  await expect(page.getByText('Meta keys saved')).toBeVisible()
  await page.reload()
  await expect(google.getByTestId('google-keys-status')).toHaveText('not configured')
  await expect(meta.getByTestId('meta-keys-status')).toHaveText('not configured')
  await owner.reload()
  await expect(owner.getByTestId('gbp-card').getByText('Not configured yet')).toBeVisible()
  expect((await owner.request.get(challenge(VERIFY))).status()).toBe(503)
  await ownerCtx.close()
  await adminCtx.close()
})
