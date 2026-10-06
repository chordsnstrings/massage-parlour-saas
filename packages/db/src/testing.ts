import { sql } from 'drizzle-orm'
import { createDb } from './client'
import { runMigrations } from './migrate'

const local = (role: string) => `postgres://${role}:${role}_dev@localhost:5432/spa_test`

export const testUrls = {
  owner: process.env.TEST_DATABASE_URL_OWNER ?? local('spa_owner'),
  platform: process.env.TEST_DATABASE_URL_PLATFORM ?? local('spa_platform'),
  app: process.env.TEST_DATABASE_URL_APP ?? local('spa_app'),
}

export const testDbs = () => ({
  owner: createDb(testUrls.owner, 2),
  platform: createDb(testUrls.platform, 4),
  app: createDb(testUrls.app, 4),
})

/** Migrates the test database and truncates every public table. */
export async function resetTestDatabase() {
  await runMigrations(testUrls.owner)
  const owner = createDb(testUrls.owner, 2)
  const { rows } = await owner.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  )
  if (rows.length) {
    const list = rows.map((r) => `"${r.tablename}"`).join(', ')
    await owner.execute(sql.raw(`truncate ${list} restart identity cascade`))
  }
}
