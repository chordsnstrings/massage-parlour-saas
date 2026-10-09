import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, test } from '@playwright/test'
import { bookings, webEvents } from '@spa/db'
import { and, eq } from 'drizzle-orm'
import { app, base, seedCatalog, signUpOwner, site, testDb } from './helpers'

/** A spa's own website on another origin (a real loopback server, so Chromium's local-network rules apply as in
 * production), carrying the copy-paste snippet from Settings → Booking widget. */
async function ownWebsite(html: string) {
  const server = createServer((_, res) => {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(html)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`, close: () => server.close() }
}

test('booking widget: snippet in settings, frameable embed route, booking through the iframe', async ({
  page,
}) => {
  const { slug } = await signUpOwner(page, { spa: 'Widget Spa' })
  const seed = await seedCatalog(slug)

  await page.goto(`${app}/${slug}/settings/widget`)
  const snippet = page.getByTestId('widget-snippet')
  await expect(snippet).toContainText(`data-spa="${slug}"`)
  await expect(snippet).toContainText('/book/embed')

  // Only the embed route may be framed by other sites.
  // (Browser navigations: Node's resolver doesn't know *.localhost.)
  const embed = (await page.goto(`${site(slug)}/book/embed`))!
  expect(embed.ok()).toBe(true)
  expect(embed.headers()['content-security-policy']).toContain('frame-ancestors *')
  expect(embed.headers()['x-frame-options']).toBeUndefined()
  const book = (await page.goto(`${site(slug)}/book`))!
  expect(book.headers()['content-security-policy']).toContain("frame-ancestors 'self'")
  expect(book.headers()['x-frame-options']).toBe('SAMEORIGIN')

  const own = await ownWebsite(`<!doctype html><html><body><h1>Partner site</h1>
<script>window.booked = null; addEventListener('spa-widget:booked', (e) => { window.booked = e.detail })</script>
<script src="${base}/widget.js" data-spa="${slug}" data-url="${site(slug)}/book/embed" data-color="#3D5A80" data-text="Book a massage"></script>
</body></html>`)
  await page.goto(own.url)
  await page.getByRole('button', { name: 'Book a massage' }).click()
  await expect(page.getByRole('dialog', { name: 'Book a massage' })).toBeVisible()

  const frame = page.frameLocator('iframe[data-spa-widget="frame"]')
  await expect(frame.getByRole('heading', { name: 'Book a treatment' })).toBeVisible()
  await expect(frame.getByRole('link', { name: /Back to site/ })).toHaveCount(0)
  // The iframe may still be hydrating on the dev server: retry the first step until it advances.
  await expect(async () => {
    await frame
      .getByRole('region', { name: 'Swedish massage' })
      .getByRole('button', { name: /60 min/ })
      .click()
    await expect(frame.getByRole('button', { name: /^Tomorrow/ })).toBeVisible({ timeout: 2000 })
  }).toPass()
  await frame.getByRole('button', { name: /^Tomorrow/ }).click()
  await frame.getByTestId('slots').getByRole('button').first().click()
  await frame.getByLabel('Your name').fill('Layla Widget')
  await frame.getByLabel('UAE mobile').fill('050 765 4321')
  await frame.getByRole('button', { name: 'Request booking' }).click()
  await expect(frame.getByRole('heading', { name: 'Booking requested' })).toBeVisible()
  const ref = (await frame.getByTestId('booking-ref').textContent())?.trim() ?? ''

  // postMessage → the host page’s "booked" event.
  await expect.poll(() => page.evaluate(() => (window as { booked?: { ref: string } }).booked?.ref)).toBe(ref)
  const db = testDb()
  const [row] = await db
    .select({ status: bookings.status, source: bookings.source })
    .from(bookings)
    .where(and(eq(bookings.tenantId, seed.tenantId), eq(bookings.refCode, ref)))
  expect(row).toEqual({ status: 'pending', source: 'online' })
  // Cookieless analytics attribute the visit to the widget.
  await expect
    .poll(
      async () =>
        (
          await db
            .select({ source: webEvents.source })
            .from(webEvents)
            .where(and(eq(webEvents.tenantId, seed.tenantId), eq(webEvents.source, 'widget')))
        ).length,
    )
    .toBeGreaterThan(0)

  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  own.close()
})
