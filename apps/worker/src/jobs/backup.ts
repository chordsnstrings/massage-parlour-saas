import { execFile } from 'node:child_process'
import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { createDb, platformJobRuns } from '@spa/db'
import { AwsClient } from 'aws4fetch'
import { log } from '../log'

const run = promisify(execFile)
type Env = Record<string, string | undefined>

export type OffsiteConfig = {
  endpoint: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  source: 'R2' | 'S3'
}

/**
 * Off-site backup bucket (G1): the `R2_*` vars, or — when none of them is set — the file-storage `S3_*`
 * bucket (objects under `backups/`). A separate private bucket with its own key is recommended.
 */
export function offsiteConfig(env: Env = process.env): OffsiteConfig | null {
  const pick = (p: 'R2' | 'S3') => {
    const endpoint = env[`${p}_ENDPOINT`]
    const bucket = env[`${p}_BUCKET`]
    const accessKeyId = env[`${p}_ACCESS_KEY_ID`]
    const secretAccessKey = env[`${p}_SECRET_ACCESS_KEY`]
    return endpoint && bucket && accessKeyId && secretAccessKey
      ? { endpoint: endpoint.replace(/\/$/, ''), bucket, accessKeyId, secretAccessKey, source: p }
      : null
  }
  const anyR2 = ['R2_ENDPOINT', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'].some((k) => env[k])
  return anyR2 ? pick('R2') : pick('S3')
}

export const offsiteClient = (c: OffsiteConfig) =>
  new AwsClient({
    accessKeyId: c.accessKeyId,
    secretAccessKey: c.secretAccessKey,
    service: 's3',
    region: 'auto',
  })

/** One row in platform_job_runs (super-admin console). Never throws: the log must not break a job. */
export async function recordPlatformRun(
  env: Env,
  job: string,
  startedAt: Date,
  status: 'ok' | 'failed' | 'skipped',
  details: Record<string, unknown>,
) {
  if (!env.DATABASE_URL_PLATFORM) return
  try {
    await createDb(env.DATABASE_URL_PLATFORM)
      .insert(platformJobRuns)
      .values({ job, status, details, startedAt })
  } catch (e) {
    log('error', 'platform job run log failed', { job, error: String(e) })
  }
}

/** Object keys for a backup taken on `date` (YYYY-MM-DD, Asia/Dubai). Monthly copy on the 1st. */
export function backupKeys(date: string) {
  const keys = [`backups/daily/${date}.dump`]
  if (date.endsWith('-01')) keys.push(`backups/monthly/${date.slice(0, 7)}.dump`)
  return keys
}

export const dubaiDate = (now = new Date()) => now.toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' })

/**
 * Nightly `pg_dump -Fc` uploaded to the off-site bucket (S3 API). Retention is a bucket lifecycle rule
 * (daily/ 30 days, monthly/ 365 days) — see deploy/droplet/README.md. Every outcome (ok / skipped / failed)
 * lands in platform_job_runs as `db-backup`; the console warns when the last ok run is > 36 h old.
 */
export async function backupDatabase(env: Env = process.env) {
  const startedAt = new Date()
  const cfg = offsiteConfig(env)
  if (!cfg) {
    const reason = 'offsite_not_configured'
    log('warn', 'backup skipped: off-site bucket not configured (R2_* or S3_*)')
    await recordPlatformRun(env, 'db-backup', startedAt, 'skipped', { reason })
    return { skipped: true as const, reason }
  }
  const file = join(tmpdir(), `spa-${Date.now()}.dump`)
  try {
    const { DATABASE_URL_OWNER } = env
    if (!DATABASE_URL_OWNER) throw new Error('DATABASE_URL_OWNER is not set')
    await run(
      'pg_dump',
      ['--format=custom', '--no-owner', `--dbname=${DATABASE_URL_OWNER}`, `--file=${file}`],
      { maxBuffer: 1 << 20 },
    )
    const body = await readFile(file)
    const client = offsiteClient(cfg)
    const keys = backupKeys(dubaiDate())
    for (const key of keys) {
      const res = await client.fetch(`${cfg.endpoint}/${cfg.bucket}/${key}`, { method: 'PUT', body })
      if (!res.ok) throw new Error(`upload ${key} failed: ${res.status} ${await res.text()}`)
    }
    log('info', 'backup uploaded', { keys, bytes: body.byteLength, source: cfg.source })
    await recordPlatformRun(env, 'db-backup', startedAt, 'ok', {
      keys,
      bytes: body.byteLength,
      source: cfg.source,
    })
    return { skipped: false as const, keys, bytes: body.byteLength }
  } catch (e) {
    const error = (e instanceof Error ? e.message : String(e)).slice(0, 500)
    log('error', 'backup failed', { error })
    await recordPlatformRun(env, 'db-backup', startedAt, 'failed', { error, source: cfg.source })
    throw e
  } finally {
    await rm(file, { force: true })
  }
}
