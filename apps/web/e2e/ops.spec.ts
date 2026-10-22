import { expect, test } from '@playwright/test'
import { platformJobRuns } from '@spa/db'
import { eq } from 'drizzle-orm'
import { base, signInPlatformAdmin, testDb } from './helpers'

test('ops: security headers and client error reporting endpoint', async ({ request }) => {
  const res = await request.get(`${base}/api/health`)
  expect(res.status()).toBe(200)
  // R37: public on every host (spa sites too), so no worker state: that is in the console + /_status only.
  expect(Object.keys(await res.json()).sort()).toEqual(['ok', 'release'])
  const h = res.headers()
  expect(h['x-content-type-options']).toBe('nosniff')
  // F10: API responses are never framed (pages: security-headers.spec).
  expect(h['x-frame-options']).toBe('DENY')
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'")
  expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin')

  const ok = await request.post(`${base}/api/client-error`, {
    data: {
      message: 'Test error',
      stack: 'Error: Test error\n    at x (y.js:1:1)',
      url: '/app/x?token=secret',
    },
  })
  expect(ok.status()).toBe(204)
  expect((await request.post(`${base}/api/client-error`, { data: { nope: 1 } })).status()).toBe(400)
})

// R37: a stale worker heartbeat's figures read "As of …" with an amber "old" badge instead of a green ok (fresh:
// unchanged).
test('ops: stale worker heartbeat in the console', async ({ page }) => {
  const db = testDb()
  const old = new Date(Date.now() - 2 * 86_400_000)
  const [beat] = await db
    .insert(platformJobRuns)
    .values({
      job: 'worker-heartbeat',
      status: 'ok',
      details: {
        disk: { usedPct: 42.5, freeGb: 50 },
        deploy: { state: 'building', commit: 'abcdef1234567', message: 'building abcdef1' },
        config: { TURNSTILE: false }, // the web sees the Turnstile test keys (set)
      },
      startedAt: old,
      finishedAt: old,
    })
    .returning({ id: platformJobRuns.id })
  const asOf = /As of \d{1,2} \w{3}, \d{1,2}:\d{2} \(worker not reporting\): /
  try {
    await signInPlatformAdmin(page)
    const worker = page.getByTestId('health-worker')
    const disk = page.getByTestId('health-disk')
    const deploy = page.getByTestId('health-deploy')
    const turnstile = page.getByTestId('config-TURNSTILE')

    await test.step('stale: old figures say when they are from, never green', async () => {
      await expect(worker).toHaveAttribute('data-ok', 'false')
      await expect(worker).toContainText(/min ago \(\d{1,2} \w{3}, \d{1,2}:\d{2}\): the worker looks down/)
      await expect(disk).toContainText(new RegExp(`${asOf.source}42\\.5% used · 50 GB free`))
      await expect(disk).toHaveAttribute('data-stale', 'true')
      await expect(disk.getByText('old', { exact: true })).toBeVisible()
      await expect(deploy).toContainText(new RegExp(`${asOf.source}building · abcdef1 · building abcdef1`))
      await expect(deploy.getByText('old', { exact: true })).toBeVisible()
      // The config row's own check is the web's (current): only the worker's note is dated.
      await expect(turnstile).toHaveAttribute('data-ok', 'true')
      await expect(turnstile).toContainText(/worker saw it missing as of .+ \(worker not reporting\)/)
    })

    await test.step('fresh: unchanged rendering', async () => {
      await db.update(platformJobRuns).set({ finishedAt: new Date() }).where(eq(platformJobRuns.id, beat!.id))
      await page.reload()
      await expect(worker).toHaveAttribute('data-ok', 'true')
      await expect(disk).toContainText('42.5% used · 50 GB free')
      await expect(disk).not.toContainText('As of')
      await expect(disk).not.toHaveAttribute('data-stale')
      await expect(disk.getByText('ok', { exact: true })).toBeVisible()
      await expect(deploy.getByText('ok', { exact: true })).toBeVisible()
      await expect(turnstile).toContainText('worker sees it missing')
      await expect(turnstile).not.toContainText('as of')
    })
  } finally {
    await db.delete(platformJobRuns).where(eq(platformJobRuns.id, beat!.id))
  }
})
