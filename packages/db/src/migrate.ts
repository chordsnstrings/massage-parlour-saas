import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { createDb } from './client'

const defaultFolder = () =>
  process.env.MIGRATIONS_DIR ?? fileURLToPath(new URL('../drizzle', import.meta.url))

/** Applies pending migrations as the schema owner. */
export async function runMigrations(ownerUrl: string, migrationsFolder = defaultFolder()) {
  await migrate(createDb(ownerUrl, 1), { migrationsFolder })
}
