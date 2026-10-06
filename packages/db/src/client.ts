import { sql } from 'drizzle-orm'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import * as schema from './schema'

export type Db = NodePgDatabase<typeof schema>
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
export type DbOrTx = Db | Tx

const g = globalThis as unknown as { __spaDb?: Map<string, { db: Db; pool: pg.Pool }> }
if (!g.__spaDb) g.__spaDb = new Map()
const cache = g.__spaDb

/** One pooled client per connection string (survives dev hot reloads). */
export function createDb(url: string, max = 10): Db {
  let entry = cache.get(url)
  if (!entry) {
    const pool = new pg.Pool({ connectionString: url, max })
    entry = { db: drizzle(pool, { schema }), pool }
    cache.set(url, entry)
  }
  return entry.db
}

export async function closeAllDbs() {
  await Promise.all([...cache.values()].map((e) => e.pool.end()))
  cache.clear()
}

function requireEnv(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

/** Platform role: auth, super-admin, host lookup, signup. Sees all rows — use only in platform code paths. */
export const platformDb = () => createDb(requireEnv('DATABASE_URL_PLATFORM'))
/** App role: tenant data. Every query must run inside `withTenant()`; without it RLS returns nothing. */
export const appDb = () => createDb(requireEnv('DATABASE_URL_APP'))

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Runs `fn` in a transaction scoped to one tenant (transaction-local `app.tenant_id`, enforced by RLS). */
export async function withTenant<T>(
  tenantId: string,
  fn: (tx: Tx) => Promise<T>,
  db: Db = appDb(),
): Promise<T> {
  if (!UUID.test(tenantId)) throw new Error('withTenant: invalid tenant id')
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`)
    return fn(tx)
  })
}
