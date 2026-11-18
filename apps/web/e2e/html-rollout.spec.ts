import { readFile } from 'node:fs/promises'
import { expect, type Page, test } from '@playwright/test'
import { listHtmlDesignTexts } from '@spa/core'
import { pageVersions, sitePages, sites, siteTemplates, tenants } from '@spa/db'
import { and, desc, eq } from 'drizzle-orm'
import {
  admin,
  makeSiteAiEditor,
  mockAiReply,
  PORT,
  signInStudioOnAdmin,
  signUpOwner,
  site,
  studioUrl,
  testDb,
} from './helpers'

/**
 * R28 P5 (owner D4 + D5): an HTML template's new version is uploaded, previewed and signed off by its Roll out: the
 * spas live on the old version switch at once (their edits carried, the spa's own look pinned as its content, undo on
 * its page, a hold after an undo); a new apply of the v2 design runs Write texts (drafts, EN + AR). Fixtures: BE RELAX
 * v1 / v2 stripped, with the fake identity "Seaside Test Spa" (scratchpad make-v2.mjs --fixture).
 */
const V1 = new URL('./fixtures/r28-v1.html', import.meta.url)
const V2 = new URL('./fixtures/r28-v2.html', import.meta.url)
const NAME = 'Seaside Rollout'
const KEY = 'seaside-rollout'
const BLOCK = `${KEY}-html-design`
const LITERAL = /<script>window\.CRM_DATA = [\s\S]*?;<\/script>/

type Node = { type: string; props: Record<string, unknown> }
type Content = { v: 1; values?: { path: string; value: unknown }[]; texts?: unknown[]; pictures?: unknown[] }
const designOf = (data: unknown) =>
  ((data as { content: Node[] }).content.find((n) => n.type === 'HtmlDesign') as Node).props
const shaOf = (data: unknown) => (designOf(data).doc as { sha256: string }).sha256
const valuesOf = (data: unknown) =>
  Object.fromEntries(
    ((designOf(data).content as Content | undefined)?.values ?? []).map((v) => [v.path, v.value]),
  )

/** A request to a spa host as a browser would send it (Node can't resolve *.localhost: 127.0.0.1 + Host). */
function viaHost(page: Page, url: string) {
  const u = new URL(url)
  return page.request.fetch(`http://127.0.0.1:${PORT}${u.pathname}${u.search}`, {
    headers: { host: u.host },
    failOnStatusCode: false,
    maxRedirects: 0,
  })
}

async function homeOf(slug: string) {
  const db = testDb()
  const [t] = await db.select().from(tenants).where(eq(tenants.slug, slug))
  const [home] = await db
    .select({ id: sitePages.id })
    .from(sitePages)
    .where(and(eq(sitePages.tenantId, t!.id), eq(sitePages.slug, '')))
  return { tenantId: t!.id, pageId: home!.id }
}
const versionsOf = (pageId: string) =>
  testDb()
    .select()
    .from(pageVersions)
    .where(eq(pageVersions.pageId, pageId))
    .orderBy(desc(pageVersions.createdAt))
const liveOf = async (pageId: string) => (await versionsOf(pageId)).find((v) => v.status === 'published')!

/** The template's row on /platform/templates (other specs' templates may have versions too). */
const rowOf = (page: Page) => page.getByRole('row').filter({ hasText: NAME })
/** The Pages card's D5 line (DataTable renders the page cell twice: the table and the hidden phone list). */
const textRunLine = (page: Page) => page.getByTestId('write-texts-run').filter({ visible: true })

async function useZenThenApply(page: Page, slug: string) {
  await page.goto(studioUrl(slug))
  await page.getByRole('button', { name: 'Use Zen Minimal' }).click()
  await expect(page.getByTestId('current-template')).toHaveText('Zen Minimal', { timeout: 30_000 })
  await page
    .getByRole('article', { name: NAME })
    .getByRole('button', { name: `Apply ${NAME}` })
    .click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: `Switch to ${NAME}` })
    .click()
  await expect(page.getByTestId('current-template')).toHaveText(NAME, { timeout: 30_000 })
}

test('R28 P5: a new HTML template version rolls out live (edits carried, undo + hold), and Write texts follows a v2 apply', async ({
  page,
  browser,
}) => {
  test.setTimeout(420_000)
  const [v1, v2] = await Promise.all([readFile(V1, 'utf8'), readFile(V2, 'utf8')])
  // The design's own spa ("Seaside Test Spa"); its owner is a listed AI editor (SITE_AI_EDITOR_EMAILS).
  const owner = await signUpOwner(page, { slug: 'rollout-editor', spa: 'Seaside Test Spa' })
  const { slug } = owner
  // A listed AI editor counts only with a verified email (makeSiteAiEditor = makeStudio + verified).
  await makeSiteAiEditor(slug)
  await signInStudioOnAdmin(page, owner.email)
  const db = testDb()

  await page.goto(`${admin}/templates`)
  await page.getByRole('button', { name: 'Upload HTML' }).click()
  const up = page.getByRole('dialog')
  await up.getByLabel('Template name').fill(NAME)
  await up
    .getByLabel('HTML file')
    .setInputFiles({ name: 'v1.html', mimeType: 'text/html', buffer: Buffer.from(v1) })
  await expect(up.getByTestId('design-report-panel')).toContainText('CRM contract v1')
  await up.getByRole('checkbox', { name: /Spas can pick it right away/ }).check()
  await up.getByRole('button', { name: 'Upload' }).click()
  await expect(page.getByText(new RegExp(`${NAME} uploaded\\. Stored exactly as the file\\.`))).toBeVisible({
    timeout: 60_000,
  })
  await useZenThenApply(page, slug)
  const { tenantId, pageId } = await homeOf(slug)

  // The spa's own edits: a value, the nav's "Treatments" (bound to ui.nav.treatments in v2) and a picture.
  const nav = listHtmlDesignTexts(v1).find((x) => x.text === 'Treatments' && x.group === 'Nav')!
  const content: Content = {
    v: 1,
    values: [
      { path: 'journey[welcome].title', value: { t: { en: 'Rest by the sea.' } } },
      { path: 'journey[welcome].image', value: { img: 'https://example.com/seaside-pool.jpg' } },
    ],
    texts: [{ id: nav.id, src: nav.src, t: { en: 'Rituals' } }],
  }
  const [draft] = await versionsOf(pageId)
  const data = draft!.data as { content: Node[] }
  await db
    .update(pageVersions)
    .set({
      data: {
        ...data,
        content: data.content.map((n) =>
          n.type === 'HtmlDesign' ? { ...n, props: { ...n.props, content } } : n,
        ),
      },
    })
    .where(eq(pageVersions.id, draft!.id))
  await page.goto(studioUrl(slug))
  await page.getByRole('button', { name: 'Publish site' }).click()
  await page.getByRole('button', { name: 'Publish now' }).click()
  await expect(page.getByText(/^Published \d+ pages?/)).toBeVisible({ timeout: 30_000 })
  const v1Live = await liveOf(pageId)
  const sha1 = shaOf(v1Live.data)
  // A working draft waits too: carried by the upgrade, put back by its undo.
  const draftData = {
    ...(v1Live.data as object),
    content: (v1Live.data as { content: Node[] }).content.map((n) =>
      n.type === 'HtmlDesign'
        ? {
            ...n,
            props: {
              ...n.props,
              content: {
                ...content,
                values: [
                  ...content.values!,
                  { path: 'journey[welcome].body', value: { t: { en: 'Draft body' } } },
                ],
              },
            },
          }
        : n,
    ),
  }
  await db.insert(pageVersions).values({ tenantId, pageId, data: draftData, status: 'draft' })

  let templateId = ''
  let sha2 = ''
  await test.step('Upload new version: v2 waits for sign-off (CRM contract v2); its preview renders in EN and AR', async () => {
    await page.goto(`${admin}/templates`)
    await rowOf(page)
      .getByRole('button', { name: `Upload new version of ${NAME}` })
      .click()
    const sheet = page.getByRole('dialog')
    // The current version's Phone fixes (off) and picture adjustments are prefilled.
    await expect(sheet.getByTestId('version-prefill')).toContainText('From version 1: Phone fixes off')
    await expect(sheet.getByRole('checkbox', { name: /Phone fixes/ })).not.toBeChecked()
    await sheet
      .getByLabel('HTML file')
      .setInputFiles({ name: 'v2.html', mimeType: 'text/html', buffer: Buffer.from(v2) })
    await expect(sheet.getByTestId('design-report-panel')).toContainText('CRM contract v2')
    await sheet.getByRole('button', { name: 'Upload version' }).click()
    await expect(page.getByText(/Version 2 uploaded — waiting for your sign-off\./).first()).toBeVisible({
      timeout: 60_000,
    })
    const row = rowOf(page).getByTestId('template-version')
    await expect(row).toContainText('Version 2 waiting for sign-off')
    await expect(row).toContainText('CRM contract v2')
    const [t] = await db.select().from(siteTemplates).where(eq(siteTemplates.key, KEY))
    templateId = t!.id
    sha2 = t!.pending!.sha256
    expect(t!.version).toBe(1)
    // Nothing changed for the spa yet.
    expect(shaOf((await liveOf(pageId)).data)).toBe(sha1)
    await page.goto(`${admin}/templates/${templateId}/preview?version=pending`)
    const frame = page.frameLocator('iframe.site-html-design')
    await expect(frame.locator('[data-crm-text="ui.nav.treatments"]').first()).toHaveText('Treatments', {
      timeout: 30_000,
    })
    await page.goto(`${admin}/templates/${templateId}/preview?version=pending&lang=ar`)
    await expect(frame.locator('[data-crm-text="ui.nav.treatments"]').first()).toHaveText('العلاجات', {
      timeout: 30_000,
    })
  })

  await test.step('Roll out = sign-off: live at once for the spa, its edits carried and its look pinned', async () => {
    await page.goto(`${admin}/templates`)
    await rowOf(page).getByRole('button', { name: 'Roll out to 1 spa' }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet.getByRole('list', { name: 'Spas to switch' })).toContainText('Seaside Test Spa')
    await expect(sheet.getByRole('list', { name: 'Spas to switch' })).toContainText('made for this spa')
    await expect(sheet.getByRole('list', { name: 'Spas to switch' })).toContainText('has a draft')
    await sheet.getByRole('button', { name: 'Roll out to 1 spa' }).click()
    await expect(page.getByText(/Version 2 is live for 1 spa\./).first()).toBeVisible({ timeout: 60_000 })
    await page.keyboard.press('Escape')

    const live = await liveOf(pageId)
    expect(shaOf(live.data)).toBe(sha2)
    const values = valuesOf(live.data)
    expect(values['journey[welcome].title']).toEqual({ t: { en: 'Rest by the sea.' } })
    expect(values['journey[welcome].image']).toEqual({ img: 'https://example.com/seaside-pool.jpg' })
    expect(values['ui.nav.treatments']).toEqual({ t: { en: 'Rituals' } })
    expect(values['spa.short_name']).toEqual({ t: { en: 'Seaside' } })
    for (const logo of ['spa.logo_on_dark', 'spa.logo_on_light'])
      expect((values[logo] as { img: string }).img).toMatch(/^\/files\/[0-9a-f-]{36}$/)
    const [latest] = await versionsOf(pageId)
    expect(latest!.status).toBe('draft')
    expect(shaOf(latest!.data)).toBe(sha2)
    expect(valuesOf(latest!.data)['journey[welcome].body']).toEqual({ t: { en: 'Draft body' } })

    await page.goto(site(slug))
    await expect(page.locator('[data-crm-text="ui.nav.treatments"]').first()).toHaveText('Rituals', {
      timeout: 30_000,
    })
    const crm = (await page.evaluate('window.CRM_DATA')) as {
      locale: string
      journey: { title: string }[]
      spa: { logo_on_dark: string }
    }
    expect(crm.locale).toBe('en')
    expect(crm.journey[0]!.title).toBe('Rest by the sea.')
    expect(crm.spa.logo_on_dark).toMatch(/\/files\/[0-9a-f-]{36}/)
    // Only the CRM_DATA JSON differs from the v2 file (from <body>).
    const served = await (await viaHost(page, `${site(slug)}/`)).text()
    const body = (s: string) => s.slice(s.indexOf('<body')).replace(LITERAL, '')
    expect(body(served)).toBe(body(v2))
    // Arabic: the platform's locale, the design's own lang switch, its reviewed Arabic texts.
    await page.goto(`${site(slug)}?lang=ar`)
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar', { timeout: 30_000 })
    expect(await page.evaluate('window.CRM_DATA.locale')).toBe('ar')
    await expect(page.locator('[data-crm-text="ui.nav.journey"]').first()).toHaveText('الرحلة')
  })

  await test.step('D5 on the spa’s own design: skipped (its copy is its own)', async () => {
    await page.goto(studioUrl(slug))
    await expect(textRunLine(page)).toContainText('skipped: made for this spa')
    await expect(page.getByText(/Upgraded to version 2 on /)).toBeVisible()
    const [s] = await db.select({ run: sites.textRun }).from(sites).where(eq(sites.tenantId, tenantId))
    expect(s!.run).toMatchObject({ state: 'skipped', via: 'template_upgrade' })
  })

  await test.step('D5 on a new apply of v2 (another spa): Write texts drafts EN + AR at once; undo stays', async () => {
    const ctx = await browser.newContext()
    const other = await ctx.newPage()
    const second = await signUpOwner(other, { spa: 'Lotus Rollout Spa' })
    await ctx.close()
    await mockAiReply(second.slug, {
      texts: [
        {
          key: `${BLOCK}/content:journey[welcome].body`,
          en: 'Massage and a warm bath in the heart of {city}, cared for by our team.',
          ar: 'مساج وحمام دافئ في قلب {city}، مع فريقنا.',
        },
      ],
      note: 'Done.',
    })
    await useZenThenApply(page, second.slug)
    await expect(page.getByText(/Write texts is drafting its texts\./).first()).toBeVisible()
    const lotus = await homeOf(second.slug)
    await expect
      .poll(
        async () =>
          (await db.select({ run: sites.textRun }).from(sites).where(eq(sites.tenantId, lotus.tenantId)))[0]
            ?.run?.state,
        { timeout: 90_000 },
      )
      .toBe('done')
    const [latest] = await versionsOf(lotus.pageId)
    expect(latest!.status).toBe('draft')
    expect(valuesOf(latest!.data)['journey[welcome].body']).toEqual({
      t: {
        en: 'Massage and a warm bath in the heart of {city}, cared for by our team.',
        ar: 'مساج وحمام دافئ في قلب {city}، مع فريقنا.',
      },
    })
    // Nothing published; the switch's undo is still offered (no "Before Write texts" label over its draft).
    expect((await versionsOf(lotus.pageId)).some((v) => v.status === 'published')).toBe(false)
    expect((await versionsOf(lotus.pageId)).some((v) => v.label?.startsWith('Before Write texts'))).toBe(
      false,
    )
    await page.goto(studioUrl(second.slug))
    await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible()
    await expect(textRunLine(page)).toContainText('Drafted texts for 1 page')
  })

  await test.step('Undo: v1 re-published with the old content, the draft back; a later Roll out keeps it on v1', async () => {
    await page.goto(studioUrl(slug))
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(page.getByText('Back to version 1 (re-published)').first()).toBeVisible({ timeout: 30_000 })
    const live = await liveOf(pageId)
    expect(shaOf(live.data)).toBe(sha1)
    expect(designOf(live.data).content).toEqual(designOf(v1Live.data).content)
    const [latest] = await versionsOf(pageId)
    expect(latest!.status).toBe('draft')
    expect(latest!.data).toEqual(draftData)
    const [s] = await db.select({ hold: sites.templateHold }).from(sites).where(eq(sites.tenantId, tenantId))
    expect(s!.hold).toMatchObject({ key: KEY, version: 2 })

    await page.goto(`${admin}/templates`)
    await rowOf(page).getByRole('button', { name: 'Roll out to 1 spa' }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet.getByRole('list', { name: 'Not switched' })).toContainText(
      'Seaside Test Spa — kept on version 1',
    )
    await expect(sheet.getByText('No spa to switch')).toBeVisible()
    // A real Roll out: the held spa is reported and stays on v1.
    const versionsBefore = (await versionsOf(pageId)).length
    await sheet.getByRole('button', { name: 'Roll out to 1 spa' }).click()
    const result = page.getByRole('dialog', { name: 'Version 2 rolled out' })
    await expect(result).toBeVisible({ timeout: 60_000 })
    await expect(result).toContainText('Seaside Test Spa — kept on version 1 (its upgrade was undone)')
    await page.keyboard.press('Escape')
    expect(shaOf((await liveOf(pageId)).data)).toBe(sha1)
    expect((await versionsOf(pageId)).length).toBe(versionsBefore)
    const [held] = await db
      .select({ hold: sites.templateHold })
      .from(sites)
      .where(eq(sites.tenantId, tenantId))
    expect(held!.hold).toMatchObject({ key: KEY, version: 2 })
  })
})
