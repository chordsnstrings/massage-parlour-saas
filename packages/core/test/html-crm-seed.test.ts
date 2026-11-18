import { describe, expect, it } from 'vitest'
import { crmMatchScore, designSeedPairs, SEED_MATCH_MIN } from '../src/html-crm-seed'

const crm = (en: string, ar?: string) => ({ names: ar ? [en, ar] : [en] })

describe('crmMatchScore', () => {
  it('scores an identical normalised name or the slug as id 1', () => {
    expect(crmMatchScore({ name: 'Normal massage' }, crm('Normal Massage'))).toBe(1)
    expect(crmMatchScore({ name: 'Hot oil / balm massage' }, crm('Hot Oil / Balm Massage'))).toBe(1)
    expect(crmMatchScore({ name: 'Something else', id: 'couple-massage' }, crm('Couple Massage'))).toBe(1)
    expect(crmMatchScore({ name: 'تدليك' }, crm('Normal Massage', 'تدليك'))).toBe(1)
    expect(crmMatchScore({ id: 'x' }, { names: ['Thai'], slug: 'x' })).toBe(1)
  })

  it('accepts near names below 1: number words, 5-letter prefixes, plurals, joining words', () => {
    const four = crmMatchScore({ name: '4-hands massage' }, crm('Four Hands Massage'))
    expect(four).toBeGreaterThanOrEqual(SEED_MATCH_MIN)
    expect(four).toBeLessThan(1)
    expect(
      crmMatchScore({ name: 'Moroccan bath or jacuzzi' }, crm('Morocco Bath or Jacuzzi')),
    ).toBeGreaterThan(0.9)
    expect(
      crmMatchScore({ name: 'Moroccan bath and jacuzzi' }, crm('Morocco Bath or Jacuzzi')),
    ).toBeGreaterThan(0.9)
    expect(crmMatchScore({ name: 'Couples massage' }, crm('Couple Massage'))).toBeGreaterThan(0.9)
    expect(crmMatchScore({ name: '4hands massage' }, crm('Four Hands Massage'))).toBeGreaterThan(0.9)
    // Token Jaccard: 2 of 3 words shared.
    expect(crmMatchScore({ name: 'Thai massage' }, crm('Thai Massage Deluxe'))).toBeCloseTo(2 / 3)
  })

  it('keeps unrelated names under the threshold', () => {
    expect(crmMatchScore({ name: 'Massage with shaving' }, crm('Normal Massage'))).toBeLessThan(
      SEED_MATCH_MIN,
    )
    expect(crmMatchScore({ name: 'Full body shaving' }, crm('Hot Oil / Balm Massage'))).toBe(0)
    expect(crmMatchScore({ name: 'Normal massage' }, crm('Couple Massage'))).toBeLessThan(SEED_MATCH_MIN)
    expect(crmMatchScore({ name: '' }, crm('Couple Massage'))).toBe(0)
    expect(crmMatchScore({ name: 'Couple massage' }, { names: [''] })).toBe(0)
    // Short words need the whole word (no 5-letter prefix): "hot" ≠ "hotel".
    expect(crmMatchScore({ name: 'Hot stone' }, crm('Hotel stay'))).toBe(0)
  })
})

describe('designSeedPairs', () => {
  // The live BE RELAX design and CRM (2026-10-12).
  const design = [
    { id: 'normal', name: 'Normal massage' },
    { id: 'hot-oil', name: 'Hot oil / balm massage' },
    { id: 'four-hands', name: '4-hands massage' },
    { id: 'couple', name: 'Couple massage' },
    { id: 'moroccan', name: 'Moroccan bath or jacuzzi' },
    { id: 'shaving-massage', name: 'Massage with shaving' },
    { id: 'shaving', name: 'Full body shaving' },
  ]
  const crmServices = [
    crm('Morocco Bath or Jacuzzi'),
    crm('Four Hands Massage'),
    crm('Normal Massage'),
    crm('Hot Oil / Balm Massage'),
    crm('Couple Massage'),
  ]

  it('pairs the live BE RELAX treatments and leaves the shaving ones unmatched', () => {
    const pairs = designSeedPairs(design, crmServices)
    const named = pairs.map((p) => (p ? crmServices[p.crm]!.names[0] : null))
    expect(named).toEqual([
      'Normal Massage',
      'Hot Oil / Balm Massage',
      'Four Hands Massage',
      'Couple Massage',
      'Morocco Bath or Jacuzzi',
      null,
      null,
    ])
    expect(pairs[0]!.score).toBe(1)
    expect(pairs[2]!.score).toBeLessThan(1)
  })

  it('pairs each CRM service once, best score first', () => {
    const pairs = designSeedPairs(
      [{ name: 'Thai massage deluxe' }, { name: 'Thai massage' }],
      [crm('Thai Massage')],
    )
    expect(pairs).toEqual([null, { crm: 0, score: 1 }])
    // Equal scores: the first design service wins.
    expect(
      designSeedPairs([{ name: 'Couple massage' }, { name: 'Couple massage' }], [crm('Couple Massage')]),
    ).toEqual([{ crm: 0, score: 1 }, null])
    expect(designSeedPairs([], [crm('A')])).toEqual([])
    expect(designSeedPairs([{ name: 'Couple massage' }], [])).toEqual([null])
  })
})
