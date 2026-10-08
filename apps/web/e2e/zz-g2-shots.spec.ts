import { expect, test } from '@playwright/test'
import { app, seedBooking, seedCatalog, signUpOwner } from './helpers'

const OUT = '/tmp/claude-0/-home-user-massage-parlour-saas/1998ad9b-1e61-58ef-a73e-ab788ef65ade/scratchpad/p2/g2'
test('g2 shots', async ({ page }) => {
  test.setTimeout(180_000)
  const { slug } = await signUpOwner(page)
  const seed = await seedCatalog(slug)
  await seedBooking(seed)
  await page.goto(`${app}/${slug}/clients`)
  await page.getByRole('link', { name: /Fatima Al Mansoori/ }).first().click()
  await page.waitForURL(/clients\/[0-9a-f-]{36}/)
  const profile = page.url()
  const shots = async (lang: string) => {
    for (const [w, h] of [[1280, 900], [360, 780]]) {
      await page.setViewportSize({ width: w, height: h })
      for (const [n, u] of [['list', `${app}/${slug}/clients`], ['profile', profile]]) {
        await page.goto(u)
        await page.waitForTimeout(800)
        await page.screenshot({ path: `${OUT}/${n}-${w}-${lang}.png`, fullPage: true })
      }
    }
  }
  await shots('en')
  await page.getByRole('button', { name: 'ไทย' }).first().click()
  await page.waitForTimeout(1500)
  await shots('th')
})
