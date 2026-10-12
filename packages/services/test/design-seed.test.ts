// R28 P3: filling the CRM from a contract design (planDesignSeed / applyDesignSeed) and the shared catalog rules.
import { closeAllDbs, mediaAssets, services, serviceVariants, staff, tenants, withTenant } from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { arrayContains, eq } from 'drizzle-orm'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  applyDesignSeed,
  type DesignSeedChoices,
  DomainError,
  planDesignSeed,
  saveService,
  setServiceImage,
  setStaffPhoto,
} from '../src'

const { platform, app } = testDbs()
let a = ''
let b = ''
const inA = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(a, fn, app)
const inB = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(b, fn, app)
const ids: Record<string, string> = {}

const dataUri = async (background: string, format: 'png' | 'jpeg' = 'png') => {
  const img = sharp({ create: { width: 24, height: 16, channels: 3, background } })
  const bytes = await (format === 'png' ? img.png() : img.jpeg()).toBuffer()
  return `data:image/${format};base64,${bytes.toString('base64')}`
}
let design: Record<string, unknown> = {}

beforeAll(async () => {
  await resetTestDatabase()
  const [ta, tb] = await platform
    .insert(tenants)
    .values([
      { slug: 'seed-a', name: 'Be Relax' },
      { slug: 'seed-b', name: 'Other Spa' },
    ])
    .returning()
  a = ta!.id
  b = tb!.id
  await inA(async (db) => {
    const rows = await db
      .insert(services)
      .values([
        { tenantId: a, name: { en: 'Normal Massage' }, sort: 1 },
        {
          tenantId: a,
          name: { en: 'Couple Massage' },
          imageUrl: '/files/0b6c8a52-1d2e-4c3f-9a8b-7c6d5e4f3a21',
          description: { en: 'Our own words', ar: 'كلماتنا' },
          sort: 2,
        },
        { tenantId: a, name: { en: 'Four Hands Massage' }, sort: 3 },
        { tenantId: a, name: { en: 'Morocco Bath or Jacuzzi' }, sort: 4 },
      ])
      .returning({ id: services.id, name: services.name })
    for (const r of rows) ids[r.name.en] = r.id
    await db.insert(serviceVariants).values([
      { tenantId: a, serviceId: ids['Normal Massage']!, durationMin: 60, priceAed: '250' },
      { tenantId: a, serviceId: ids['Normal Massage']!, durationMin: 90, priceAed: '350' },
      { tenantId: a, serviceId: ids['Couple Massage']!, durationMin: 60, priceAed: '500' },
    ])
    const people = await db
      .insert(staff)
      .values([
        { tenantId: a, displayName: 'Maya', sort: 1 },
        {
          tenantId: a,
          displayName: 'Ana',
          photoUrl: 'https://example.com/ana.jpg',
          showOnSite: true,
          sort: 2,
        },
        { tenantId: a, displayName: 'Gone', active: false, sort: 3 },
      ])
      .returning({ id: staff.id, name: staff.displayName })
    for (const p of people) ids[p.name] = p.id
  })
  await inB(async (db) => {
    const [s] = await db
      .insert(services)
      .values({ tenantId: b, name: { en: 'Normal Massage' } })
      .returning({ id: services.id })
    const [p] = await db.insert(staff).values({ tenantId: b, displayName: 'Bea' }).returning({ id: staff.id })
    ids.otherService = s!.id
    ids.otherStaff = p!.id
  })
  const green = await dataUri('#2f6b4f')
  design = {
    spa: { name: 'BE RELAX' },
    services: [
      {
        id: 'normal',
        name: 'Normal massage',
        durations: [60, 90],
        description: 'Design words',
        image: green,
      },
      { id: 'couple', name: 'Couple massage', description: 'Design couple', image: await dataUri('#aa3344') },
      // Same picture as "Normal massage": one library file.
      { id: 'four-hands', name: '4-hands massage', image: green },
      {
        id: 'moroccan',
        name: 'Moroccan bath or jacuzzi',
        note: 'per person',
        image: 'https://cdn.example/x.jpg',
      },
      {
        id: 'shaving-massage',
        name: 'Massage with shaving',
        durations: [45, 5000],
        image: await dataUri('#123456', 'jpeg'),
      },
      { id: 'shaving', name: 'Full body shaving' },
      { name: '' },
    ],
    staff: [
      { id: 't1', name: 'Lin', photo: await dataUri('#ddeeff') },
      { name: 'Noor', photo: 'https://cdn.example/noor.jpg' },
      { name: 'Svg', photo: 'data:image/svg+xml;base64,PHN2Zy8+' },
    ],
  }
})
afterAll(closeAllDbs)

const designAssets = () =>
  inA((db) =>
    db
      .select({ url: mediaAssets.url, tags: mediaAssets.tags })
      .from(mediaAssets)
      .where(arrayContains(mediaAssets.tags, ['design'])),
  )
const service = (id: string) =>
  inA(async (db) => {
    const [s] = await db.select().from(services).where(eq(services.id, id))
    const variants = await db
      .select({ durationMin: serviceVariants.durationMin, priceAed: serviceVariants.priceAed })
      .from(serviceVariants)
      .where(eq(serviceVariants.serviceId, id))
      .orderBy(serviceVariants.sort)
    return { ...s!, variants }
  })
const person = (id: string) => inA(async (db) => (await db.select().from(staff).where(eq(staff.id, id)))[0]!)

describe('planDesignSeed', () => {
  it('pairs design services with the CRM, lists usable pictures and active therapists; writes nothing', async () => {
    const plan = await inA((db) => planDesignSeed(db, a, design))
    expect(plan.services.map((s) => [s.designId, s.match?.name ?? null])).toEqual([
      ['normal', 'Normal Massage'],
      ['couple', 'Couple Massage'],
      ['four-hands', 'Four Hands Massage'],
      ['moroccan', 'Morocco Bath or Jacuzzi'],
      ['shaving-massage', null],
      ['shaving', null],
    ])
    expect(plan.services[0]).toMatchObject({
      index: 0,
      designName: 'Normal massage',
      durations: [60, 90],
      description: 'Design words',
      hasImage: true,
      match: { serviceId: ids['Normal Massage'], score: 1 },
    })
    expect(plan.services[2]!.match!.score).toBeLessThan(1)
    expect(plan.services[3]).toMatchObject({ hasImage: false, note: 'per person' })
    // 5000 min is outside 10–480.
    expect(plan.services[4]).toMatchObject({ durations: [45], hasImage: true })
    expect(plan.staffPhotos).toEqual([{ designId: 't1', index: 0, name: 'Lin' }])
    expect(plan.crmStaff).toEqual([
      { id: ids.Maya, name: 'Maya', hasPhoto: false, showOnSite: false },
      { id: ids.Ana, name: 'Ana', hasPhoto: true, showOnSite: true },
    ])
    expect(await designAssets()).toEqual([])
  })

  it("never sees another spa's CRM", async () => {
    const plan = await inB((db) => planDesignSeed(db, b, design))
    expect(plan.services[0]!.match!.serviceId).toBe(ids.otherService)
    expect(plan.services.filter((s) => s.match)).toHaveLength(1)
    expect(plan.crmStaff.map((s) => s.name)).toEqual(['Bea'])
  })
})

describe('applyDesignSeed', () => {
  const choices: DesignSeedChoices = {
    services: [
      { designId: 'normal', action: 'fill', serviceId: '' },
      { designId: 'couple', action: 'fill', serviceId: '' },
      { designId: 'four-hands', action: 'skip' },
      { designId: 'shaving-massage', action: 'create' },
      { designId: 'shaving', action: 'create' },
    ],
    staff: [{ designId: 't1', staffId: '', showOnSite: true }],
  }
  const withIds = (): DesignSeedChoices => ({
    ...choices,
    services: choices.services.map((c) =>
      c.designId === 'normal'
        ? { ...c, serviceId: ids['Normal Massage'] }
        : c.designId === 'couple'
          ? { ...c, serviceId: ids['Couple Massage'] }
          : c,
    ),
    staff: [{ designId: 't1', staffId: ids.Maya!, showOnSite: true }],
  })

  it("refuses another spa's ids and unknown design ids, writing nothing", async () => {
    const theirs = withIds()
    theirs.services[0] = { designId: 'normal', action: 'fill', serviceId: ids.otherService }
    await expect(inA((db) => applyDesignSeed(db, a, design, theirs, { userId: null }))).rejects.toMatchObject(
      {
        code: 'not_found',
      },
    )
    const theirStaff = { ...withIds(), staff: [{ designId: 't1', staffId: ids.otherStaff! }] }
    await expect(
      inA((db) => applyDesignSeed(db, a, design, theirStaff, { userId: null })),
    ).rejects.toBeInstanceOf(DomainError)
    const unknown = { ...withIds(), staff: [{ designId: 'nobody', staffId: ids.Maya! }] }
    await expect(
      inA((db) => applyDesignSeed(db, a, design, unknown, { userId: null })),
    ).rejects.toMatchObject({
      code: 'invalid',
    })
    // Valid choices but run as the other spa: its RLS hides spa A's service.
    await expect(
      inB((db) => applyDesignSeed(db, b, design, withIds(), { userId: null })),
    ).rejects.toMatchObject({
      code: 'not_found',
    })
    expect(await designAssets()).toEqual([])
    expect((await service(ids['Normal Massage']!)).imageUrl).toBeNull()
  })

  it('fills only empty fields, creates the new ones on request, sets the picked photo; prices untouched', async () => {
    const summary = await inA((db) => applyDesignSeed(db, a, design, withIds(), { userId: null }))
    // Pictures: green (normal + four-hands), red (couple, library only), jpeg (created service), Lin.
    expect(summary).toEqual({
      servicesFilled: 1,
      servicesCreated: 2,
      photosSet: 1,
      assets: 4,
      picturesFailed: 0,
    })
    const assets = await designAssets()
    expect(assets).toHaveLength(4)
    for (const x of assets) {
      expect(x.url).toMatch(/^\/files\/[0-9a-f-]{36}$/)
      expect(x.tags).toEqual(['design', expect.stringMatching(/^design:[0-9a-f]{8}$/)])
    }

    const normal = await service(ids['Normal Massage']!)
    expect(normal.imageUrl).toMatch(/^\/files\//)
    expect(normal.description).toEqual({ en: 'Design words' })
    expect(normal.variants).toEqual([
      { durationMin: 60, priceAed: '250.00' },
      { durationMin: 90, priceAed: '350.00' },
    ])
    const couple = await service(ids['Couple Massage']!)
    expect(couple.imageUrl).toBe('/files/0b6c8a52-1d2e-4c3f-9a8b-7c6d5e4f3a21')
    expect(couple.description).toEqual({ en: 'Our own words', ar: 'كلماتنا' })
    expect(couple.variants).toEqual([{ durationMin: 60, priceAed: '500.00' }])
    expect((await service(ids['Four Hands Massage']!)).imageUrl).toBeNull()

    const created = await inA((db) => db.select().from(services).where(eq(services.tenantId, a)))
    const shavingMassage = created.find((s) => s.name.en === 'Massage with shaving')!
    expect(shavingMassage).toMatchObject({
      categoryId: null,
      onlineBookable: true,
      active: true,
      showPrice: null,
      description: null,
      imageUrl: expect.stringMatching(/^\/files\//),
    })
    expect((await service(shavingMassage.id)).variants).toEqual([{ durationMin: 45, priceAed: null }])
    const shaving = created.find((s) => s.name.en === 'Full body shaving')!
    expect((await service(shaving.id)).variants).toEqual([{ durationMin: 60, priceAed: null }])
    expect(shaving.imageUrl).toBeNull()

    const maya = await person(ids.Maya!)
    expect(maya.photoUrl).toMatch(/^\/files\//)
    expect(maya.showOnSite).toBe(true)
    expect((await person(ids.Ana!)).photoUrl).toBe('https://example.com/ana.jpg')
  })

  it('a re-run reuses the pictures and creates no duplicate services', async () => {
    const before = await inA((db) => db.select({ id: services.id }).from(services))
    const summary = await inA((db) => applyDesignSeed(db, a, design, withIds(), { userId: null }))
    expect(summary).toEqual({
      servicesFilled: 0,
      servicesCreated: 0,
      photosSet: 1,
      assets: 0,
      picturesFailed: 0,
    })
    expect(await designAssets()).toHaveLength(4)
    expect(await inA((db) => db.select({ id: services.id }).from(services))).toHaveLength(before.length)
  })

  it('replace overwrites photo and description (keeps the Arabic); prices still untouched', async () => {
    const summary = await inA((db) =>
      applyDesignSeed(
        db,
        a,
        design,
        {
          services: [{ designId: 'couple', action: 'fill', serviceId: ids['Couple Massage'], replace: true }],
          staff: [],
          library: false,
        },
        { userId: null },
      ),
    )
    expect(summary).toMatchObject({ servicesFilled: 1, assets: 0 })
    const couple = await service(ids['Couple Massage']!)
    expect(couple.imageUrl).not.toBe('/files/0b6c8a52-1d2e-4c3f-9a8b-7c6d5e4f3a21')
    expect((await designAssets()).map((x) => x.url)).toContain(couple.imageUrl)
    expect(couple.description).toEqual({ en: 'Design couple', ar: 'كلماتنا' })
    expect(couple.variants).toEqual([{ durationMin: 60, priceAed: '500.00' }])
  })

  it('"Show on website" only when asked, never for archived people', async () => {
    await inA((db) =>
      applyDesignSeed(
        db,
        a,
        design,
        {
          services: [],
          staff: [
            { designId: 't1', staffId: ids.Gone!, showOnSite: true },
            { designId: 't1', staffId: ids.Ana! },
          ],
        },
        { userId: null },
      ),
    )
    const gone = await person(ids.Gone!)
    expect(gone.photoUrl).toMatch(/^\/files\//)
    expect(gone.showOnSite).toBe(false)
    const ana = await person(ids.Ana!)
    expect(ana.photoUrl).toMatch(/^\/files\//)
    expect(ana.showOnSite).toBe(true)
  })

  it('skips pictures that are not real images', async () => {
    const broken = {
      services: [
        {
          id: 'bad',
          name: 'Bad picture',
          image: `data:image/png;base64,${Buffer.from('<svg/>'.repeat(4)).toString('base64')}`,
        },
      ],
    }
    const summary = await inA((db) =>
      applyDesignSeed(
        db,
        a,
        broken,
        { services: [{ designId: 'bad', action: 'create' }], staff: [] },
        { userId: null },
      ),
    )
    expect(summary).toMatchObject({ servicesCreated: 1, picturesFailed: 1, assets: 0 })
  })
})

describe('catalog rules', () => {
  const base = {
    categoryId: null,
    name: { en: 'Rule test' },
    description: null,
    bufferBeforeMin: 0,
    bufferAfterMin: 10,
    therapistsRequired: 1,
    roomTypes: [],
    equipmentTypes: [],
    onlineBookable: true,
    showPrice: null,
    active: true,
    color: null,
  }
  it('refuses no durations, durations outside 10–480, bad prices and foreign image URLs', async () => {
    for (const bad of [
      { variants: [] },
      { variants: [{ durationMin: 5, priceAed: null }] },
      { variants: [{ durationMin: 481, priceAed: null }] },
      { variants: [{ durationMin: 60, priceAed: -1 }] },
      { variants: [{ durationMin: 60, priceAed: null }], imageUrl: 'javascript:alert(1)' },
      { variants: [{ durationMin: 60, priceAed: null }], imageUrl: 'http://example.com/a.jpg' },
    ])
      await expect(inA((db) => saveService(db, a, { ...base, ...bad }))).rejects.toBeInstanceOf(DomainError)
    const id = await inA((db) =>
      saveService(db, a, {
        ...base,
        variants: [{ durationMin: 60, priceAed: 100 }],
        imageUrl: 'https://cdn.example/a.jpg',
      }),
    )
    expect((await service(id!)).variants).toEqual([{ durationMin: 60, priceAed: '100.00' }])
    // A form without the photo field keeps the photo; kept durations update in place, removed ones go.
    const [kept] = await inA((db) =>
      db.select({ id: serviceVariants.id }).from(serviceVariants).where(eq(serviceVariants.serviceId, id!)),
    )
    await inA((db) =>
      saveService(db, a, {
        ...base,
        id: id!,
        variants: [
          { durationMin: 30, priceAed: null },
          { id: kept!.id, durationMin: 90, priceAed: 150 },
        ],
      }),
    )
    const edited = await service(id!)
    expect(edited.imageUrl).toBe('https://cdn.example/a.jpg')
    expect(edited.variants).toEqual([
      { durationMin: 30, priceAed: null },
      { durationMin: 90, priceAed: '150.00' },
    ])
    await inA((db) =>
      saveService(db, a, {
        ...base,
        id: id!,
        imageUrl: null,
        variants: [{ durationMin: 60, priceAed: null }],
      }),
    )
    expect((await service(id!)).imageUrl).toBeNull()
    // Another spa's service: not found (RLS).
    expect(
      await inA((db) =>
        saveService(db, a, {
          ...base,
          id: ids.otherService,
          variants: [{ durationMin: 60, priceAed: null }],
        }),
      ),
    ).toBeNull()
    expect(await inA((db) => setServiceImage(db, ids.otherService!, { imageUrl: null }))).toBe(false)
  })

  it('staff website profile: library or https photo, bio ≤ 120', async () => {
    await expect(
      inA((db) => setStaffPhoto(db, ids.Maya!, { photoUrl: 'data:image/png;base64,AAAA' })),
    ).rejects.toBeInstanceOf(DomainError)
    await expect(
      inA((db) => setStaffPhoto(db, ids.Maya!, { bio: { en: 'x'.repeat(121) } })),
    ).rejects.toBeInstanceOf(DomainError)
    expect(await inA((db) => setStaffPhoto(db, ids.Maya!, { bio: { en: ' Thai\nmassage ', ar: '' } }))).toBe(
      true,
    )
    expect((await person(ids.Maya!)).bio).toEqual({ en: 'Thai massage' })
    expect(await inA((db) => setStaffPhoto(db, ids.otherStaff!, { photoUrl: null }))).toBe(false)
  })
})
