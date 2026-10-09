import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { drillRoleProblem } from '@spa/core'
import { closeAllDbs, platformJobRuns, tenants } from '@spa/db'
import { resetTestDatabase, testDbs, testUrls } from '@spa/db/testing'
import { and, desc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { jobs } from '../src/jobs'
import { backupDatabase } from '../src/jobs/backup'
import {
  derivedDrillPassword,
  drillUrl,
  latestBackupKey,
  restoreDrill,
  restoreList,
} from '../src/jobs/restore-drill'

const run = promisify(execFile)
const { owner } = testDbs()
/** The postgres superuser of the test cluster (local trust auth; CI sets PGPASSWORD). */
const superUrl = process.env.TEST_PG_ADMIN_URL ?? 'postgres://postgres@localhost:5432/postgres'
/** F11: the least-privilege drill role (scripts/local-db.sh / CI bootstrap: drill_password=spa_drill_dev). */
const drill = process.env.TEST_PG_DRILL_URL ?? 'postgres://spa_drill:spa_drill_dev@localhost:5432/postgres'
const env = { DATABASE_URL_DRILL: drill, DATABASE_URL_PLATFORM: testUrls.platform }
const liveDb = new URL(testUrls.owner).pathname.slice(1)
const psqlAs = (url: string, db: string, q: string) => {
  const u = new URL(url)
  u.pathname = `/${db}`
  return run('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', `--dbname=${u}`, '-c', q])
}
const asSuper = (db: string, q: string) => psqlAs(superUrl, db, q)
const asDrill = (db: string, q: string) => psqlAs(drill, db, q)
const dbExists = async (name: string) =>
  (await asSuper('postgres', `select count(*) from pg_database where datname = '${name}'`)).stdout.trim() ===
  '1'
const dumpLive = async (dest: string) => {
  await run('pg_dump', ['--format=custom', '--no-owner', `--dbname=${testUrls.owner}`, `--file=${dest}`])
  return 'backups/daily/test.dump'
}
const lastDrill = async () =>
  (
    await owner
      .select()
      .from(platformJobRuns)
      .where(eq(platformJobRuns.job, 'restore-drill'))
      .orderBy(desc(platformJobRuns.finishedAt))
      .limit(1)
  )[0]

describe('restore drill (B6, F11)', () => {
  beforeAll(async () => {
    await resetTestDatabase()
    await owner.insert(tenants).values({ slug: 'drill', name: 'Drill spa' })
    // Production's live database has the superuser-only pg_stat_statements; the drill role must restore around it.
    await asSuper(liveDb, 'create extension if not exists pg_stat_statements')
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

  it('records a skipped off-site backup for the console (G1)', async () => {
    await backupDatabase({ DATABASE_URL_PLATFORM: testUrls.platform })
    const [row] = await owner.select().from(platformJobRuns).where(eq(platformJobRuns.job, 'db-backup'))
    expect(row).toMatchObject({ status: 'skipped', details: { reason: 'offsite_not_configured' } })
  })

  it('derives the spa_drill URL from the owner URL with the bootstrap.sql password formula (F11)', async () => {
    const u = new URL(drillUrl({ DATABASE_URL_OWNER: 'postgres://spa_owner:s3cr%40t@postgres:5432/spa' })!)
    expect([u.username, u.host, u.pathname]).toEqual(['spa_drill', 'postgres:5432', '/postgres'])
    expect(u.password).toBe(derivedDrillPassword('s3cr@t'))
    const { stdout } = await asSuper(
      'postgres',
      "select encode(sha256(convert_to('spa_drill:' || 's3cr@t', 'UTF8')), 'hex')",
    )
    expect(stdout.trim()).toBe(derivedDrillPassword('s3cr@t'))
    const own = new URL(
      drillUrl({ DATABASE_URL_OWNER: 'postgres://o:p@h/spa', SPA_DRILL_PASSWORD: 'x/y@z' })!,
    )
    expect(decodeURIComponent(own.password)).toBe('x/y@z')
    expect(drillUrl({ DATABASE_URL_DRILL: drill, DATABASE_URL_OWNER: 'postgres://o:p@h/spa' })).toBe(drill)
    expect(drillUrl({})).toBeNull()
  })

  it('classifies roles: CREATEDB only is fit; superuser and friends are refused', () => {
    const fit = {
      rolsuper: false,
      rolcreatedb: true,
      rolcreaterole: false,
      rolbypassrls: false,
      rolreplication: false,
    }
    expect(drillRoleProblem(fit)).toBeNull()
    expect(drillRoleProblem({ ...fit, rolsuper: true, rolbypassrls: true })).toBe('has SUPERUSER, BYPASSRLS')
    expect(drillRoleProblem({ ...fit, rolcreatedb: false })).toBe('no CREATEDB')
    expect(drillRoleProblem(null)).toBe('role missing')
  })

  it('leaves superuser-only extensions (and their comments) out of the restore list', () => {
    const toc = [
      '2; 3079 1 EXTENSION - btree_gist ',
      '3820; 0 0 COMMENT - EXTENSION btree_gist ',
      '5; 3079 2 EXTENSION - pg_stat_statements ',
      '3822; 0 0 COMMENT - EXTENSION pg_stat_statements ',
      '230; 1259 3 TABLE public tenants spa_owner',
    ].join('\n')
    const r = restoreList(toc, ['pg_stat_statements', 'dblink'])
    expect(r.skipped).toEqual(['pg_stat_statements'])
    expect(r.list).not.toContain('pg_stat_statements')
    expect(r.list).toContain('COMMENT - EXTENSION btree_gist')
    expect(r.list).toContain('TABLE public tenants')
  })

  it('refuses to run as a superuser: no download, no database, a failed run on record (F11)', async () => {
    let downloaded = false
    const before = await asSuper(
      'postgres',
      `select count(*) from pg_database where datname like 'spa_restore%'`,
    )
    await expect(
      restoreDrill(
        { DATABASE_URL_DRILL: superUrl, DATABASE_URL_PLATFORM: testUrls.platform },
        {
          download: async (dest) => {
            downloaded = true
            return dumpLive(dest)
          },
        },
      ),
    ).rejects.toThrow(/refusing to run as role postgres: has SUPERUSER/)
    expect(downloaded).toBe(false)
    const after = await asSuper(
      'postgres',
      `select count(*) from pg_database where datname like 'spa_restore%'`,
    )
    expect(after.stdout).toBe(before.stdout)
    expect(await lastDrill()).toMatchObject({ status: 'failed', details: { role: 'postgres' } })
  })

  it('records an unreachable drill role as a refused run, with no password in the error', async () => {
    const wrong = new URL(drill)
    wrong.username = 'spa_drill_missing'
    wrong.password = 'hunter2secret'
    await expect(
      restoreDrill(
        { DATABASE_URL_DRILL: wrong.toString(), DATABASE_URL_PLATFORM: testUrls.platform },
        {
          download: dumpLive,
        },
      ),
    ).rejects.toThrow(/cannot connect/)
    const row = await lastDrill()
    expect(row?.status).toBe('failed')
    expect(JSON.stringify(row?.details)).not.toContain('hunter2secret')
  })

  it('the drill role cannot read or drop the live database', async () => {
    await expect(asDrill(liveDb, 'select count(*) from public.tenants')).rejects.toThrow(/permission denied/)
    await expect(asDrill('postgres', `drop database "${liveDb}"`)).rejects.toThrow(/must be owner/)
  })

  it('restores as spa_drill into its own scratch database, counts, drops only it and records the run', async () => {
    const r = await restoreDrill(env, { download: dumpLive })
    expect(r).toMatchObject({
      status: 'ok',
      role: 'spa_drill',
      key: 'backups/daily/test.dump',
      counts: { tenants: 1 },
      skipped: ['pg_stat_statements'],
    })
    if (r.status !== 'ok') throw new Error('drill failed')
    expect(r.counts?.migrations).toBeGreaterThan(0)
    expect(r.database).toMatch(/^spa_restore_drill_\d+$/)
    expect(await dbExists(r.database!)).toBe(false)
    expect(await dbExists(liveDb)).toBe(true)
    const [live] = await owner.select().from(tenants)
    expect(live?.slug).toBe('drill')
    expect(await lastDrill()).toMatchObject({
      status: 'ok',
      details: { key: 'backups/daily/test.dump', role: 'spa_drill' },
    })
  })

  it('records a failed drill (unreadable dump), drops its scratch database and throws so the job reports', async () => {
    await expect(
      restoreDrill(env, {
        download: async (dest) => {
          await writeFile(dest, 'not a dump')
          return 'backups/daily/bad.dump'
        },
      }),
    ).rejects.toThrow('restore drill failed')
    const [row] = await owner
      .select()
      .from(platformJobRuns)
      .where(and(eq(platformJobRuns.job, 'restore-drill'), eq(platformJobRuns.status, 'failed')))
      .orderBy(desc(platformJobRuns.finishedAt))
      .limit(1)
    expect(row?.details).toMatchObject({ key: 'backups/daily/bad.dump', role: 'spa_drill' })
    expect(await dbExists(String(row?.details.database))).toBe(false)
  })
})
