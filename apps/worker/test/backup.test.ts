import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { backupDatabase, backupKeys, dubaiDate, offsiteConfig } from '../src/jobs/backup'

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
  it('skips cleanly when no off-site bucket is configured', async () => {
    expect(await backupDatabase({})).toEqual({ skipped: true, reason: 'offsite_not_configured' })
  })
  it('reads R2_*, else falls back to the S3_* bucket (G1)', () => {
    const r2 = {
      R2_ENDPOINT: 'https://r2/',
      R2_BUCKET: 'b',
      R2_ACCESS_KEY_ID: 'k',
      R2_SECRET_ACCESS_KEY: 's',
    }
    const s3 = {
      S3_ENDPOINT: 'https://s3',
      S3_BUCKET: 'm',
      S3_ACCESS_KEY_ID: 'k3',
      S3_SECRET_ACCESS_KEY: 's3',
    }
    expect(offsiteConfig(r2)).toMatchObject({ endpoint: 'https://r2', bucket: 'b', source: 'R2' })
    expect(offsiteConfig(s3)).toMatchObject({ endpoint: 'https://s3', bucket: 'm', source: 'S3' })
    expect(offsiteConfig({ ...r2, ...s3 })?.source).toBe('R2')
    // A half-set R2 config is a mistake, not a reason to write backups into the media bucket.
    expect(offsiteConfig({ ...s3, R2_BUCKET: 'b' })).toBeNull()
    expect(offsiteConfig({})).toBeNull()
  })
  it('passes the off-site vars to the worker in the droplet compose file', () => {
    const compose = readFileSync(new URL('../../../deploy/droplet/compose.yml', import.meta.url), 'utf8')
    for (const k of ['R2_ENDPOINT', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'S3_BUCKET'])
      expect(compose).toContain(`${k}: \${${k}:-}`)
  })
})
