import { execFile } from 'node:child_process'
import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { AwsClient } from 'aws4fetch'
import { log } from '../log'

const run = promisify(execFile)

/** Object keys for a backup taken on `date` (YYYY-MM-DD, Asia/Dubai). Monthly copy on the 1st. */
export function backupKeys(date: string) {
  const keys = [`backups/daily/${date}.dump`]
  if (date.endsWith('-01')) keys.push(`backups/monthly/${date.slice(0, 7)}.dump`)
  return keys
}

export const dubaiDate = (now = new Date()) => now.toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' })

/**
 * Nightly `pg_dump -Fc` uploaded to Cloudflare R2 (S3 API). Retention is an R2 lifecycle rule
 * (daily/ 30 days, monthly/ 365 days) — see deploy/README.md.
 */
export async function backupDatabase(env = process.env) {
  const { R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, DATABASE_URL_OWNER } = env
  if (!R2_ENDPOINT || !R2_BUCKET || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    log('warn', 'backup skipped: R2 not configured')
    return { skipped: true as const }
  }
  if (!DATABASE_URL_OWNER) throw new Error('DATABASE_URL_OWNER is not set')
  const file = join(tmpdir(), `spa-${Date.now()}.dump`)
  try {
    await run(
      'pg_dump',
      ['--format=custom', '--no-owner', `--dbname=${DATABASE_URL_OWNER}`, `--file=${file}`],
      { maxBuffer: 1 << 20 },
    )
    const body = await readFile(file)
    const r2 = new AwsClient({
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
      service: 's3',
      region: 'auto',
    })
    const keys = backupKeys(dubaiDate())
    for (const key of keys) {
      const res = await r2.fetch(`${R2_ENDPOINT.replace(/\/$/, '')}/${R2_BUCKET}/${key}`, {
        method: 'PUT',
        body,
      })
      if (!res.ok) throw new Error(`R2 upload ${key} failed: ${res.status} ${await res.text()}`)
    }
    log('info', 'backup uploaded', { keys, bytes: body.byteLength })
    return { skipped: false as const, keys, bytes: body.byteLength }
  } finally {
    await rm(file, { force: true })
  }
}
