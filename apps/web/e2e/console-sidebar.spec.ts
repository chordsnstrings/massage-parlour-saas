import { expect, test } from '@playwright/test'
import { signInPlatformAdmin } from './helpers'

// Owner 2026-10-10: the console sidebar shows every item on one screen (no sidebar scroll) on laptop heights.
test('console sidebar: every item fits without scrolling down to 600 px tall', async ({ page }) => {
  await signInPlatformAdmin(page)
  for (const [width, height] of [
    [1920, 1080],
    [1366, 600],
    [1280, 680],
    [1024, 640],
  ] as const) {
    await page.setViewportSize({ width, height })
    const nav = page.locator('aside nav')
    await expect(nav.getByRole('link')).toHaveCount(15)
    const fit = await nav.evaluate((el) => {
      const box = el.parentElement as HTMLElement
      const last = el.querySelector('a:last-of-type')?.getBoundingClientRect()
      return {
        over: box.scrollHeight - box.clientHeight,
        lastBottom: last?.bottom ?? 0,
        boxBottom: box.getBoundingClientRect().bottom,
      }
    })
    expect(fit.over, `${width}x${height}: sidebar scrolls`).toBeLessThanOrEqual(0)
    expect(fit.lastBottom, `${width}x${height}: last item hidden`).toBeLessThanOrEqual(fit.boxBottom + 0.5)
  }
})
