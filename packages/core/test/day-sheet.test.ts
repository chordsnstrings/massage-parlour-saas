import { describe, expect, it } from 'vitest'
import {
  daySheetColumns,
  phoneLineOptions,
  phoneLinesConfigured,
  sheetCode,
  sheetTotals,
  turnNumbers,
} from '../src/day-sheet'

describe('R32 day sheet helpers', () => {
  it('sheetCode: phone → P{line}, walk-in → W, every other source → B, plus /R or /N', () => {
    const sources = ['walk_in', 'online', 'whatsapp', 'instagram', 'phone', 'ai_agent', 'website'] as const
    for (const source of sources)
      for (const phoneLine of [null, 1, 2, 3, 4])
        for (const clientType of [null, 'regular', 'new']) {
          const base = source === 'phone' ? `P${phoneLine ?? ''}` : source === 'walk_in' ? 'W' : 'B'
          const suffix = clientType === 'regular' ? '/R' : clientType === 'new' ? '/N' : ''
          expect(sheetCode({ source, phoneLine, clientType })).toBe(base + suffix)
        }
    expect(sheetCode({ source: 'phone', phoneLine: 2, clientType: 'regular' })).toBe('P2/R')
    expect(sheetCode({ source: 'phone', phoneLine: null, clientType: 'new' })).toBe('P/N')
    expect(sheetCode({ source: 'phone', phoneLine: 7, clientType: null })).toBe('P')
    expect(sheetCode({ source: 'whatsapp', phoneLine: 3, clientType: null })).toBe('B')
  })

  it('turnNumbers reproduces the 13-10-26 paper sheet (own leads 0, no therapist null)', () => {
    const rows: [string, boolean][] = [
      ['Lisa', false],
      ['Bella', false],
      ['Luna', false],
      ['Manar', false],
      ['Lita', true],
      ['Natcha', false],
      ['Bella', true],
      ['Luna', false],
      ['Lita', false],
      ['Natcha', false],
      ['Lisa', false],
      ['Sara', true],
      ['Luna', false],
    ]
    const q = turnNumbers([
      ...rows.map(([staffId, ownLead], i) => ({ key: String(i + 1), staffId, ownLead })),
      { key: 'x', staffId: null, ownLead: false },
    ])
    expect(rows.map((_, i) => q.get(String(i + 1)))).toEqual([1, 1, 1, 1, 0, 1, 0, 2, 1, 2, 2, 0, 3])
    expect(q.get('x')).toBeNull()
  })

  it('sheetTotals: 1460 + 1080 − 58 = 2482; cash 1402 (fils)', () => {
    expect(sheetTotals({ cash: 146000, card: 108000, other: 0, expenses: 5800 })).toEqual({
      totalSale: 248200,
      totalCard: 108000,
      totalCash: 140200,
    })
    expect(sheetTotals({ cash: 0, card: 0, other: 5000, expenses: 0 }).totalSale).toBe(5000)
  })

  it('daySheetColumns defaults to tips on, commission off', () => {
    expect(daySheetColumns({})).toEqual({ tips: true, commission: false })
    expect(daySheetColumns(null)).toEqual({ tips: true, commission: false })
    expect(daySheetColumns({ daySheet: { tips: false, commission: true } })).toEqual({
      tips: false,
      commission: true,
    })
  })

  it('phoneLineOptions lists only lines with a number (blank and missing skipped)', () => {
    expect(phoneLineOptions({})).toEqual([])
    expect(phoneLinesConfigured({ phoneLines: ['', '  '] })).toBe(false)
    expect(phoneLineOptions({ phoneLines: ['', ' 04 123 4567 ', '', '050 1'] })).toEqual([
      { line: 2, number: '04 123 4567' },
      { line: 4, number: '050 1' },
    ])
    expect(phoneLinesConfigured({ phoneLines: ['04 1'] })).toBe(true)
  })
})
