import { test } from '@playwright/test'
import { admin, app, base, signInPlatformAdmin } from './helpers'

const DIR = '/tmp/claude-0/-home-user-massage-parlour-saas/1998ad9b-1e61-58ef-a73e-ab788ef65ade/scratchpad/brand'
for (const w of [1280, 360]) {
  test(`brand shots ${w}`, async ({ page, browser }) => {
    test.setTimeout(180_000)
    await page.setViewportSize({ width: w, height: 800 })
    await page.goto(base)
    await page.screenshot({ path: `${DIR}/marketing-${w}.png` })
    const p2 = await browser.newPage({ viewport: { width: w, height: 800 } })
    await p2.goto(`${app}/login`)
    await p2.screenshot({ path: `${DIR}/login-${w}.png` })
    await signInPlatformAdmin(page)
    await page.goto(admin)
    await page.waitForLoadState('networkidle')
    await page.screenshot({ path: `${DIR}/console-${w}.png` })
  })
}
