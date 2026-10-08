import { test } from '@playwright/test'
import { user } from '@spa/db'
import { eq } from 'drizzle-orm'
import { app, signUpOwner, testDb } from './helpers'

const OUT = '/tmp/claude-0/-home-user-massage-parlour-saas/1998ad9b-1e61-58ef-a73e-ab788ef65ade/scratchpad/p2/G9'
test.setTimeout(300_000)

test('G9 screenshots', async ({ page, browser }) => {
  const { slug } = await signUpOwner(page)
  const pages = [
    'settings',
    'settings/hours',
    'settings/intake',
    'settings/integrations',
    'settings/domains',
    'settings/data',
    'settings/data/import/clients',
  ]
  const shot = async (url: string, name: string) => {
    await page.goto(url)
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true })
  }
  for (const w of [1280, 360]) {
    await page.setViewportSize({ width: w, height: 900 })
    for (const p of pages) await shot(`${app}/${slug}/${p}`, `${p.replaceAll('/', '-')}-${w}`)
    await shot(`${app}/account`, `account-${w}`)
  }
  const db = testDb()
  await db.update(user).set({ locale: 'th' }).where(eq(user.email, `owner-${slug}@e2e.test`))
  await page.setViewportSize({ width: 1280, height: 900 })
  for (const p of ['settings', 'settings/domains', 'settings/data']) await shot(`${app}/${slug}/${p}`, `${p.replaceAll('/', '-')}-th`)
  await page.setViewportSize({ width: 360, height: 900 })
  await shot(`${app}/${slug}/settings/hours`, 'settings-hours-th-360')
  await shot(`${app}/account`, 'account-th-360')

  const anon = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await anon.addCookies([{ name: 'spa_locale', value: 'th', url: app }])
  const p2 = await anon.newPage()
  for (const a of ['login', 'signup']) {
    await p2.goto(`${app}/${a}`)
    await p2.waitForLoadState('networkidle').catch(() => {})
    await p2.screenshot({ path: `${OUT}/${a}-th.png`, fullPage: true })
  }
  await anon.close()
})
