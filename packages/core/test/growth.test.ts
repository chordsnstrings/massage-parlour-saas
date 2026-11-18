// F15 client drafts (quiet hours, settings), F15 voucher scan input, F16 poster links, worker-side site address.
import { describe, expect, it } from 'vitest'
import {
  afterQuietHours,
  CLIENT_DRAFT_DEFAULTS,
  clientDraftSettings,
  dubaiInstant,
  freeSiteUrl,
  giftCardInput,
  inQuietHours,
  newPartnerCode,
  PARTNER_CODE,
  posterBookingUrl,
} from '../src'

const D = '2026-10-10'
const at = (h: number, m = 0) => dubaiInstant(D, h * 60 + m)

describe('quiet hours (Dubai time)', () => {
  const night = { quietStart: '21:00', quietEnd: '10:00' }
  it('crosses midnight: late evening and early morning are quiet', () => {
    expect(inQuietHours(at(22), night)).toBe(true)
    expect(inQuietHours(at(3), night)).toBe(true)
    expect(inQuietHours(at(10), night)).toBe(false)
    expect(inQuietHours(at(20, 59), night)).toBe(false)
  })
  it('moves a due time to the end of the quiet hours (same morning or next day)', () => {
    expect(afterQuietHours(at(3), night)).toEqual(at(10))
    expect(afterQuietHours(at(22), night)).toEqual(dubaiInstant('2026-10-11', 600))
    expect(afterQuietHours(at(14), night)).toEqual(at(14))
  })
  it('daytime window and no window', () => {
    const lunch = { quietStart: '13:00', quietEnd: '15:00' }
    expect(afterQuietHours(at(13, 30), lunch)).toEqual(at(15))
    expect(afterQuietHours(at(3), { quietStart: '00:00', quietEnd: '00:00' })).toEqual(at(3))
  })
})

describe('clientDraftSettings', () => {
  it('fills defaults and drops invalid values', () => {
    expect(clientDraftSettings(null)).toEqual(CLIENT_DRAFT_DEFAULTS)
    expect(
      clientDraftSettings({
        clientDrafts: {
          quietStart: '25:00',
          quietEnd: '09:30',
          reviewLink: 'javascript:alert(1)',
          reviewDelayHours: 500,
          winbackDays: 90,
        },
      }),
    ).toEqual({ ...CLIENT_DRAFT_DEFAULTS, quietEnd: '09:30', winbackDays: 90 })
    expect(
      clientDraftSettings({ clientDrafts: { reviewLink: 'https://g.page/r/x/review' } }).reviewLink,
    ).toBe('https://g.page/r/x/review')
  })
})

describe('voucher + partner links', () => {
  const token = '0123456789abcdef0123456789abcdef'
  it('reads a scanned voucher QR (check-page URL) or a typed code', () => {
    expect(giftCardInput(`https://serenity.spamanagement.co/voucher/${token}`)).toEqual({ token })
    expect(
      giftCardInput(`https://spamanagement.co/s/serenity/voucher/${token.toUpperCase()}?lang=ar`),
    ).toEqual({
      token,
    })
    expect(giftCardInput(token)).toEqual({ token })
    expect(giftCardInput(' 7kq2-m9xa ')).toEqual({ code: '7KQ2-M9XA' })
  })
  it('poster booking links carry src=qr and the partner code', () => {
    expect(posterBookingUrl('https://serenity.spamanagement.co')).toBe(
      'https://serenity.spamanagement.co/book?src=qr',
    )
    expect(posterBookingUrl('https://spamanagement.co/s/serenity/', 'h7k2pq')).toBe(
      'https://spamanagement.co/s/serenity/book?src=qr&partner=h7k2pq',
    )
    for (let i = 0; i < 20; i++) expect(newPartnerCode()).toMatch(PARTNER_CODE)
  })
  it('free site address without a request follows the routing mode', () => {
    expect(
      freeSiteUrl('serenity', { ROOT_DOMAIN: 'spamanagement.co', APP_URL: 'https://spamanagement.co' }),
    ).toBe('https://spamanagement.co/s/serenity')
    expect(
      freeSiteUrl('serenity', { ROOT_DOMAIN: 'spamanagement.co', APP_URL: 'https://app.spamanagement.co' }),
    ).toBe('https://serenity.spamanagement.co')
    expect(
      freeSiteUrl('serenity', { ROOT_DOMAIN: 'localhost:3100', APP_URL: 'http://app.localhost:3100' }),
    ).toBe('http://serenity.localhost:3100')
  })
})
