// F15 site blocks: blog posts, website enquiries, the Reviews / Instagram feeds and uploaded videos.
import {
  closeAllDbs,
  reviews,
  siteEnquiries,
  socialAccounts,
  socialPosts,
  tenants,
  withTenant,
} from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  DomainError,
  deletePost,
  getPublishedPost,
  listPosts,
  listPublishedPosts,
  listSiteEnquiries,
  navCounts,
  postBlocks,
  postInputSchema,
  reviewerName,
  savePost,
  setPostStatus,
  setSiteEnquiryStatus,
  siteEnquiryReplyText,
  siteEnquirySchema,
  siteInstagram,
  siteReviews,
  sniffVideoType,
  submitSiteEnquiry,
} from '../src'

const { platform, app } = testDbs()
const ids = {} as Record<string, string>
const tx = <T>(fn: Parameters<typeof withTenant<T>>[1], tenant = ids.a!) => withTenant(tenant, fn, app)

const post = (slug: string, title = 'Why hot stones work') =>
  postInputSchema.parse({
    slug,
    title: { en: title, ar: 'لماذا تنجح الأحجار الساخنة' },
    excerpt: { en: 'Warmth and calm.' },
    body: { en: 'Intro.\n\n## Benefits\n- Warmth\n- Calm' },
    coverImage: '',
    seoTitle: { en: '' },
    seoDescription: { en: '' },
  })

beforeAll(async () => {
  await resetTestDatabase()
  for (const [key, slug] of [
    ['a', 'blog-a'],
    ['b', 'blog-b'],
  ] as const) {
    const [t] = await platform
      .insert(tenants)
      .values({ slug, name: `Spa ${key}` })
      .returning()
    ids[key] = t!.id
  }
})
afterAll(closeAllDbs)

describe('blog posts', () => {
  it('validates the post form (slug, required title, cover URL)', () => {
    expect(postInputSchema.safeParse({ ...post('ok'), slug: 'Bad Slug' }).success).toBe(false)
    const noTitle = postInputSchema.safeParse({ ...post('ok'), title: { en: '  ' } })
    expect(noTitle.success ? [] : noTitle.error.issues.map((i) => i.message)).toContain('validation.required')
    const cover = postInputSchema.safeParse({ ...post('ok'), coverImage: 'javascript:alert(1)' })
    expect(cover.success ? [] : cover.error.issues.map((i) => i.message)).toContain(
      'website.blog.coverInvalid',
    )
    expect(
      postInputSchema.parse({ ...post('ok'), coverImage: '/files/3f2b8c1e-5a6d-4e7f-8a9b-0c1d2e3f4a5b' })
        .coverImage,
    ).toBe('/files/3f2b8c1e-5a6d-4e7f-8a9b-0c1d2e3f4a5b')
    // Arabic left empty is dropped, not stored as ''.
    expect(postInputSchema.parse({ ...post('ok'), excerpt: { en: 'x', ar: '  ' } }).excerpt).toEqual({
      en: 'x',
    })
  })

  it('creates drafts, refuses a taken address, publishes (date kept) and lists only live posts', async () => {
    const first = await tx((db) => savePost(db, ids.a!, null, post('hot-stones'), null))
    expect(first.status).toBe('draft')
    await expect(tx((db) => savePost(db, ids.a!, null, post('hot-stones'), null))).rejects.toBeInstanceOf(
      DomainError,
    )
    // Another spa may use the same address.
    await tx((db) => savePost(db, ids.b!, null, post('hot-stones'), null), ids.b!)
    expect(await tx((db) => listPublishedPosts(db))).toEqual([])
    expect(await tx((db) => getPublishedPost(db, 'hot-stones'))).toBeNull()

    const live = await tx((db) => setPostStatus(db, first.id, 'published', null))
    expect(live.publishedAt).toBeInstanceOf(Date)
    await tx((db) => setPostStatus(db, first.id, 'draft', null))
    const again = await tx((db) => setPostStatus(db, first.id, 'published', null))
    expect(again.publishedAt?.getTime()).toBe(live.publishedAt?.getTime())

    const list = await tx((db) => listPublishedPosts(db))
    expect(list.map((p) => p.slug)).toEqual(['hot-stones'])
    expect(list[0]).not.toHaveProperty('body')
    expect((await tx((db) => getPublishedPost(db, 'hot-stones')))?.title.en).toBe('Why hot stones work')
    // Tenant isolation: spa B's draft never shows on spa A, and B sees only its own post.
    expect((await tx((db) => listPosts(db), ids.b!)).map((p) => p.status)).toEqual(['draft'])

    await tx((db) => deletePost(db, first.id))
    expect(await tx((db) => listPosts(db))).toEqual([])
  })

  it('turns the plain-text body into paragraphs, sub-headings and bullets', () => {
    expect(postBlocks('Intro line\nsecond line\n\n## Benefits\n- Warmth\n- Calm\nAfter\n\n\n')).toEqual([
      { kind: 'p', text: 'Intro line\nsecond line' },
      { kind: 'h2', text: 'Benefits' },
      { kind: 'ul', items: ['Warmth', 'Calm'] },
      { kind: 'p', text: 'After' },
    ])
    expect(postBlocks('<script>alert(1)</script>')).toEqual([
      { kind: 'p', text: '<script>alert(1)</script>' },
    ])
  })
})

describe('website enquiries', () => {
  it('validates with error codes and normalises the phone', () => {
    const bad = siteEnquirySchema.safeParse({ name: '', phone: '123', message: '', locale: 'xx' })
    expect(bad.success ? [] : bad.error.issues.map((i) => i.message).sort()).toEqual([
      'phone',
      'required:message',
      'required:name',
    ])
    const good = siteEnquirySchema.parse({
      name: ' Layla\u202E  M ',
      phone: '050 123 4567',
      message: 'Hi\r\nDo you have a slot today?',
      locale: 'ar',
      page: 'contact',
    })
    expect(good).toEqual({
      name: 'Layla M',
      phone: '+971501234567',
      message: 'Hi\nDo you have a slot today?',
      locale: 'ar',
      page: 'contact',
    })
    expect(siteEnquirySchema.parse({ ...good, page: '../x' }).page).toBe('')
  })

  it('stores per spa, lists newest first with counts + search, moves status, counts new in the sidebar', async () => {
    const input = (name: string, phone: string) =>
      siteEnquirySchema.parse({ name, phone, message: `Hello from ${name}`, locale: 'en', page: '' })
    const one = await tx((db) => submitSiteEnquiry(db, ids.a!, input('Layla', '0501234567'), { ipHash: 'h' }))
    await tx((db) => submitSiteEnquiry(db, ids.a!, input('Omar', '+447700900123'), { ipHash: null }))
    await tx((db) => submitSiteEnquiry(db, ids.b!, input('Other', '0509999999'), { ipHash: null }), ids.b!)

    const all = await tx((db) => listSiteEnquiries(db))
    expect(all.rows.map((r) => r.name)).toEqual(['Omar', 'Layla'])
    expect(all.counts).toEqual({ new: 2, replied: 0, closed: 0 })
    expect((await tx((db) => listSiteEnquiries(db, { q: '4477' }))).rows.map((r) => r.name)).toEqual(['Omar'])
    expect((await tx((db) => listSiteEnquiries(db, { q: 'layla' }))).rows).toHaveLength(1)

    const counts = () =>
      tx((db) =>
        navCounts(db, { branchIds: null, calendar: false, outbox: false, instagram: false, enquiries: true }),
      )
    expect((await counts()).enquiriesNew).toBe(2)
    const moved = await tx((db) => setSiteEnquiryStatus(db, one.id, 'replied', null))
    expect(moved?.from).toBe('new')
    expect(moved?.row.handledAt).toBeInstanceOf(Date)
    expect((await counts()).enquiriesNew).toBe(1)
    expect((await tx((db) => listSiteEnquiries(db, { status: 'replied' }))).rows.map((r) => r.name)).toEqual([
      'Layla',
    ])
    // Another spa's id is invisible (RLS).
    expect(await tx((db) => setSiteEnquiryStatus(db, one.id, 'closed', null), ids.b!)).toBeNull()
    const [row] = await platform.select().from(siteEnquiries).where(eq(siteEnquiries.id, one.id))
    expect(row?.status).toBe('replied')
  })

  it('starts the WhatsApp reply in the language the guest wrote in', () => {
    expect(siteEnquiryReplyText({ name: 'Layla Mansour', locale: 'en' }, 'Birch Spa')).toBe(
      'Hi Layla, thank you for your message to Birch Spa. ',
    )
    expect(siteEnquiryReplyText({ name: 'ليلى', locale: 'ar' }, 'Birch Spa')).toContain('ليلى')
  })
})

describe('reviews + Instagram feeds', () => {
  it('shows good Google reviews with text, newest first, with the average over all reviews', async () => {
    const at = (d: number) => new Date(Date.UTC(2026, 8, d))
    await platform.insert(reviews).values([
      {
        tenantId: ids.a!,
        externalId: 'r1',
        author: 'Layla Mansour',
        rating: 5,
        text: 'Wonderful',
        reviewedAt: at(1),
      },
      { tenantId: ids.a!, externalId: 'r2', author: 'Omar', rating: 4, text: 'Great', reviewedAt: at(3) },
      { tenantId: ids.a!, externalId: 'r3', author: 'X', rating: 2, text: 'Meh', reviewedAt: at(4) },
      { tenantId: ids.a!, externalId: 'r4', author: 'Y', rating: 5, text: '  ', reviewedAt: at(5) },
      { tenantId: ids.b!, externalId: 'r5', author: 'Z', rating: 5, text: 'Other spa', reviewedAt: at(6) },
    ])
    const r = await tx((db) => siteReviews(db, { limit: 6, minRating: 4 }))
    expect(r.count).toBe(4)
    expect(r.average).toBe(4)
    expect(r.items.map((i) => [i.author, i.text])).toEqual([
      ['Omar', 'Great'],
      ['Layla M.', 'Wonderful'],
    ])
    expect(reviewerName('')).toBe('Google user')
  })

  it('shows the connected account and its published posts (first picture each, safe URLs only)', async () => {
    expect(await tx((db) => siteInstagram(db))).toEqual({ username: null, profileUrl: null, items: [] })
    await platform.insert(socialAccounts).values({
      tenantId: ids.a!,
      platform: 'instagram',
      externalId: 'ig-1',
      username: 'birchspa',
    })
    const img = 'https://app.example/files/3f2b8c1e-5a6d-4e7f-8a9b-0c1d2e3f4a5b?f=jpg'
    await platform.insert(socialPosts).values([
      {
        tenantId: ids.a!,
        platform: 'instagram',
        caption: 'Live',
        media: [{ url: img }],
        status: 'published',
      },
      { tenantId: ids.a!, platform: 'instagram', caption: 'Draft', media: [{ url: img }], status: 'draft' },
      {
        tenantId: ids.a!,
        platform: 'instagram',
        caption: 'Bad',
        media: [{ url: 'javascript:alert(1)' }],
        status: 'published',
      },
      { tenantId: ids.a!, platform: 'gbp', caption: 'Google', media: [{ url: img }], status: 'published' },
    ])
    const ig = await tx((db) => siteInstagram(db))
    expect(ig.profileUrl).toBe('https://www.instagram.com/birchspa/')
    expect(ig.items.map((i) => i.caption)).toEqual(['Live'])
  })
})

describe('uploaded videos', () => {
  const bytes = (head: number[], text = '') => {
    const b = new Uint8Array(64)
    b.set(head)
    for (let i = 0; i < text.length; i++) b[head.length + i] = text.charCodeAt(i)
    return b
  }
  it('accepts MP4 and WebM by magic bytes only', () => {
    const ftyp = (brand: string) => bytes([0, 0, 0, 0x18], `ftyp${brand}\0\0\0\0isom`)
    expect(sniffVideoType(ftyp('mp42'))).toBe('video/mp4')
    expect(sniffVideoType(bytes([0x1a, 0x45, 0xdf, 0xa3], '\x9fB\x86\x81\x01B\x82\x84webm'))).toBe(
      'video/webm',
    )
    expect(sniffVideoType(bytes([0, 0, 0, 0x18], 'ftypavif\0\0\0\0avif'))).toBeNull()
    expect(sniffVideoType(bytes([0, 0, 0, 0x14], 'ftypqt  \0\0\0\0qt  '))).toBeNull()
    expect(sniffVideoType(bytes([0x89], 'PNG\r\n\x1a\n'))).toBeNull()
  })
})
