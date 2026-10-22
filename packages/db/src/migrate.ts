import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { sql } from 'drizzle-orm'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { createDb, type Db } from './client'

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

export type JournalMigration = { tag: string; when: number; hash: string }
export type AppliedMigration = { hash: string; created_at: string | number | null }

/**
 * Journal migrations Drizzle would silently skip. Drizzle 0.45 applies only migrations whose `when` is newer than
 * the newest applied row, so a migration from a parallel branch that merged with an older `when` (or was renumbered
 * without regenerating) never runs, and the app then queries columns that don't exist.
 */
export function skippedMigrations(journal: JournalMigration[], applied: AppliedMigration[]): string[] {
  if (!applied.length) return []
  const times = new Set(applied.map((r) => Number(r.created_at)))
  const hashes = new Set(applied.map((r) => r.hash))
  const newest = Math.max(...times)
  return journal
    .filter((m) => m.when <= newest && !times.has(m.when) && !hashes.has(m.hash))
    .map((m) => m.tag)
}

/** The folder's journal: tag, `when` and the SQL hash Drizzle records, in journal order. */
export function readJournal(migrationsFolder: string): JournalMigration[] {
  const { entries } = JSON.parse(readFileSync(`${migrationsFolder}/meta/_journal.json`, 'utf8')) as {
    entries: Array<{ tag: string; when: number }>
  }
  const files = readMigrationFiles({ migrationsFolder })
  return entries.map((e, i) => ({ tag: e.tag, when: e.when, hash: files[i]!.hash }))
}

/** Stops (before any change) when a migration would be skipped; regenerate it so it sorts after the applied ones. */
export async function assertNoSkippedMigrations(db: Db, migrationsFolder: string, schema = 'drizzle') {
  const table = `${schema}.__drizzle_migrations`
  const { rows: exists } = await db.execute<{ t: string | null }>(
    sql`select to_regclass(${table})::text as t`,
  )
  if (!exists[0]?.t) return
  const { rows } = await db.execute<AppliedMigration>(
    sql`select hash, created_at from ${sql.identifier(schema)}.${sql.identifier('__drizzle_migrations')}`,
  )
  const skipped = skippedMigrations(readJournal(migrationsFolder), rows)
  if (skipped.length)
    throw new Error(
      `Migrations ${skipped.join(', ')} are older than the newest applied migration and would be skipped. ` +
        'Delete them (SQL, snapshot, journal entry) and run `pnpm db:generate` so they sort last.',
    )
}

/** Applies pending migrations as the schema owner (refusing ones Drizzle would silently skip). */
export async function runMigrations(ownerUrl: string, migrationsFolder = defaultFolder()) {
  const db = createDb(migrationUrl(ownerUrl), 1)
  await assertNoSkippedMigrations(db, migrationsFolder)
  await migrate(db, { migrationsFolder })
}
