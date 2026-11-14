import { afterEach, describe, expect, it } from 'vitest'
import { closeAllDbs, createDb, POOL_IDLE_MS, poolConfig } from '../src/client'

const URL_ = 'postgres://spa_app:x@db:5432/spa?sslmode=require'

describe('pool config (BE RELAX v2.3: no reconnect after a quiet minute)', () => {
  afterEach(() => {
    delete process.env.DATABASE_CA_CERT
  })

  it('keeps idle connections 10 minutes with TCP keep-alive, same max', () => {
    expect(POOL_IDLE_MS).toBe(600_000)
    expect(poolConfig(URL_, 10)).toEqual({
      connectionString: URL_,
      max: 10,
      idleTimeoutMillis: 600_000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 60_000,
    })
  })

  it('managed Postgres: the same idle settings next to the CA (sslmode dropped)', () => {
    process.env.DATABASE_CA_CERT = '-----BEGIN CERTIFICATE-----\\nX\\n-----END CERTIFICATE-----'
    const c = poolConfig(URL_, 4)
    expect(c).toMatchObject({
      max: 4,
      idleTimeoutMillis: 600_000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 60_000,
    })
    expect(c.connectionString).toBe('postgres://spa_app:x@db:5432/spa')
    expect(c.ssl).toEqual({
      ca: '-----BEGIN CERTIFICATE-----\nX\n-----END CERTIFICATE-----',
      rejectUnauthorized: true,
    })
  })

  it('an idle client error is logged, never an unhandled pool error (worker crash)', async () => {
    const db = createDb('postgres://spa_app:x@127.0.0.1:1/never_connected', 1)
    const pool = (db as unknown as { $client: import('pg').Pool }).$client
    expect(pool.listenerCount('error')).toBe(1)
    await closeAllDbs()
  })
})
