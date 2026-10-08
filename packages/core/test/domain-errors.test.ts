// apps/web has no unit runner, so the web-side DomainError lookup is tested here (it only imports @spa/core/i18n).
import { describe, expect, it } from 'vitest'
import { domainErrorRef } from '../../../apps/web/src/i18n/domain-errors'
import { translator } from '../src/i18n'

// Real messages thrown by packages/services (literal + filled-in templates).
const SAMPLES = [
  'Booking not found',
  'That time was just taken — please pick another slot',
  'Domain purchases aren’t set up yet — ask support.',
  "That doesn't look like a valid domain name",
  'That domain is already connected to another spa. Contact support if it is yours.',
  "Can't change a checked in booking to no show",
  "A in service booking can't be checked out",
  'This sale is already void',
  'AED 12.50 still to pay',
  'Payments are AED 3.00 more than the total',
  'At most 2 of “Hot stone 60” can be refunded',
  '“Thai massage” is covered by a package — its price must be 0',
  'This global section is on 3 pages — remove it there first.',
  'This global section is on 1 page — remove it there first.',
  'Checked a moment ago — try again in 12 seconds.',
  'serenityspa.ae is no longer available',
  'Too long for an Instagram DM (1200/1000 bytes; Arabic letters count as 2) — shorten it a little.',
  'Unbalanced entry (10 ≠ 12)',
]

describe('DomainError → catalogue key', () => {
  const en = translator('en')
  const th = translator('th')
  it.each(SAMPLES)('maps %s to an existing key that re-renders the same English', (message) => {
    const ref = domainErrorRef(message)
    expect(ref, message).toBeDefined()
    if (!ref) return
    expect(en.has(ref.key)).toBe(true)
    expect(th.has(ref.key)).toBe(true)
    expect(en(ref.key, ref.params)).toBe(message)
    expect(th(ref.key, ref.params)).not.toBe(message)
  })

  it('translates status words inside sentences', () => {
    const ref = domainErrorRef("Can't change a checked in booking to no show")
    expect(th(ref!.key, ref!.params)).toBe('ไม่สามารถเปลี่ยนการจองจาก “เช็กอินแล้ว” เป็น “ไม่มาตามนัด” ได้')
  })

  it('leaves unknown messages alone', () => {
    expect(domainErrorRef('Namecheap said: account locked')).toBeUndefined()
  })
})
