import { describe, expect, it } from 'vitest'
import {
  AUTOMATION_FEATURE,
  AUTOMATIONS,
  applyDiscount,
  branchCap,
  discountLabel,
  effectiveFeatures,
  FEATURES,
  monthlyAed,
  PLAN_FEATURES,
  parseDiscount,
  planFeatures,
  planTier,
  rowIncluded,
  tierLimits,
} from '../src'

const premium = { ai: true, marketing: true, multiBranch: true }
const standard = { ai: false, marketing: false, multiBranch: false }
const legacy = { branches: 3, staff: 50, customDomain: true, ...premium }

describe('plan entitlements (PLAN §18.8)', () => {
  it('Premium has every feature, Standard none, legacy every one', () => {
    expect(planFeatures(premium)).toEqual([...FEATURES])
    expect(planFeatures(standard)).toEqual([])
    expect(planFeatures(legacy)).toEqual([...FEATURES])
    expect(planTier(premium)).toBe('premium')
    expect(planTier(standard)).toBe('standard')
    expect(planTier({ ...premium, marketing: false })).toBe('standard')
  })

  it('a missing switch (plans made before §18.8, no plan) counts as included', () => {
    expect(planFeatures({ branches: 3 })).toEqual([...FEATURES])
    expect(planFeatures(null)).toEqual([...FEATURES])
    expect(planFeatures(undefined)).toEqual([...FEATURES])
  })

  it('the super-admin override wins over the plan', () => {
    expect(effectiveFeatures(standard, 'premium')).toEqual([...FEATURES])
    expect(effectiveFeatures(premium, 'standard')).toEqual([])
    expect(effectiveFeatures(standard, null)).toEqual([])
    expect(effectiveFeatures(premium)).toEqual([...FEATURES])
  })

  it('tierLimits are the switches the seeded plans store', () => {
    expect(tierLimits('premium')).toEqual(premium)
    expect(tierLimits('standard')).toEqual(standard)
  })

  it('branch cap: one branch without multiBranch, else the plan cap (none = unlimited)', () => {
    expect(branchCap([], standard)).toBe(1)
    expect(branchCap(['ai', 'marketing', 'multiBranch'], premium)).toBeNull()
    expect(branchCap(['multiBranch'], legacy)).toBe(3)
    // Standard billed, Premium granted: the plan has no cap → unlimited.
    expect(branchCap(effectiveFeatures(standard, 'premium'), standard)).toBeNull()
  })

  it('pricing comparison: Premium includes every row, Standard only the ungated ones', () => {
    expect(PLAN_FEATURES.every((r) => rowIncluded(r, 'premium'))).toBe(true)
    const std = PLAN_FEATURES.filter((r) => rowIncluded(r, 'standard'))
    expect(std.length).toBeGreaterThan(5)
    expect(std.every((r) => r.feature === null)).toBe(true)
    for (const f of FEATURES) expect(PLAN_FEATURES.some((r) => r.feature === f)).toBe(true)
    expect(new Set(PLAN_FEATURES.map((r) => r.key)).size).toBe(PLAN_FEATURES.length)
  })

  it('gated automations point at real switches', () => {
    for (const k of Object.keys(AUTOMATION_FEATURE)) expect(AUTOMATIONS).toContain(k)
    expect(AUTOMATION_FEATURE.bookingMessages).toBeUndefined()
  })

  it('monthly amount of a 12-month price', () => {
    expect(monthlyAed('36000')).toBe('3000.00')
    expect(monthlyAed(24000)).toBe('2000.00')
  })
})

describe('per-spa discounts', () => {
  it('parses form values', () => {
    expect(parseDiscount('none', '10')).toEqual({ ok: true, discount: null })
    expect(parseDiscount('percent', '')).toEqual({ ok: true, discount: null })
    expect(parseDiscount('percent', '0')).toEqual({ ok: true, discount: null })
    expect(parseDiscount('percent', '10%')).toEqual({
      ok: true,
      discount: { kind: 'percent', value: '10.00' },
    })
    expect(parseDiscount('amount', '1,500')).toEqual({
      ok: true,
      discount: { kind: 'amount', value: '1500.00' },
    })
    expect(parseDiscount('percent', '101').ok).toBe(false)
    expect(parseDiscount('amount', '-5').ok).toBe(false)
    expect(parseDiscount('amount', '1.234').ok).toBe(false)
    expect(parseDiscount('bogus', '5').ok).toBe(false)
  })

  it('applies percent and amount discounts, never below zero', () => {
    expect(applyDiscount('14000', { kind: 'percent', value: '10' })).toEqual({
      netAed: '12600.00',
      discountAed: '1400.00',
    })
    expect(applyDiscount('3000', { kind: 'amount', value: '500' })).toEqual({
      netAed: '2500.00',
      discountAed: '500.00',
    })
    expect(applyDiscount('9000', { kind: 'amount', value: '20000' })).toEqual({
      netAed: '0.00',
      discountAed: '9000.00',
    })
    expect(applyDiscount('2000', null)).toEqual({ netAed: '2000.00', discountAed: '0.00' })
    // Percent rounds to the cent.
    expect(applyDiscount('2000.01', { kind: 'percent', value: '33.33' }).discountAed).toBe('666.60')
  })

  it('an amount off the monthly fee counts per month on a 12-month invoice', () => {
    expect(applyDiscount('24000', { kind: 'amount', value: '100' }, 12)).toEqual({
      netAed: '22800.00',
      discountAed: '1200.00',
    })
    // Percent doesn't depend on the months.
    expect(applyDiscount('24000', { kind: 'percent', value: '10' }, 12).discountAed).toBe('2400.00')
  })

  it('labels', () => {
    expect(discountLabel({ kind: 'percent', value: '10.00' })).toBe('10%')
    expect(discountLabel({ kind: 'percent', value: '12.50' })).toBe('12.5%')
    expect(discountLabel({ kind: 'amount', value: '500' })).toBe('AED 500.00')
  })
})
