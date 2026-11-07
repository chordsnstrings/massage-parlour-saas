import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendStaffEmail } from '../src/email'

const msg = { to: 'a@b.test', subject: 'Reset', text: 'secret link https://x/reset?token=abc' }

describe('sendStaffEmail without RESEND_API_KEY (G2)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('fails loudly in production and never logs the body', async () => {
    vi.stubEnv('RESEND_API_KEY', '')
    vi.stubEnv('NODE_ENV', 'production')
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(sendStaffEmail(msg)).rejects.toThrow(/RESEND_API_KEY/)
    const logged = [...info.mock.calls, ...error.mock.calls].flat().join(' ')
    expect(logged).not.toContain('token=abc')
    expect(error).toHaveBeenCalled()
  })

  it('prints the email in dev/test', async () => {
    vi.stubEnv('RESEND_API_KEY', '')
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    await sendStaffEmail(msg)
    expect(info.mock.calls.flat().join(' ')).toContain('token=abc')
  })
})
