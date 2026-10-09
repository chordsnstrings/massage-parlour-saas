import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { type DrillRole, drillRoleProblem } from '@spa/core'
import { log } from '../log'
import { type OffsiteConfig, offsiteClient, offsiteConfig, recordPlatformRun } from './backup'

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
      /** The role the drill ran as and its scratch database (dropped afterwards). */
      role?: string
      database?: string
      key?: string
      bytes?: number
      counts?: Record<string, number>
      /** Superuser-only extensions left out of the restore (e.g. pg_stat_statements). */
      skipped?: string[]
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

/** Same off-site bucket as db-backup. Downloads the latest daily dump to `dest`; returns its key. */
async function downloadLatest(cfg: OffsiteConfig, dest: string) {
  const r2 = offsiteClient(cfg)
  const base = `${cfg.endpoint}/${cfg.bucket}`
  const list = await r2.fetch(`${base}?list-type=2&prefix=backups/daily/`)
  if (!list.ok) throw new Error(`R2 list failed: ${list.status}`)
  const key = latestBackupKey(await list.text())
  if (!key) throw new Error('no backup found in R2 (backups/daily/)')
  const res = await r2.fetch(`${base}/${key}`)
  if (!res.ok) throw new Error(`R2 download ${key} failed: ${res.status}`)
  await writeFile(dest, Buffer.from(await res.arrayBuffer()))
  return key
}

/** Default spa_drill password: sha256 hex of `spa_drill:<owner password>` (same formula as packages/db/sql/bootstrap.sql). */
export const derivedDrillPassword = (ownerPassword: string) =>
  createHash('sha256').update(`spa_drill:${ownerPassword}`).digest('hex')

/**
 * F11: the restore drill connects as the least-privilege `spa_drill` role (CREATEDB only) to the `postgres`
 * maintenance database — never the superuser. DATABASE_URL_DRILL wins; otherwise built from DATABASE_URL_OWNER's
 * host with SPA_DRILL_PASSWORD or the derived password (compose passes no drill URL, so existing droplets need nothing).
 */
export function drillUrl(env: Env): string | null {
  if (env.DATABASE_URL_DRILL) return env.DATABASE_URL_DRILL
  if (!env.DATABASE_URL_OWNER) return null
  const u = new URL(env.DATABASE_URL_OWNER)
  const password = env.SPA_DRILL_PASSWORD || derivedDrillPassword(decodeURIComponent(u.password))
  u.username = 'spa_drill'
  u.password = encodeURIComponent(password)
  u.pathname = '/postgres'
  return u.toString()
}

/** TOC entries (from `pg_restore -l`) minus the given extensions and their comments. */
export function restoreList(toc: string, drop: string[]) {
  const skipped = new Set<string>()
  const lines = toc.split('\n').filter((line) => {
    const m = /^\d+; \d+ \d+ (?:EXTENSION - |COMMENT - EXTENSION )(\S+)/.exec(line)
    if (m && drop.includes(m[1]!)) {
      skipped.add(m[1]!)
      return false
    }
    return true
  })
  return { list: lines.join('\n'), skipped: [...skipped].sort() }
}

const withDb = (url: string, db: string) => {
  const u = new URL(url)
  u.pathname = `/${db}`
  return u.toString()
}
/** libpq args with the password moved to PGPASSWORD, so command lines (and failure messages) never carry it. */
const conn = (url: string) => {
  const u = new URL(url)
  const password = decodeURIComponent(u.password)
  u.password = ''
  return { arg: `--dbname=${u}`, env: password ? { ...process.env, PGPASSWORD: password } : process.env }
}
const psql = (url: string, sql: string) => {
  const c = conn(url)
  return run('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', c.arg, '-c', sql], {
    maxBuffer: 1 << 20,
    env: c.env,
  })
}
/** Error text for logs + the console, with any `user:password@` credentials masked. */
const errorText = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).replace(/\/\/([^:/@\s]+):[^@\s]*@/g, '//$1:***@').slice(0, 500)

const record = (env: Env, startedAt: Date, { status, ...details }: DrillResult) =>
  recordPlatformRun(env, 'restore-drill', startedAt, status, details)

/** Attributes of the role a URL logs in as (pg_roles is readable by every role). */
async function roleOf(url: string): Promise<{ name: string; attrs: DrillRole }> {
  const { stdout } = await psql(
    url,
    'select current_user, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls, rolreplication from pg_roles where rolname = current_user',
  )
  const [name = '', ...flags] = stdout.trim().split('|')
  const [rolsuper, rolcreatedb, rolcreaterole, rolbypassrls, rolreplication] = flags.map((f) => f === 't')
  return {
    name,
    attrs: {
      rolsuper: rolsuper!,
      rolcreatedb: rolcreatedb!,
      rolcreaterole: rolcreaterole!,
      rolbypassrls: rolbypassrls!,
      rolreplication: rolreplication!,
    },
  }
}

/**
 * Monthly restore drill (PLAN §3.5): latest pg_dump from R2 → scratch database → sanity counts → drop.
 * F11: runs as the least-privilege `spa_drill` role (drillUrl): it creates the scratch database (so owns it),
 * restores into it and drops it — it has no access to the live database and can drop no other. Refuses a superuser
 * (or CREATEROLE / BYPASSRLS / REPLICATION) role. The outcome lands in platform_job_runs (super-admin console).
 * Skips cleanly without R2.
 */
export async function restoreDrill(
  env: Env = process.env,
  deps: { download?: (dest: string) => Promise<string> } = {},
): Promise<DrillResult> {
  const startedAt = new Date()
  const cfg = offsiteConfig(env)
  if (!deps.download && !cfg) {
    log('warn', 'restore drill skipped: R2 not configured')
    const r = { status: 'skipped' as const, reason: 'r2_not_configured' }
    await record(env, startedAt, r)
    return r
  }
  if (env.RESTORE_DRILL_ADMIN_URL)
    log(
      'warn',
      'RESTORE_DRILL_ADMIN_URL is ignored (F11): the drill uses the spa_drill role; remove the variable',
    )
  const admin = drillUrl(env)
  if (!admin) throw new Error('DATABASE_URL_DRILL / DATABASE_URL_OWNER is not set')
  // Defence in depth: never run as a superuser (or any role beyond CREATEDB), whatever the URL says.
  const role = await roleOf(admin).then(
    (r) => ({ ...r, problem: drillRoleProblem(r.attrs) }),
    (e) => ({ name: undefined, problem: `cannot connect (${errorText(e)})` }),
  )
  if (role.problem) {
    const r: DrillResult = {
      status: 'failed',
      role: role.name,
      ms: Date.now() - startedAt.getTime(),
      error: `refusing to run as role ${role.name ?? '?'}: ${role.problem} (needs CREATEDB only: spa_drill, F11)`,
    }
    log('error', 'restore drill refused', r)
    await record(env, startedAt, r)
    throw new Error(`restore drill failed: ${r.error}`)
  }
  const file = join(tmpdir(), `spa-drill-${Date.now()}.dump`)
  const scratch = `spa_restore_drill_${Date.now()}`
  const scratchUrl = withDb(admin, scratch)
  const base = { role: role.name, database: scratch }
  let key: string | undefined
  let bytes: number | undefined
  let skipped: string[] | undefined
  let created = false
  let result: DrillResult
  try {
    key = await (deps.download ?? ((d) => downloadLatest(cfg!, d)))(file)
    bytes = (await stat(file)).size
    // Superuser-only extensions (pg_stat_statements) can't be created by spa_drill and hold no data: left out.
    const { stdout: untrusted } = await psql(
      admin,
      'select distinct name from pg_available_extension_versions where superuser and not trusted',
    )
    const { stdout: toc } = await run('pg_restore', ['--list', file], { maxBuffer: 1 << 24 })
    const plan = restoreList(toc, untrusted.split('\n').filter(Boolean))
    skipped = plan.skipped
    await writeFile(`${file}.list`, plan.list)
    created = true // before CREATE: the drop below is by this run's own unique name only
    await psql(admin, `CREATE DATABASE "${scratch}"`)
    const target = conn(scratchUrl)
    await run(
      'pg_restore',
      ['--no-owner', '--no-acl', '--exit-on-error', `--use-list=${file}.list`, target.arg, file],
      { maxBuffer: 1 << 22, env: target.env },
    )
    const counts: Record<string, number> = {}
    for (const t of DRILL_TABLES) {
      const { stdout } = await psql(scratchUrl, `select count(*) from public."${t}"`)
      counts[t] = Number(stdout.trim())
    }
    const { stdout: mig } = await psql(scratchUrl, 'select count(*) from drizzle.__drizzle_migrations')
    counts.migrations = Number(mig.trim())
    if (!counts.migrations) throw new Error('restored copy has no migrations recorded')
    result = { status: 'ok', ...base, key, bytes, counts, skipped, ms: Date.now() - startedAt.getTime() }
    log('info', 'restore drill ok', result)
  } catch (e) {
    const error = errorText(e)
    result = { status: 'failed', ...base, key, bytes, skipped, ms: Date.now() - startedAt.getTime(), error }
    log('error', 'restore drill failed', result)
  } finally {
    // Only the scratch database this run created (spa_drill can drop no database it doesn't own anyway).
    if (created)
      await psql(admin, `DROP DATABASE IF EXISTS "${scratch}" WITH (FORCE)`).catch((e) =>
        log('error', 'restore drill: drop scratch database failed', { scratch, error: errorText(e) }),
      )
    await rm(file, { force: true })
    await rm(`${file}.list`, { force: true })
  }
  await record(env, startedAt, result)
  if (result.status === 'failed') throw new Error(`restore drill failed: ${result.error}`)
  return result
}
