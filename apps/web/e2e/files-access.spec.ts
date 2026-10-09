// F14 (PLAN §17, gap G13): who may read stored files (app/files/serve.ts) and the private exports/uploads next to them.
// Public site images: anyone, on any host. Private files (receipts: accounting; document scans: staff.manage): only
// active members of that spa with the permission, under the same rules as the dashboard (deleted spa closed, "Require
// 2FA"), and super-admins with 2FA (without 2FA: two-factor.spec). Everyone else gets the same 404 as a missing id.
// There are no signed URLs: every request re-checks the session (Cache-Control private, no-cache; Vary Cookie).
// Public caching, ETag/304 and resized variants are media.spec.
import { expect, type Page, test } from '@playwright/test'
import { storedFiles, tenants } from '@spa/db'
import { putFile } from '@spa/services'
import { count, eq } from 'drizzle-orm'
import {
  addMember,
  app,
  applyForSpa,
  approveApplication,
  createLogin,
  enableTotp,
  OWNER_PASSWORD,
  PATH,
  PNG,
  signInPlatformAdmin,
  signUpOwner,
  site,
  testDb,
  uniqueSlug,
} from './helpers'

type Probe = { status: number; cache: string | null; vary: string | null }
/** Same-origin fetch from the page, so it carries that host's session cookie (Node can't resolve *.localhost). */
const probe = (p: Page, url: string): Promise<Probe> =>
  p.evaluate(async (u) => {
    const r = await fetch(u, { redirect: 'manual' })
    return { status: r.status, cache: r.headers.get('cache-control'), vary: r.headers.get('vary') }
  }, url)

/** Multipart POST of a tiny PNG, as the dashboard uploaders send it. */
const upload = (p: Page, url: string) =>
  p.evaluate(async (u) => {
    const form = new FormData()
    form.append(
      'file',
      new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' }),
      'x.png',
    )
    return (await fetch(u, { method: 'POST', body: form })).status
  }, url)

const tenantId = async (slug: string) =>
  (await testDb().select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug)))[0]!.id

const store = (tenant: string, isPublic: boolean, purpose: string) =>
  testDb().transaction((tx) =>
    putFile(tx, {
      tenantId: tenant,
      bytes: PNG,
      contentType: 'image/png',
      filename: `${purpose}.png`,
      isPublic,
      purpose,
    }),
  )

test('files: public for anyone, private only for the right members of that spa and super-admins', async ({
  browser,
}) => {
  test.setTimeout(240_000)
  const open = async () => (await browser.newContext()).newPage()
  const db = testDb()

  // Spa A (owner with 2FA, a receptionist, an accountant) holds the files; spa B's owner is a stranger to them.
  const owner = await open()
  const { slug } = await signUpOwner(owner, { spa: 'Files Spa' })
  const spaA = await tenantId(slug)
  const files = {
    public: await store(spaA, true, 'media'),
    receipt: await store(spaA, false, 'receipt'),
    document: await store(spaA, false, 'staff_document'),
  }
  const member = async (role: 'receptionist' | 'accountant') => {
    const p = await open()
    const email = `${role}-${slug.slice(-8)}@e2e.test`
    await createLogin(p, { name: `Files ${role}`, email, password: OWNER_PASSWORD })
    await addMember(slug, email, role)
    return p
  }
  const receptionist = await member('receptionist')
  const accountant = await member('accountant')
  // Spa B's owner has not set up 2FA yet (used for the "Require 2FA" step below).
  const other = await open()
  const slugB = uniqueSlug('files-b')
  const emailB = `owner-${slugB}@e2e.test`
  await applyForSpa(other, { slug: slugB, email: emailB, spa: 'Other Spa' })
  await approveApplication(emailB)
  const ops = await open()
  await signInPlatformAdmin(ops) // on the console host
  const anon = await open()
  await anon.goto(`${app}/login`)

  await test.step('the matrix: public 200 for all; receipts need accounting, documents staff.manage', async () => {
    const matrix: [string, Page, Record<keyof typeof files, number>][] = [
      ['anonymous', anon, { public: 200, receipt: 404, document: 404 }],
      ['owner', owner, { public: 200, receipt: 200, document: 200 }],
      ['receptionist', receptionist, { public: 200, receipt: 404, document: 404 }],
      ['accountant', accountant, { public: 200, receipt: 200, document: 404 }],
      ['owner of another spa', other, { public: 200, receipt: 404, document: 404 }],
      ['super-admin', ops, { public: 200, receipt: 200, document: 200 }],
    ]
    for (const [who, p, want] of matrix) {
      const got: Record<string, number> = {}
      for (const [kind, f] of Object.entries(files)) got[kind] = (await probe(p, `/files/${f.id}`)).status
      expect(got, who).toEqual(want)
    }
    // Private answers are never shared caches; a refusal is not cached at all.
    const own = await probe(owner, `/files/${files.receipt.id}`)
    expect(own.cache).toBe('private, no-cache')
    expect(own.vary).toContain('Cookie')
    expect((await probe(receptionist, `/files/${files.receipt.id}`)).cache).toBe('no-store')
    expect((await probe(anon, `/files/${files.public.id}`)).cache).toBe('public, max-age=31536000, immutable')
  })

  await test.step('ids: malformed, traversal-shaped and unknown ids are 404; a friendlier name changes nothing', async () => {
    for (const path of [
      '/files/not-a-uuid',
      '/files/..%2F..%2Fetc%2Fpasswd',
      `/files/${files.receipt.id.slice(0, -1)}`,
      `/files/${files.receipt.id}x`,
      '/files/00000000-0000-4000-8000-000000000000',
    ])
      expect((await probe(owner, path)).status, path).toBe(404)
    expect((await probe(other, `/files/${files.receipt.id}/receipt.png`)).status).toBe(404)
    expect((await probe(owner, `/files/${files.receipt.id}/receipt.png`)).status).toBe(200)
  })

  if (!PATH)
    await test.step("the spa's own site host serves its public files only (no session there)", async () => {
      const siteOrigin = new URL(site(slug)).origin
      expect((await owner.goto(`${siteOrigin}/files/${files.public.id}`))?.status()).toBe(200)
      expect((await owner.goto(`${siteOrigin}/files/${files.receipt.id}`))?.status()).toBe(404)
      await owner.goto(`${app}/${slug}`)
    })

  await test.step('exports and uploads follow the same rules', async () => {
    const journal = `${app}/${slug}/accounts/export`
    expect((await probe(owner, journal)).status).toBe(200)
    expect((await probe(accountant, journal)).status).toBe(200)
    expect((await probe(receptionist, journal)).status).toBe(404)
    expect((await probe(other, journal)).status).toBe(404)
    expect((await probe(anon, journal)).status).toBe(0) // opaque redirect to sign-in
    // Site images need site.content; document scans need staff.manage; another spa's members get 404.
    expect(await upload(other, `/files/upload?tenant=${slug}`)).toBe(404)
    expect(await upload(receptionist, `/files/upload?tenant=${slug}`)).toBe(403)
    expect(await upload(other, `${app}/${slug}/documents/upload`)).toBe(404)
    expect(await upload(receptionist, `${app}/${slug}/documents/upload`)).toBe(403)
    expect(await upload(anon, `${app}/${slug}/documents/upload`)).toBe(401)
    const [stored] = await db.select({ n: count() }).from(storedFiles).where(eq(storedFiles.tenantId, spaA))
    expect(stored!.n).toBe(3)
  })

  await test.step('"Require 2FA": an owner without 2FA gets no private file of the spa until it is on', async () => {
    const receiptB = await store(await tenantId(slugB), false, 'receipt')
    expect((await probe(other, `/files/${receiptB.id}`)).status).toBe(404)
    await enableTotp(emailB)
    expect((await probe(other, `/files/${receiptB.id}`)).status).toBe(200)
  })

  await test.step('a deleted spa closes its private files to its members; super-admins still open them', async () => {
    await db.update(tenants).set({ deletedAt: new Date() }).where(eq(tenants.id, spaA))
    try {
      expect((await probe(owner, `/files/${files.receipt.id}`)).status).toBe(404)
      expect((await probe(accountant, `/files/${files.receipt.id}`)).status).toBe(404)
      expect((await probe(ops, `/files/${files.receipt.id}`)).status).toBe(200)
    } finally {
      await db.update(tenants).set({ deletedAt: null }).where(eq(tenants.id, spaA))
    }
  })
  for (const ctx of browser.contexts()) await ctx.close()
})
