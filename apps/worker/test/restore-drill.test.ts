import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { closeAllDbs, jobRuns, tenants } from '@spa/db'
import { resetTestDatabase, testDbs, testUrls } from '@spa/db/testing'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { jobs } from '../src/jobs'
import { latestBackupKey, restoreDrill } from '../src/jobs/restore-drill'

const run = promisify(execFile)
const { owner } = testDbs()
/** A role with CREATEDB on the test cluster (local trust auth; CI sets PGPASSWORD). */
const admin = process.env.TEST_PG_ADMIN_URL ?? 'postgres://postgres@localhost:5432/postgres'
const env = { RESTORE_DRILL_ADMIN_URL: admin, DATABASE_URL_PLATFORM: testUrls.platform }

describe('restore drill (B6)', () => {
  beforeAll(async () => {
    await resetTestDatabase()
    await owner.insert(tenants).values({ slug: 'drill', name: 'Drill spa' })
  })
  afterAll(() => closeAllDbs())

  it('runs monthly', () => {
    expect(jobs.find((j) => j.name === 'restore-drill')?.cron).toBe('0 5 2 * *')
  })

  it('picks the newest daily dump from an R2 listing', () => {
    const xml =
      '<ListBucketResult><Contents><Key>backups/daily/2026-10-01.dump</Key></Contents>' +
      '<Contents><Key>backups/daily/2026-10-07.dump</Key></Contents><Contents><Key>backups/daily/x.txt</Key></Contents></ListBucketResult>'
    expect(latestBackupKey(xml)).toBe('backups/daily/2026-10-07.dump')
    expect(latestBackupKey('<ListBucketResult/>')).toBeNull()
  })

  it('skips cleanly when R2 is not configured', async () => {
    expect(await restoreDrill({})).toEqual({ status: 'skipped', reason: 'r2_not_configured' })
  })

  it('restores the dump into a scratch database, counts, drops it and records the run', async () => {
    const r = await restoreDrill(env, {
      download: async (dest) => {
        await run('pg_dump', [
          '--format=custom',
          '--no-owner',
          `--dbname=${testUrls.owner}`,
          `--file=${dest}`,
        ])
        return 'backups/daily/test.dump'
      },
    })
    expect(r).toMatchObject({ status: 'ok', key: 'backups/daily/test.dump', counts: { tenants: 1 } })
    if (r.status === 'ok') expect(r.counts?.migrations).toBeGreaterThan(0)
    const { rows } = await owner.execute<{ n: number }>(
      sql`select count(*)::int as n from pg_database where datname like 'spa_restore_drill_%'`,
    )
    expect(rows[0]!.n).toBe(0)
    const [row] = await owner.select().from(jobRuns).where(eq(jobRuns.job, 'restore-drill'))
    expect(row).toMatchObject({ status: 'ok', details: { key: 'backups/daily/test.dump' } })
  })

  it('records a failed drill (unreadable dump) and throws so the job retries / reports', async () => {
    await expect(
      restoreDrill(env, {
        download: async (dest) => {
          await writeFile(dest, 'not a dump')
          return 'backups/daily/bad.dump'
        },
      }),
    ).rejects.toThrow('restore drill failed')
    const rows = await owner.select().from(jobRuns).where(eq(jobRuns.status, 'failed'))
    expect(rows).toHaveLength(1)
  })
})
