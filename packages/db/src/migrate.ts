import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { createDb } from './client'

const defaultFolder = () =>
  process.env.MIGRATIONS_DIR ?? fileURLToPath(new URL('../drizzle', import.meta.url))

/**
 * G7: migrations run while the previous release still serves traffic, so a migration waiting on a busy table's lock
 * gives up (lock_timeout, default 10s) instead of queueing every request behind it, and a runaway statement stops
 * (statement_timeout, default 15min). The deploy then fails and rolls back; re-run when traffic is quiet.
 */
export function migrationUrl(url: string, env: Record<string, string | undefined> = process.env) {
  const u = new URL(url)
  const lock = env.MIGRATE_LOCK_TIMEOUT ?? '10s'
  const stmt = env.MIGRATE_STATEMENT_TIMEOUT ?? '15min'
  const opts = [u.searchParams.get('options'), `-c lock_timeout=${lock}`, `-c statement_timeout=${stmt}`]
  u.searchParams.set('options', opts.filter(Boolean).join(' '))
  return u.toString()
}

/** Applies pending migrations as the schema owner. */
export async function runMigrations(ownerUrl: string, migrationsFolder = defaultFolder()) {
  await migrate(createDb(migrationUrl(ownerUrl), 1), { migrationsFolder })
}
