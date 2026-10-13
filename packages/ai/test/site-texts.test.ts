// R28 P5: the Write texts runner shared by the console and the D5 queue (stub ModelArk client).
import { htmlContentParts, listHtmlDesignTexts } from '@spa/core'
import { closeAllDbs, platformAdmins, sites, tenants, user, withTenant } from '@spa/db'
import { seedPlatform } from '@spa/db/seed'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import {
  ensureSite,
  getEditablePage,
  getSite,
  listPages,
  queueSiteTexts,
  storeSpaHtmlDoc,
} from '@spa/services'
import { htmlTextSlots } from '@spa/services/site-kit'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createModelArkClient, runQueuedSiteTexts, runSiteTexts } from '../src'

process.env.SITE_AI_EDITOR_EMAILS = '*'
const { platform, app } = testDbs()
const ADMIN = 'texts-admin'
let tenantId: string
let pageId: string
let sha: string

const DATA = {
  contract: {
    version: 2,
    locales: ['en', 'ar'],
    fields: { 'ui.wa.*': { locales: ['en'] } },
    l10n: { ar: { 'ui.form.submit': 'اطلب الحجز' } },
  },
  spa: { name: 'Your Spa', short_name: 'Your Spa', area_label: '', logo_on_dark: '', logo_on_light: '' },
  journey: [{ id: 'welcome', title: 'Slow down.', body: 'Massage in the heart of {city}.', tags: [] }],
  booking: { label: 'Book' },
  contact: { whatsapp_number: '', whatsapp_message: 'Hello', phones: [] },
  services: [],
  staff: [],
  ui: { form: { submit: 'Request booking' }, wa: { intro: 'Hello {spa}, I would like to book:' } },
}
const HTML = `<!doctype html><html><head><title>{{spa_name}}</title></head><body><h1>Arrive slowly</h1><script>window.CRM_DATA = ${JSON.stringify(DATA)};</script></body></html>`
const H1 = listHtmlDesignTexts(HTML).find((x) => x.text === 'Arrive slowly')!

const reply = (texts: { key: string; en: string; ar: string }[]) => {
  const fetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: { role: 'assistant', content: JSON.stringify({ texts, note: 'Done.' }) },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 1000, completion_tokens: 200 },
        }),
      ),
  )
  return {
    fetch,
    client: createModelArkClient({ apiKey: 'k', fetch: fetch as unknown as typeof globalThis.fetch }),
  }
}
const DRAFTS = [
  { key: 'd-1/content:journey[welcome].title', en: 'Unwind by the sea.', ar: 'استرخ قرب البحر.' },
  // Loses the design's {city} token: skipped.
  { key: 'd-1/content:journey[welcome].body', en: 'Massage in Dubai.', ar: 'تدليك في دبي.' },
  { key: `d-1/text:${H1.id}`, en: 'Arrive and rest', ar: 'تعال واسترح' },
]
const draftContent = async () =>
  withTenant(
    tenantId,
    async (tx) =>
      (await getEditablePage(tx, tenantId, pageId))!.data as { content: { props: { content?: unknown } }[] },
    app,
  )

beforeAll(async () => {
  await resetTestDatabase()
  await seedPlatform(platform)
  const [t] = await platform
    .insert(tenants)
    .values({ slug: 'texts-spa', name: 'Texts Spa', aiBudgetUsd: '5' })
    .returning()
  tenantId = t!.id
  await platform.insert(user).values({
    id: ADMIN,
    name: 'Admin',
    email: 'texts-admin@e2e.test',
    emailVerified: true,
    twoFactorEnabled: true,
  })
  await platform.insert(platformAdmins).values({ userId: ADMIN })
  await withTenant(
    tenantId,
    async (tx) => {
      const doc = await storeSpaHtmlDoc(tx, { tenantId, html: HTML })
      sha = doc.sha256
      await ensureSite(tx, tenantId, {
        key: 'v2',
        name: 'V2',
        theme: {},
        pages: [
          {
            slug: '',
            title: { en: 'Home' },
            data: {
              root: { props: { htmlDesign: true } },
              content: [
                {
                  type: 'HtmlDesign',
                  props: {
                    id: 'd-1',
                    html: '',
                    doc,
                    images: [],
                    // The spa already wrote the booking label: onlyDefaults leaves it.
                    content: { v: 1, values: [{ path: 'booking.label', value: { t: { en: 'Reserve' } } }] },
                  },
                },
              ],
            },
          },
        ],
      })
      pageId = (await listPages(tx, tenantId))[0]!.id
    },
    app,
  )
})
afterAll(closeAllDbs)

describe('Write texts runner (R28 P5)', () => {
  it('slots: system copy never, the spa’s own values left with onlyDefaults', async () => {
    const data = (await draftContent()) as unknown
    const all = htmlTextSlots(data, HTML).map((s) => s.key)
    expect(all).toContain('d-1/content:booking.label')
    expect(all.some((k) => k.includes('content:ui.'))).toBe(false)
    const only = htmlTextSlots(data, HTML, { onlyDefaults: true }).map((s) => s.key)
    expect(only).not.toContain('d-1/content:booking.label')
    expect(only).toEqual(
      expect.arrayContaining([
        'd-1/content:journey[welcome].title',
        'd-1/content:journey[welcome].body',
        `d-1/text:${H1.id}`,
      ]),
    )
    // Leftovers still go in.
    expect(
      htmlTextSlots(data, HTML, { onlyDefaults: true, first: new Set(['d-1/content:booking.label']) })[0]!
        .key,
    ).toBe('d-1/content:booking.label')
  })

  it('a page on another design is skipped (designSha)', async () => {
    const { client, fetch } = reply(DRAFTS)
    const run = await runSiteTexts({
      tenantId,
      slug: 'texts-spa',
      userId: ADMIN,
      htmlOnly: true,
      designSha: 'f'.repeat(64),
      client,
    })
    expect(run.result).toEqual({
      pages: [],
      skipped: [{ title: 'Home', reason: 'the draft uses another design' }],
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('writes the drafts; a draft that loses a {token} is skipped', async () => {
    const { client } = reply(DRAFTS)
    const run = await runSiteTexts({
      tenantId,
      slug: 'texts-spa',
      userId: ADMIN,
      htmlOnly: true,
      onlyDefaults: true,
      designSha: sha,
      client,
    })
    expect(run.result.pages).toEqual([{ id: pageId, slug: '', title: 'Home', filled: 2 }])
    const parts = htmlContentParts((await draftContent()).content[0]!.props.content)
    expect(parts.values['journey[welcome].title']).toEqual({
      t: { en: 'Unwind by the sea.', ar: 'استرخ قرب البحر.' },
    })
    expect(parts.values['journey[welcome].body']).toBeUndefined()
    expect(parts.values['booking.label']).toEqual({ t: { en: 'Reserve' } })
    expect(parts.texts[H1.id]?.t).toEqual({ en: 'Arrive and rest', ar: 'تعال واسترح' })
  })

  it('a queued run is claimed once (two at the same time → one run), audited, then done', async () => {
    await withTenant(
      tenantId,
      (tx) =>
        queueSiteTexts(tx, tenantId, { via: 'template_upgrade', actorUserId: ADMIN, pageIds: [pageId] }),
      app,
    )
    const { client } = reply([
      {
        key: 'd-1/content:journey[welcome].body',
        en: 'Massage in the heart of {city}, slowly.',
        ar: 'تدليك في قلب {city}.',
      },
    ])
    const runs = await Promise.all([
      runQueuedSiteTexts(tenantId, { client }),
      runQueuedSiteTexts(tenantId, { client }),
    ])
    expect(runs.filter(Boolean)).toHaveLength(1)
    const done = runs.find(Boolean)!
    expect(done).toMatchObject({ state: 'done', via: 'template_upgrade' })
    expect(done.summary).toMatch(/^Drafted texts for 1 page in English and Arabic/)
    const [site] = await platform
      .select({ run: sites.textRun })
      .from(sites)
      .where(eq(sites.tenantId, tenantId))
    expect(site!.run).toMatchObject({ state: 'done' })
    expect(await runQueuedSiteTexts(tenantId, { client })).toBeNull()
  })

  it('the gate is checked again for whoever queued it', async () => {
    await platform.update(user).set({ twoFactorEnabled: false }).where(eq(user.id, ADMIN))
    await withTenant(
      tenantId,
      (tx) => queueSiteTexts(tx, tenantId, { via: 'template_apply', actorUserId: ADMIN, pageIds: [pageId] }),
      app,
    )
    const { client, fetch } = reply(DRAFTS)
    expect(await runQueuedSiteTexts(tenantId, { client })).toMatchObject({
      state: 'skipped',
      summary: 'needs SITE_AI_EDITOR_EMAILS + 2FA',
    })
    expect(fetch).not.toHaveBeenCalled()
    const site = await withTenant(tenantId, (tx) => getSite(tx, tenantId), app)
    expect(site!.textRun?.state).toBe('skipped')
  })
})
