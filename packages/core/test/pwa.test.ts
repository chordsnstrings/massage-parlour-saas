import { describe, expect, it } from 'vitest'
import { appInitials, nameWords, pwaAppName, slugInitials } from '../src/pwa'

describe('pwaAppName', () => {
  it.each([
    ['Tamara Spa & Wellness', 'Tamara Management'],
    ['Serenity', 'Serenity Management'],
    ['  Lotus   Garden Spa ', 'Lotus Management'],
    ["Tamara's Spa", 'Tamara Management'],
    ['“Zen” Spa', 'Zen Management'],
    ['The Royal Spa', 'Royal Management'],
    ['Al Noor Spa', 'Noor Management'],
    ['Al-Noor Spa', 'Al-Noor Management'],
    ['The', 'The Management'],
    ['tamara spa', 'Tamara Management'],
    ['1001 Nights Spa', '1001 Management'],
    ['& Co. Spa', 'Co Management'],
    ['نور سبا', 'نور Management'],
    ['สปาสบายดี', 'สปาสบายดี Management'],
    ['บ้าน สปา', 'บ้าน Management'],
    ['', 'Spa Management'],
    ['&—!', 'Spa Management'],
  ])('%s → %s', (name, expected) => expect(pwaAppName(name)).toBe(expected))
})

describe('appInitials', () => {
  it.each([
    ['Tamara Spa & Wellness', 'TS'],
    ['Serenity', 'S'],
    ['lotus garden', 'LG'],
    ['The Royal Spa', 'RS'],
    ['& Co. Spa', 'CS'],
    ['نور سبا', 'نس'],
    ['สปาสบายดี', 'ส'],
    ['', ''],
  ])('%s → %s', (name, expected) => expect(appInitials(name)).toBe(expected))

  it('keeps a combining mark with its letter', () => {
    expect(appInitials('Évora Spa')).toBe('ÉS')
    expect(appInitials('Évora Spa')).toBe('ÉS')
  })
})

describe('slugInitials / nameWords', () => {
  it('reads slugs', () => {
    expect(slugInitials('sabai-spa')).toBe('SS')
    expect(slugInitials('noor')).toBe('N')
    expect(slugInitials('')).toBe('')
  })
  it('drops punctuation-only words', () => {
    expect(nameWords('Spa - & - Wellness')).toEqual(['Spa', 'Wellness'])
  })
})
