// Contact enquiries (PLAN §18.4): store (phone E.164, email lowercased), validation, per-IP limit, list/search/
// counts, status + note updates, platform-only table (a spa's app role can neither read nor write it).
import { closeAllDbs, contactEnquiries, tenants, user, withTenant } from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import {
  ENQUIRY_LIMITS,
  ENQUIRY_MESSAGE_MAX,
  enquiryCounts,
  enquirySchema,
  getEnquiry,
  listEnquiries,
  newEnquiryCount,
  submitEnquiry,
  updateEnquiry,
  withinRateLimits,
} from '../src'

const { platform, app } = testDbs()
const form = (over: Record<string, string> = {}) => ({
  name: '  Layla Hassan ',
  phone: '050 123 4567',
  email: ' Layla@Serenity.AE ',
  spaName: 'Serenity Spa',
  message: 'We have 2 branches and want online booking. Can you call me?',
  ...over,
})
const fieldErrors = (input: Record<string, string>) => {
  const r = enquirySchema.safeParse(input)
  return r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [i.path.join('.'), i.message]))
}
let tenantId = ''

beforeAll(async () => {
  await resetTestDatabase()
  await platform.insert(user).values({ id: 'u-admin', name: 'Owner', email: 'admin@enq.test' })
  const [t] = await platform.insert(tenants).values({ slug: 'enq-spa', name: 'Enq spa' }).returning()
  tenantId = t!.id
})
afterAll(closeAllDbs)

describe('contact enquiries', () => {
  it('stores an enquiry as new, with the phone in E.164 and the email lowercased', async () => {
    const e = await submitEnquiry(platform, form(), { ipHash: 'h1', userAgent: 'x'.repeat(400) })
    expect(e).toMatchObject({
      status: 'new',
      name: 'Layla Hassan',
      phone: '+971501234567',
      email: 'layla@serenity.ae',
      spaName: 'Serenity Spa',
      adminNote: null,
      ipHash: 'h1',
      handledBy: null,
    })
    expect(e.userAgent).toHaveLength(300)
    const intl = await submitEnquiry(platform, form({ phone: '+44 7700 900123', name: 'Tom' }))
    expect(intl.phone).toBe('+447700900123')
  })

  it('validates every field server-side (and the service refuses invalid input)', async () => {
    expect(fieldErrors(form())).toEqual({})
    expect(fieldErrors({})).toMatchObject({
      name: 'Enter your name',
      phone: 'Enter your phone number',
      email: 'Enter your email address',
      spaName: 'Enter your spa’s name',
      message: 'Tell us what you need',
    })
    expect(
      fieldErrors(
        form({
          name: ' ',
          phone: '12345',
          email: 'not-an-email',
          message: 'x'.repeat(ENQUIRY_MESSAGE_MAX + 1),
        }),
      ),
    ).toEqual({
      name: 'Enter your name',
      phone: 'Enter a UAE mobile (05…) or an international number with its country code (+44…)',
      email: 'Enter a valid email address',
      message: `Keep your message under ${ENQUIRY_MESSAGE_MAX} characters`,
    })
    expect(fieldErrors(form({ message: 'x'.repeat(ENQUIRY_MESSAGE_MAX) }))).toEqual({})
    await expect(submitEnquiry(platform, form({ phone: 'call me' }))).rejects.toBeInstanceOf(ZodError)
    const [n] = await platform.select({ n: sql<number>`count(*)::int` }).from(contactEnquiries)
    expect(n?.n).toBe(2)
  })

  it('limits enquiries per IP: 5 an hour (and 20 a day)', async () => {
    expect(ENQUIRY_LIMITS).toEqual([
      [5, 3600],
      [20, 86_400],
    ])
    const hit = (ip: string) => withinRateLimits(platform, 'enquiry', ip, ENQUIRY_LIMITS)
    const first = []
    for (let i = 0; i < 6; i++) first.push(await hit('9.9.9.9'))
    expect(first).toEqual([true, true, true, true, true, false])
    expect(await hit('8.8.8.8')).toBe(true)
  })

  it('lists newest first with a status filter and search; counts by status', async () => {
    await submitEnquiry(
      platform,
      form({ name: 'Omar 100%', spaName: 'Palm Wellness', email: 'omar@palm.ae' }),
    )
    expect((await listEnquiries(platform)).map((e) => e.name)).toEqual(['Omar 100%', 'Tom', 'Layla Hassan'])
    expect((await listEnquiries(platform, { q: 'palm' })).map((e) => e.name)).toEqual(['Omar 100%'])
    expect((await listEnquiries(platform, { q: 'SERENITY.ae' })).map((e) => e.name)).toEqual([
      'Tom',
      'Layla Hassan',
    ])
    // Wildcards are literal; 4+ digits match the phone.
    expect((await listEnquiries(platform, { q: '100%' })).map((e) => e.name)).toEqual(['Omar 100%'])
    expect(await listEnquiries(platform, { q: '_' })).toEqual([])
    expect((await listEnquiries(platform, { q: '7700 900' })).map((e) => e.name)).toEqual(['Tom'])
    expect(await listEnquiries(platform, { status: 'contacted' })).toEqual([])
    expect(await enquiryCounts(platform)).toEqual({ new: 3, contacted: 0, closed: 0, all: 3 })
    expect(await newEnquiryCount(platform)).toBe(3)
  })

  it('sets status and an internal note, stamping who handled it', async () => {
    const [layla] = await listEnquiries(platform, { q: 'Layla' })
    const res = await updateEnquiry(platform, {
      id: layla!.id,
      status: 'contacted',
      note: '  Called, demo on Sunday ',
      actorId: 'u-admin',
    })
    expect(res?.changed).toEqual(['status', 'note'])
    expect(res?.after).toMatchObject({
      status: 'contacted',
      adminNote: 'Called, demo on Sunday',
      handledBy: 'u-admin',
    })
    expect(res?.after.handledAt).toBeInstanceOf(Date)
    // Nothing changed → nothing written.
    const same = await updateEnquiry(platform, {
      id: layla!.id,
      status: 'contacted',
      note: 'Called, demo on Sunday',
      actorId: 'u-other',
    })
    expect(same?.changed).toEqual([])
    expect((await getEnquiry(platform, layla!.id))?.handledBy).toBe('u-admin')
    const closed = await updateEnquiry(platform, {
      id: layla!.id,
      status: 'closed',
      note: '',
      actorId: 'u-admin',
    })
    expect(closed?.changed).toEqual(['status', 'note'])
    expect(closed?.after.adminNote).toBeNull()
    expect(
      await updateEnquiry(platform, {
        id: '00000000-0000-4000-8000-000000000000',
        status: 'closed',
        note: null,
        actorId: 'u-admin',
      }),
    ).toBeNull()
    expect(await enquiryCounts(platform)).toEqual({ new: 2, contacted: 0, closed: 1, all: 3 })
  })

  it('is a platform-only table: a spa (app role) can neither read nor write enquiries', async () => {
    expect(await withTenant(tenantId, (tx) => tx.select().from(contactEnquiries), app)).toEqual([])
    expect(await app.select().from(contactEnquiries)).toEqual([])
    await expect(
      withTenant(
        tenantId,
        (tx) => tx.execute(sql`update contact_enquiries set status = 'closed' returning id`),
        app,
      ),
    ).resolves.toMatchObject({ rows: [] })
    await expect(
      app.execute(sql`insert into contact_enquiries (name, phone, email, spa_name, message)
        values ('x', '+971501234567', 'x@x.co', 'x', 'x')`),
    ).rejects.toThrow()
    const [still] = await platform
      .select({ n: sql<number>`count(*)::int` })
      .from(contactEnquiries)
      .where(eq(contactEnquiries.status, 'new'))
    expect(still?.n).toBe(2)
  })
})
