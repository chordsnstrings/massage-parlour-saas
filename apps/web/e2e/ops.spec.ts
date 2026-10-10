import { expect, test } from '@playwright/test'
import { base } from './helpers'

test('ops: security headers and client error reporting endpoint', async ({ request }) => {
  const res = await request.get(`${base}/api/health`)
  expect(res.status()).toBe(200)
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
