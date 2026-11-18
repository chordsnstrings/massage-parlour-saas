import { expect, test } from '@playwright/test'
import { app, base, screenshotAt, signUpOwner, site } from './helpers'

test('website analytics: tracker beacons show up on the dashboard', async ({ page, request }) => {
  const { slug } = await signUpOwner(page)

  const visitor = await page.context().newPage()
  const beacon = visitor.waitForResponse(
    (r) => r.url().endsWith('/api/collect') && r.request().method() === 'POST',
  )
  await visitor.goto(site(slug))
  expect((await beacon).status()).toBe(204)
  await visitor.close()

  // A few more visitors (distinct user agents → distinct daily session hashes).
  const send = (ua: string, body: Record<string, unknown>) =>
    request.post(`${base}/api/collect`, {
      headers: { 'user-agent': ua, 'content-type': 'application/json' },
      data: { site: slug, path: '/', referrer: null, ...body },
    })
  for (const [i, ua] of ['iPhone Mobile', 'Android Mobile', 'Macintosh'].entries()) {
    expect((await send(ua, { type: 'pageview', utm: { src: 'instagram' } })).status()).toBe(204)
    await send(ua, { type: 'block_view', blockId: 'hero-1', blockType: 'Hero' })
    if (i < 2) await send(ua, { type: 'booking_start', path: '/book', blockId: 'hero-1', blockType: 'Hero' })
    if (i === 0) await send(ua, { type: 'booking_complete', path: '/book' })
  }
  expect((await send('x', { type: 'nope' })).status()).toBe(400)

  await page.goto(`${app}/${slug}/analytics`)
  await expect(page.getByRole('heading', { name: 'Website analytics' })).toBeVisible()
  await expect(page.getByText('Booking funnel')).toBeVisible()
  await expect(page.getByText('Started a booking')).toBeVisible()
  await expect(page.getByText('3 visitors · 1 booked')).toBeVisible()
  await expect(page.getByText('Instagram')).toBeVisible()
  await expect(page.getByText('Hero').first()).toBeVisible()
  await page.getByRole('link', { name: '7 days' }).click()
  await expect(page).toHaveURL(/range=7/)
  await screenshotAt(page, 'analytics')
})
