import { closeAllDbs, storedFiles, tenants, withTenant } from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { clearTenantLogo, DomainError, LOGO_MAX_EDGE, logoUrl, processLogo, setTenantLogo } from '../src'

describe('spa logo', () => {
  const { platform, app } = testDbs()
  const ids = {} as Record<string, string>

  beforeAll(async () => {
    await resetTestDatabase()
    const [a] = await platform.insert(tenants).values({ slug: 'logo-a', name: 'A' }).returning()
    const [b] = await platform.insert(tenants).values({ slug: 'logo-b', name: 'B' }).returning()
    ids.a = a!.id
    ids.b = b!.id
  })
  afterAll(closeAllDbs)

  it('stores a shrunk public WebP and points the tenant at it; RLS keeps it to its own tenant', async () => {
    const png = await sharp({ create: { width: 1600, height: 900, channels: 3, background: '#3b6fe0' } })
      .png()
      .toBuffer()
    const image = await processLogo(png)
    expect(Math.max(image.width, image.height)).toBe(LOGO_MAX_EDGE)
    const { fileId, url } = await withTenant(
      ids.a!,
      (tx) => setTenantLogo(tx, { tenantId: ids.a!, image }),
      app,
    )
    expect(url).toBe(logoUrl(fileId))

    const [tenant] = await platform.select().from(tenants).where(eq(tenants.id, ids.a!))
    expect(tenant!.logoFileId).toBe(fileId)
    const [file] = await platform.select().from(storedFiles).where(eq(storedFiles.id, fileId))
    expect(file).toMatchObject({ isPublic: true, purpose: 'logo', contentType: 'image/webp' })

    // Another tenant's transaction can't touch tenant A's row (tenant_self policy).
    await withTenant(ids.b!, (tx) => clearTenantLogo(tx, ids.a!), app)
    const [still] = await platform.select().from(tenants).where(eq(tenants.id, ids.a!))
    expect(still!.logoFileId).toBe(fileId)

    await withTenant(ids.a!, (tx) => clearTenantLogo(tx, ids.a!), app)
    const [cleared] = await platform.select().from(tenants).where(eq(tenants.id, ids.a!))
    expect(cleared!.logoFileId).toBeNull()
  })

  it('rejects files that are not images, with a translatable error', async () => {
    const err = await processLogo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')).catch((e) => e)
    expect(err).toBeInstanceOf(DomainError)
    expect(err.i18n).toEqual({ key: 'errors.file.svg' })
  })
})
