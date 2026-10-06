import { describe, expect, it } from 'vitest'
import { backupDatabase, backupKeys, dubaiDate } from '../src/jobs/backup'

describe('backups', () => {
  it('adds a monthly copy on the 1st', () => {
    expect(backupKeys('2026-10-06')).toEqual(['backups/daily/2026-10-06.dump'])
    expect(backupKeys('2026-11-01')).toEqual([
      'backups/daily/2026-11-01.dump',
      'backups/monthly/2026-11.dump',
    ])
  })
  it('dates by Asia/Dubai', () => {
    expect(dubaiDate(new Date('2026-10-31T21:00:00Z'))).toBe('2026-11-01')
  })
  it('skips cleanly when R2 is not configured', async () => {
    expect(await backupDatabase({})).toEqual({ skipped: true })
  })
})
