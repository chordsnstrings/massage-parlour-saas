import { describe, expect, it } from 'vitest'
import { migrationUrl } from '../src/migrate'

describe('migrationUrl (G7)', () => {
  it('adds lock and statement timeouts, keeping existing options', () => {
    const u = new URL(migrationUrl('postgres://o:p@db:5432/spa?options=-c%20search_path%3Dpublic', {}))
    expect(u.searchParams.get('options')).toBe(
      '-c search_path=public -c lock_timeout=10s -c statement_timeout=15min',
    )
    const custom = new URL(migrationUrl('postgres://o:p@db/spa', { MIGRATE_LOCK_TIMEOUT: '3s' }))
    expect(custom.searchParams.get('options')).toContain('lock_timeout=3s')
  })
})
