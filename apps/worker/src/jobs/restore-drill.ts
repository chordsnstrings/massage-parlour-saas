import { execFile } from 'node:child_process'
import { rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { createDb, platformJobRuns } from '@spa/db'
import { AwsClient } from 'aws4fetch'
import { log } from '../log'

const run = promisify(execFile)
type Env = Record<string, string | undefined>

/** Tables the drill counts in the restored copy; a missing one fails the drill. */
export const DRILL_TABLES = [
  'tenants',
  'user',
  'branches',
  'clients',
  'bookings',
  'journal_entries',
  'audit_log',
]

export type DrillResult =
  | { status: 'skipped'; reason: string }
  | {
      status: 'ok' | 'failed'
      key?: string
      bytes?: number
      counts?: Record<string, number>
      ms: number
      error?: string
    }

/** Latest `backups/daily/*.dump` key from an S3 ListObjectsV2 response (keys are dated, so the max sorts last). */
export function latestBackupKey(listXml: string): string | null {
  const keys = [...listXml.matchAll(/<Key>([^<]+)<\/Key>/g)]
    .map((m) => m[1]!)
    .filter((k) => k.endsWith('.dump'))
  return keys.sort().at(-1) ?? null
}

/** Same R2 config as db-backup. Downloads the latest daily dump to `dest`; returns its key. */
async function downloadLatestFromR2(env: Env, dest: string) {
  const r2 = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID!,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    service: 's3',
    region: 'auto',
  })
  const base = `${env.R2_ENDPOINT!.replace(/\/$/, '')}/${env.R2_BUCKET}`
  const list = await r2.fetch(`${base}?list-type=2&prefix=backups/daily/`)
  if (!list.ok) throw new Error(`R2 list failed: ${list.status}`)
  const key = latestBackupKey(await list.text())
  if (!key) throw new Error('no backup found in R2 (backups/daily/)')
  const res = await r2.fetch(`${base}/${key}`)
  if (!res.ok) throw new Error(`R2 download ${key} failed: ${res.status}`)
  await writeFile(dest, Buffer.from(await res.arrayBuffer()))
  return key
}

const withDb = (url: string, db: string) => {
  const u = new URL(url)
  u.pathname = `/${db}`
  return u.toString()
}
const psql = (url: string, sql: string) =>
  run('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', `--dbname=${url}`, '-c', sql], {
    maxBuffer: 1 << 20,
  })

async function record(env: Env, startedAt: Date, r: DrillResult) {
  if (!env.DATABASE_URL_PLATFORM) return
  try {
    const { status, ...details } = r
    await createDb(env.DATABASE_URL_PLATFORM)
      .insert(platformJobRuns)
      .values({ job: 'restore-drill', status, details, startedAt })
  } catch (e) {
    log('error', 'restore drill: could not record result', { error: String(e) })
  }
}

/**
 * Monthly restore drill (PLAN §3.5): latest pg_dump from R2 → scratch database → sanity counts → drop.
 * The scratch database is created through RESTORE_DRILL_ADMIN_URL (a role with CREATEDB; defaults to
 * DATABASE_URL_OWNER). The outcome lands in platform_job_runs (super-admin console). Skips cleanly without R2.
 */
export async function restoreDrill(
  env: Env = process.env,
  deps: { download?: (dest: string) => Promise<string> } = {},
): Promise<DrillResult> {
  const startedAt = new Date()
  const { R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = env
  if (!deps.download && (!R2_ENDPOINT || !R2_BUCKET || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY)) {
    log('warn', 'restore drill skipped: R2 not configured')
    const r = { status: 'skipped' as const, reason: 'r2_not_configured' }
    await record(env, startedAt, r)
    return r
  }
  const admin = env.RESTORE_DRILL_ADMIN_URL || env.DATABASE_URL_OWNER
  if (!admin) throw new Error('RESTORE_DRILL_ADMIN_URL / DATABASE_URL_OWNER is not set')
  const file = join(tmpdir(), `spa-drill-${Date.now()}.dump`)
  const scratch = `spa_restore_drill_${Date.now()}`
  const scratchUrl = withDb(admin, scratch)
  let key: string | undefined
  let bytes: number | undefined
  let result: DrillResult
  try {
    key = await (deps.download ?? ((d) => downloadLatestFromR2(env, d)))(file)
    bytes = (await stat(file)).size
    await psql(admin, `CREATE DATABASE "${scratch}"`)
    await run('pg_restore', ['--no-owner', '--no-acl', '--exit-on-error', `--dbname=${scratchUrl}`, file], {
      maxBuffer: 1 << 22,
    })
    const counts: Record<string, number> = {}
    for (const t of DRILL_TABLES) {
      const { stdout } = await psql(scratchUrl, `select count(*) from public."${t}"`)
      counts[t] = Number(stdout.trim())
    }
    const { stdout: mig } = await psql(scratchUrl, 'select count(*) from drizzle.__drizzle_migrations')
    counts.migrations = Number(mig.trim())
    if (!counts.migrations) throw new Error('restored copy has no migrations recorded')
    result = { status: 'ok', key, bytes, counts, ms: Date.now() - startedAt.getTime() }
    log('info', 'restore drill ok', result)
  } catch (e) {
    const error = (e instanceof Error ? e.message : String(e)).slice(0, 500)
    result = { status: 'failed', key, bytes, ms: Date.now() - startedAt.getTime(), error }
    log('error', 'restore drill failed', result)
  } finally {
    await psql(admin, `DROP DATABASE IF EXISTS "${scratch}" WITH (FORCE)`).catch((e) =>
      log('error', 'restore drill: drop scratch database failed', { scratch, error: String(e) }),
    )
    await rm(file, { force: true })
  }
  await record(env, startedAt, result)
  if (result.status === 'failed') throw new Error(`restore drill failed: ${result.error}`)
  return result
}
