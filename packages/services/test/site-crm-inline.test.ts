// contract.inline (owner 2026-10-13 "no delay when I reload"): only a spa's own small public pictures are read.
import { closeAllDbs, tenants, withTenant } from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { crmInlineFileBytes, crmInlineFiles, HTML_DESIGN_DOC_PURPOSE, putFile } from '../src'

describe('crmInlineFiles', () => {
  const { platform, app } = testDbs()
  const ids = {} as Record<string, string>
  const webp = Buffer.concat([Buffer.from('RIFF\0\0\0\0WEBPVP8 '), Buffer.alloc(200)])

  beforeAll(async () => {
    await resetTestDatabase()
    const [a] = await platform.insert(tenants).values({ slug: 'inline-a', name: 'A' }).returning()
    const [b] = await platform.insert(tenants).values({ slug: 'inline-b', name: 'B' }).returning()
    ids.a = a!.id
    ids.b = b!.id
    const put = (tenantId: string, over: Partial<Parameters<typeof putFile>[1]> = {}) =>
      withTenant(
        tenantId,
        async (tx) =>
          (
            await putFile(tx, {
              tenantId,
              bytes: webp,
              contentType: 'image/webp',
              isPublic: true,
              purpose: 'logo',
              ...over,
            })
          ).id,
        app,
      )
    ids.logo = await put(ids.a)
    ids.private = await put(ids.a, { isPublic: false, purpose: 'receipt' })
    ids.doc = await put(ids.a, {
      purpose: HTML_DESIGN_DOC_PURPOSE,
      contentType: 'text/html',
      bytes: Buffer.from('<p>x</p>'),
    })
    ids.svg = await put(ids.a, { contentType: 'image/svg+xml', bytes: Buffer.from('<svg/>') })
    ids.big = await put(ids.a, { bytes: Buffer.concat([webp, Buffer.alloc(90 * 1024)]) })
    ids.other = await put(ids.b)
  })
  afterAll(closeAllDbs)

  const read = async (tenantId: string, id: string, max = 80 * 1024) =>
    crmInlineFileBytes(
      (await withTenant(tenantId, (tx) => crmInlineFiles(tx, tenantId, [id], max), app)).get(id),
      max,
    )

  it("reads the spa's own small public picture", async () => {
    const bytes = await read(ids.a!, ids.logo!)
    expect(Buffer.from(bytes!).equals(webp)).toBe(true)
  })

  it("refuses another spa's file, private files, design documents, non-raster types and larger files", async () => {
    expect(await read(ids.a!, ids.other!)).toBeNull()
    expect(await read(ids.b!, ids.logo!)).toBeNull()
    // Even naming the owner as the tenant from another spa's transaction: RLS hides the row.
    const viaB = await withTenant(ids.b!, (tx) => crmInlineFiles(tx, ids.a!, [ids.logo!], 80 * 1024), app)
    expect(viaB.size).toBe(0)
    expect(await read(ids.a!, ids.private!)).toBeNull()
    expect(await read(ids.a!, ids.doc!)).toBeNull()
    expect(await read(ids.a!, ids.svg!)).toBeNull()
    expect(await read(ids.a!, ids.big!)).toBeNull()
    expect(await read(ids.a!, ids.logo!, 100)).toBeNull()
    expect(await read(ids.a!, '00000000-0000-4000-8000-000000000000')).toBeNull()
  })

  it("reads all of a render's ids in one go, keeping only the readable ones", async () => {
    const all = Object.values(ids).filter((id) => id !== ids.a && id !== ids.b)
    const got = await withTenant(ids.a!, (tx) => crmInlineFiles(tx, ids.a!, all, 80 * 1024), app)
    expect([...got.keys()]).toEqual([ids.logo])
    expect(await withTenant(ids.a!, (tx) => crmInlineFiles(tx, ids.a!, [], 80 * 1024), app)).toEqual(
      new Map(),
    )
  })
})
