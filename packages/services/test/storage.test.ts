import { closeAllDbs, tenants, withTenant } from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { decryptSecret, deleteFile, encryptSecret, getFile, putFile } from '../src'

const { platform, app } = testDbs()
const ids = {} as Record<string, string>

beforeAll(async () => {
  await resetTestDatabase()
  const [a] = await platform.insert(tenants).values({ slug: 'files-a', name: 'A' }).returning()
  const [b] = await platform.insert(tenants).values({ slug: 'files-b', name: 'B' }).returning()
  ids.a = a!.id
  ids.b = b!.id
})
afterAll(closeAllDbs)

describe('secrets', () => {
  it('round-trips and authenticates ciphertext', () => {
    process.env.BETTER_AUTH_SECRET ??= 'test-secret-test-secret-test-secret'
    const sealed = encryptSecret('EAAB-token')
    expect(sealed.startsWith('v1.')).toBe(true)
    expect(sealed).not.toContain('EAAB')
    expect(decryptSecret(sealed)).toBe('EAAB-token')
    const [v, iv, tag, data] = sealed.split('.')
    const tampered = [v, iv, tag, `${data!.slice(0, -2)}AA`].join('.')
    expect(() => decryptSecret(tampered)).toThrow()
  })
})

describe('storage (database backend)', () => {
  it('stores bytes per tenant, isolated by RLS', async () => {
    const bytes = Buffer.from('hello receipt')
    const f = await withTenant(
      ids.a!,
      (tx) => putFile(tx, { tenantId: ids.a!, bytes, contentType: 'text/plain', purpose: 'receipt' }),
      app,
    )
    const own = await withTenant(ids.a!, (tx) => getFile(tx, f.id), app)
    expect(own?.bytes.toString()).toBe('hello receipt')
    expect(await withTenant(ids.b!, (tx) => getFile(tx, f.id), app)).toBeNull()
    expect(await withTenant(ids.a!, (tx) => deleteFile(tx, f.id), app)).toBe(true)
    expect(await withTenant(ids.a!, (tx) => getFile(tx, f.id), app)).toBeNull()
  })

  it('rejects empty and oversized files', async () => {
    await expect(
      withTenant(
        ids.a!,
        (tx) => putFile(tx, { tenantId: ids.a!, bytes: Buffer.alloc(0), contentType: 'image/png' }),
        app,
      ),
    ).rejects.toThrow(/empty/)
    await expect(
      withTenant(
        ids.a!,
        (tx) =>
          putFile(tx, { tenantId: ids.a!, bytes: Buffer.alloc(9 * 1024 * 1024), contentType: 'image/png' }),
        app,
      ),
    ).rejects.toThrow(/8 MB/)
  })
})
