import { readFile, statfs, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { configFlags, sendStaffEmail } from '@spa/core'
import { createDb, type Db, listedAdminEmails, platformJobRuns } from '@spa/db'
import { and, desc, eq, lt, sql } from 'drizzle-orm'
import { log } from '../log'

type Env = Record<string, string | undefined>

/** G8 thresholds (console overview uses the same numbers). */
export const DISK_ALERT_PCT = 85
export const HEARTBEAT_STALE_MS = 10 * 60_000
export const BACKUP_STALE_MS = 36 * 3_600_000
/** Touched on every beat; the compose healthcheck checks its age. */
export const HEARTBEAT_FILE = '/tmp/worker-heartbeat'

/** Root filesystem use like `df` (the container's overlay lives on the droplet's disk). */
export async function diskUsage(path = '/') {
  const s = await statfs(path)
  const used = s.blocks - s.bfree
  const pct = Math.round((used / (used + s.bavail)) * 1000) / 10
  return { usedPct: pct, freeGb: Math.round(((s.bavail * s.bsize) / 1e9) * 10) / 10 }
}

/** Deploy state written by the droplet updater (/opt/spa/status mounted read-only, OPS_STATUS_DIR). */
async function deployState(env: Env): Promise<{ state: string; commit?: string; message?: string } | null> {
  if (!env.OPS_STATUS_DIR) return null
  try {
    const j = JSON.parse(await readFile(join(env.OPS_STATUS_DIR, 'deploy.json'), 'utf8'))
    return { state: String(j.state ?? ''), commit: j.commit, message: j.message }
  } catch {
    return null
  }
}

export type Alert = { key: string; red: boolean; message: string }

/** Incidents to open (email once) and close, given what is red now and which incidents are open. */
export function alertChanges(current: Alert[], open: Set<string>) {
  return {
    opened: current.filter((a) => a.red && !open.has(a.key)),
    closed: current.filter((a) => !a.red && open.has(a.key)),
  }
}

/** PLATFORM_ADMIN_EMAILS, de-duplicated (compose appends extra admins to the base value). */
const recipients = (env: Env) =>
  listedAdminEmails(env.PLATFORM_ADMIN_EMAILS ?? '').filter((s) => s.includes('@'))

async function openIncidents(db: Db) {
  const rows = await db.execute<{ key: string; open: boolean }>(sql`
    select distinct on (details->>'key') details->>'key' as key, status = 'failed' as open
    from platform_job_runs where job = 'ops-alert'
    order by details->>'key', finished_at desc`)
  return new Set(rows.rows.filter((r) => r.open).map((r) => r.key))
}

async function lastRun(db: Db, job: string, status?: 'ok') {
  const [r] = await db
    .select({ status: platformJobRuns.status, finishedAt: platformJobRuns.finishedAt })
    .from(platformJobRuns)
    .where(
      status
        ? and(eq(platformJobRuns.job, job), eq(platformJobRuns.status, status))
        : eq(platformJobRuns.job, job),
    )
    .orderBy(desc(platformJobRuns.finishedAt))
    .limit(1)
  return r
}

/**
 * G8: every 5 minutes the worker records a `worker-heartbeat` row (disk use, deploy state, which settings the worker
 * sees — presence flags only), keeps a day of them, and emails PLATFORM_ADMIN_EMAILS once per incident when the disk,
 * the off-site backup or the last deploy goes red (rows `ops-alert`, open = failed, closed = ok).
 */
export async function heartbeat(env: Env = process.env, now = new Date()) {
  if (!env.DATABASE_URL_PLATFORM) return { skipped: 'DATABASE_URL_PLATFORM not set' }
  const db = createDb(env.DATABASE_URL_PLATFORM)
  const disk = await diskUsage().catch(() => null)
  const deploy = await deployState(env)
  await db.insert(platformJobRuns).values({
    job: 'worker-heartbeat',
    status: disk && disk.usedPct > DISK_ALERT_PCT ? 'failed' : 'ok',
    details: { disk, deploy, config: configFlags(env), release: env.APP_RELEASE ?? null },
    startedAt: now,
  })
  await db
    .delete(platformJobRuns)
    .where(
      and(
        eq(platformJobRuns.job, 'worker-heartbeat'),
        lt(platformJobRuns.finishedAt, new Date(now.getTime() - 86_400_000)),
      ),
    )
  await writeFile(HEARTBEAT_FILE, now.toISOString()).catch(() => {})

  const anyBackup = await lastRun(db, 'db-backup')
  const okBackup = await lastRun(db, 'db-backup', 'ok')
  const alerts: Alert[] = [
    {
      key: 'disk',
      red: Boolean(disk && disk.usedPct > DISK_ALERT_PCT),
      message: `Disk ${disk?.usedPct}% full (${disk?.freeGb} GB free)`,
    },
    {
      // Only once the nightly job has run at all (a fresh install has no backup yet).
      key: 'backup',
      red:
        Boolean(anyBackup) && (!okBackup || now.getTime() - okBackup.finishedAt.getTime() > BACKUP_STALE_MS),
      message: 'No successful off-site database backup in the last 36 hours',
    },
    {
      key: 'deploy',
      red: deploy?.state === 'failed',
      message: `Deploy failed: ${deploy?.message ?? ''}`,
    },
  ]
  const { opened, closed } = alertChanges(alerts, await openIncidents(db))
  let emailed = false
  const to = recipients(env)
  if (opened.length && to.length) {
    try {
      for (const addr of to)
        await sendStaffEmail({
          to: addr,
          subject: `[spamanagement] ${opened.map((a) => a.key).join(', ')} needs attention`,
          text: `${opened.map((a) => `- ${a.message}`).join('\n')}\n\nDetails: super-admin console → Overview. You get one email per incident.`,
        })
      emailed = true
    } catch (e) {
      log('error', 'ops alert email failed', { error: String(e) })
    }
  }
  for (const a of opened) log('error', 'ops alert', { key: a.key, message: a.message })
  const rows = [
    ...opened.map((a) => ({ a, status: 'failed' as const })),
    ...closed.map((a) => ({ a, status: 'ok' as const })),
  ]
  if (rows.length)
    await db.insert(platformJobRuns).values(
      rows.map(({ a, status }) => ({
        job: 'ops-alert',
        status,
        details: { key: a.key, message: a.message, emailed: status === 'failed' ? emailed : undefined },
        startedAt: now,
      })),
    )
  return { disk, opened: opened.map((a) => a.key), closed: closed.map((a) => a.key) }
}
