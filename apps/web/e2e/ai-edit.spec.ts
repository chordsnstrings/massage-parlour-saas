import { expect, type Page, test } from '@playwright/test'
import { aiUsage, auditLog, pageVersions, sitePages, sites, user } from '@spa/db'
import { ensureSite, getSite, publishAll, renamePage, saveDraft, updateDraftTheme } from '@spa/services'
import { applySiteEditOps, type SiteEditOp } from '@spa/services/site-kit'
import { and, desc, eq } from 'drizzle-orm'
import { siteEditSchema } from '../src/components/site/ai-schema'
import { SECTION_PRESETS } from '../src/components/site/presets'
import {
  app,
  makeSiteAiEditor,
  makeStudio,
  mockAiReply,
  screenshotAt,
  seedCatalog,
  signUpOwner,
  testDb,
} from './helpers'

const HERO = 'Unwind in the heart of the city'
const NEW_HERO = 'Golden calm in the city'

const homePage = {
  root: { props: { title: { en: 'Home', ar: 'الرئيسية' } } },
  content: [
    {
      type: 'Hero',
      props: {
        id: 'hero-1',
        variant: 'split',
        title: { en: HERO, ar: 'استرخِ في قلب المدينة' },
        subtitle: { en: 'Unhurried treatments.' },
        buttons: [],
        image: '/icon.svg',
        imageAlt: { en: 'Spa' },
        background: 'none',
      },
    },
  ],
}

test('AI edit schema matches the real blocks: every section preset re-validates', () => {
  const schema = siteEditSchema()
  expect(Object.keys(schema.blocks)).not.toContain('GlobalSection')
  expect(schema.blocks.Hero?.props.title).toEqual({ kind: 'bi' })
  for (const preset of SECTION_PRESETS) {
    const r = applySiteEditOps(
      { data: { root: {}, content: [] }, theme: {}, ops: [{ op: 'preset', key: preset.key }] },
      schema,
    )
    expect(r.ok, preset.key).toBe(true)
    // The preset's own top-level props pass the prop validators (slots excluded: they change via add/move).
    const { id: _id, ...props } = preset.node.props
    const spec = schema.blocks[preset.node.type]!.props
    const editable = Object.fromEntries(
      Object.entries(props).filter(([k]) => spec[k]?.kind !== 'slot' && k !== 'advanced'),
    )
    if (!Object.keys(editable).length) continue
    const node = { type: preset.node.type, props: { ...preset.node.props, id: 'x' } }
    const u = applySiteEditOps(
      { data: { root: {}, content: [node] }, theme: {}, ops: [{ op: 'update', id: 'x', props: editable }] },
      schema,
    )
    expect(u.ok ? [] : u.errors, preset.key).toEqual([])
  }
})

type ActionCall = { url: string; action: string; type: string; body: string }

/** Replays a captured server-action request from `page` (its own session), with text replaced in the body. */
const replay = (page: Page, call: ActionCall, swap: [string, string][] = []) =>
  page.evaluate(
    async ({ url, action, type, body }) => {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'next-action': action, 'content-type': type, accept: 'text/x-component' },
        body,
      })
      return r.text()
    },
    { ...call, url: page.url(), body: swap.reduce((b, [a, z]) => b.replaceAll(a, z), call.body) },
  )

test('Website Studio: Ask AI previews an edit, applies it to the draft and undoes it', async ({
  page,
  browser,
}) => {
  // SITE_AI_EDITOR_EMAILS (playwright.config.ts) lists this owner's email: owner-ai-editor@e2e.test.
  const { slug, email } = await signUpOwner(page, { spa: 'Saffron Spa', slug: 'ai-editor' })
  await makeSiteAiEditor(slug)
  const seed = await seedCatalog(slug)
  const db = testDb()
  await db.transaction((tx) =>
    ensureSite(tx, seed.tenantId, {
      key: 'nordic',
      name: 'Nordic Clean',
      theme: { accent: '#5e7d6b' },
      pages: [{ slug: '', title: { en: 'Home', ar: 'الرئيسية' }, data: homePage }],
    }),
  )
  const [home] = await db.select().from(sitePages).where(eq(sitePages.tenantId, seed.tenantId))
  const draft = async () => {
    const [v] = await db
      .select()
      .from(pageVersions)
      .where(eq(pageVersions.pageId, home!.id))
      .orderBy(desc(pageVersions.createdAt))
      .limit(1)
    return JSON.stringify(v!.data)
  }
  /** Live theme accent, and the unpublished draft theme's accent (AI theme ops only touch the draft). */
  const accent = async () => {
    const [s] = await db.select().from(sites).where(eq(sites.tenantId, seed.tenantId))
    return {
      live: (s!.theme as { accent?: string }).accent,
      draft: (s!.themeDraft as { accent?: string } | null)?.accent,
    }
  }
  const ops: SiteEditOp[] = [
    { op: 'update', id: 'hero-1', props: { title: { en: NEW_HERO, ar: 'هدوء ذهبي في المدينة' } } },
    { op: 'add', type: 'FAQ', after: 'hero-1' },
    { op: 'theme', tokens: { accent: '#b8892b' } },
  ]
  await mockAiReply(slug, { ops, note: 'Gold accent, a warmer hero and an FAQ.' })
  // Server-action calls of the Ask AI panel, kept to replay them as other accounts below.
  const calls: ActionCall[] = []
  page.on('request', (r) => {
    const action = r.headers()['next-action']
    if (r.method() === 'POST' && action)
      calls.push({
        url: r.url(),
        action,
        type: r.headers()['content-type'] ?? 'text/plain;charset=UTF-8',
        body: r.postData() ?? '',
      })
  })

  const canvas = page.frameLocator('#preview-frame').first()
  await page.goto(`${app}/${slug}/website/editor/${home!.id}`)
  await expect(canvas.getByRole('heading', { name: HERO })).toBeVisible({ timeout: 30_000 })

  await test.step('preview: the canvas shows the change, nothing is saved', async () => {
    await page.getByRole('button', { name: 'Ask AI' }).click()
    await page.getByPlaceholder('What should change?').fill('Make it gold and add an FAQ after the hero')
    await page.getByRole('button', { name: 'Preview change' }).click()
    const changes = page.getByRole('list', { name: 'Proposed changes' })
    await expect(changes).toContainText('Updated Hero (title)')
    await expect(changes).toContainText('Added FAQ after Hero')
    await expect(changes).toContainText('Theme: accent')
    await expect(canvas.getByRole('heading', { name: NEW_HERO })).toBeVisible()
    expect(await draft()).toContain(HERO)
    await screenshotAt(page, 'editor-ai-edit')
  })

  await test.step('apply saves the draft (and theme), audited — never published', async () => {
    await page.getByRole('button', { name: 'Apply to draft' }).click()
    await expect(page.getByText('AI changes saved as a draft')).toBeVisible()
    await expect.poll(draft).toContain(NEW_HERO)
    expect(await draft()).toContain('"type":"FAQ"')
    expect(await accent()).toEqual({ live: '#5e7d6b', draft: '#b8892b' })
    await expect(page.getByRole('list', { name: 'Recent AI changes' })).toContainText(
      'Make it gold and add an FAQ after the hero',
    )
    const published = await db
      .select()
      .from(pageVersions)
      .where(and(eq(pageVersions.pageId, home!.id), eq(pageVersions.status, 'published')))
    expect(published).toHaveLength(0)
    const logged = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.tenantId, seed.tenantId), eq(auditLog.action, 'site.page.ai_edit')))
    expect(logged).toHaveLength(1)
    const usage = await db.select().from(aiUsage).where(eq(aiUsage.tenantId, seed.tenantId))
    expect(usage.some((u) => u.agentKey === 'site_editor')).toBe(true)
  })

  await test.step('undo restores the previous draft and theme', async () => {
    await page.getByRole('button', { name: 'Undo AI change' }).click()
    await expect(page.getByText('AI change undone')).toBeVisible()
    await expect(canvas.getByRole('heading', { name: HERO })).toBeVisible()
    await expect.poll(draft).not.toContain(NEW_HERO)
    // Exactly as before: there was no draft theme, so none is left (not a copy of the live one).
    expect(await accent()).toEqual({ live: '#5e7d6b', draft: undefined })
    await expect(page.getByRole('list', { name: 'Recent AI changes' })).toHaveCount(0)
  })

  await test.step('a stale editor is refused instead of overwriting newer draft work (e.g. Claude MCP)', async () => {
    const savedAt = async () =>
      (
        await db
          .select({ at: pageVersions.createdAt })
          .from(pageVersions)
          .where(eq(pageVersions.pageId, home!.id))
          .orderBy(desc(pageVersions.createdAt))
          .limit(1)
      )[0]!.at.getTime()
    const claude = {
      ...homePage,
      content: [
        { ...homePage.content[0]!, props: { ...homePage.content[0]!.props, title: { en: 'From Claude' } } },
      ],
    }
    await db.transaction((tx) => saveDraft(tx, { tenantId: seed.tenantId, pageId: home!.id, data: claude }))
    await page.getByRole('button', { name: 'Save draft' }).click()
    await expect(
      page.getByText(
        'This page changed elsewhere (Claude or another editor) — reload the editor to get the latest version',
      ),
    ).toBeVisible()
    expect(await draft()).toContain('From Claude')
    await page.reload()
    await expect(canvas.getByRole('heading', { name: 'From Claude' })).toBeVisible({ timeout: 30_000 })
    const before = await savedAt()
    await page.getByRole('button', { name: 'Save draft' }).click()
    await expect.poll(savedAt).toBeGreaterThan(before)
  })

  await test.step('the server re-checks the allow-list on every Ask AI action, not just the panel', async () => {
    const plan = calls.find((c) => c.body.includes('Make it gold') && !c.body.includes('"ops"'))
    const apply = calls.find((c) => c.body.includes('"ops"') && c.body.includes('Make it gold'))
    expect(plan && apply).toBeTruthy()
    // A studio super-admin with 2FA who is NOT in SITE_AI_EDITOR_EMAILS, on their own spa.
    const other = await browser.newContext()
    const op = await other.newPage()
    const mine = await signUpOwner(op, { spa: 'Replay Spa' })
    await makeStudio(mine.slug)
    const mineSeed = await seedCatalog(mine.slug)
    await db.transaction((tx) =>
      ensureSite(tx, mineSeed.tenantId, {
        key: 'nordic',
        name: 'Nordic Clean',
        theme: { accent: '#5e7d6b' },
        pages: [{ slug: '', title: { en: 'Home' }, data: homePage }],
      }),
    )
    const [mineHome] = await db.select().from(sitePages).where(eq(sitePages.tenantId, mineSeed.tenantId))
    await mockAiReply(mine.slug, { ops, note: 'Replayed.' })
    await op.goto(`${app}/${mine.slug}/website/editor/${mineHome!.id}`)
    await expect(op.frameLocator('#preview-frame').first().getByRole('heading', { name: HERO })).toBeVisible({
      timeout: 30_000,
    })
    const swap: [string, string][] = [
      [`"${slug}"`, `"${mine.slug}"`],
      [home!.id, mineHome!.id],
    ]
    for (const call of [plan!, apply!])
      expect(await replay(op, call, swap)).toContain('AI site editing isn’t enabled for your account.')
    expect(await db.select().from(aiUsage).where(eq(aiUsage.tenantId, mineSeed.tenantId))).toHaveLength(0)
    const mineVersions = await db.select().from(pageVersions).where(eq(pageVersions.pageId, mineHome!.id))
    expect(mineVersions).toHaveLength(1)
    expect(JSON.stringify(mineVersions[0]!.data)).not.toContain(NEW_HERO)
    await other.close()

    // The listed editor without 2FA: no super-admin powers at all (G3), so no AI plan / apply either.
    const usageBefore = (await db.select().from(aiUsage).where(eq(aiUsage.tenantId, seed.tenantId))).length
    const draftBefore = await draft()
    await db.update(user).set({ twoFactorEnabled: false }).where(eq(user.email, email))
    for (const call of [plan!, apply!]) expect(await replay(page, call)).not.toContain('Updated Hero')
    expect(await db.select().from(aiUsage).where(eq(aiUsage.tenantId, seed.tenantId))).toHaveLength(
      usageBefore,
    )
    expect(await draft()).toBe(draftBefore)
    await db.update(user).set({ twoFactorEnabled: true }).where(eq(user.email, email))
  })
})

test('Website Studio: the Theme panel keeps an AI theme draft unpublished; Publish site takes theme + renames live', async ({
  page,
}) => {
  const { slug } = await signUpOwner(page, { spa: 'Theme Draft Spa' })
  await makeStudio(slug)
  const seed = await seedCatalog(slug)
  const db = testDb()
  await db.transaction(async (tx) => {
    await ensureSite(tx, seed.tenantId, {
      key: 'nordic',
      name: 'Nordic Clean',
      theme: { accent: '#5e7d6b' },
      pages: [
        { slug: '', title: { en: 'Home', ar: 'الرئيسية' }, data: homePage },
        { slug: 'about', title: { en: 'About' }, data: homePage },
      ],
    })
    await publishAll(tx, seed.tenantId)
  })
  // What Claude's set_theme and rename_page leave behind: a draft theme and a pending rename — no page draft.
  await db.transaction(async (tx) => {
    const site = await getSite(tx, seed.tenantId)
    await updateDraftTheme(tx, seed.tenantId, { ...site!.theme, accent: '#c0392b' })
    const [about] = await tx
      .select()
      .from(sitePages)
      .where(and(eq(sitePages.tenantId, seed.tenantId), eq(sitePages.slug, 'about')))
    await renamePage(tx, { tenantId: seed.tenantId, pageId: about!.id, slug: 'team', title: { en: 'Team' } })
  })
  const themes = async () => {
    const [s] = await db.select().from(sites).where(eq(sites.tenantId, seed.tenantId))
    return { live: s!.theme, draft: s!.themeDraft }
  }

  await page.goto(`${app}/${slug}/website`)
  await expect(page.getByText('Site theme changes are waiting to be published')).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByText('1 page has unpublished changes')).toBeVisible()

  await test.step('Theme panel: shows the live theme; saving a font change keeps the AI accent a draft', async () => {
    await page.getByRole('button', { name: 'Theme', exact: true }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet.getByRole('note')).toContainText('An unpublished theme draft')
    await expect(sheet.getByLabel('Accent colour')).toHaveValue('#5e7d6b')
    const font = sheet.getByLabel('Headings')
    const next = (await font.inputValue()) === 'sans' ? 'serif' : 'sans'
    await font.selectOption(next)
    await sheet.getByRole('button', { name: 'Save theme' }).click()
    await expect(
      page.getByText(
        'Theme saved — your changes are live; the unpublished theme draft goes live when you publish',
      ),
    ).toBeVisible({ timeout: 30_000 })
    expect(await themes()).toMatchObject({
      live: { accent: '#5e7d6b', headingFont: next },
      draft: { accent: '#c0392b', headingFont: next },
    })
  })

  await test.step('Publish site takes the theme draft and the pending rename live', async () => {
    await page.getByRole('button', { name: 'Publish site' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('the site theme has unpublished changes (every page)')
    await dialog.getByRole('button', { name: 'Publish now' }).click()
    await expect(page.getByText('Published 1 page and the site theme')).toBeVisible({ timeout: 30_000 })
    expect(await themes()).toMatchObject({ live: { accent: '#c0392b' }, draft: null })
    const [team] = await db
      .select()
      .from(sitePages)
      .where(and(eq(sitePages.tenantId, seed.tenantId), eq(sitePages.slug, 'team')))
    expect(team).toMatchObject({ title: { en: 'Team' }, pending: null })
    await expect(page.getByText('Everything is live')).toBeVisible({ timeout: 30_000 })
  })
})

test('Website Studio: Ask AI is off for a super-admin outside SITE_AI_EDITOR_EMAILS', async ({ page }) => {
  const { slug } = await signUpOwner(page, { spa: 'Other Studio Spa' })
  await makeStudio(slug)
  const seed = await seedCatalog(slug)
  const db = testDb()
  await db.transaction((tx) =>
    ensureSite(tx, seed.tenantId, {
      key: 'nordic',
      name: 'Nordic Clean',
      theme: { accent: '#5e7d6b' },
      pages: [{ slug: '', title: { en: 'Home', ar: 'الرئيسية' }, data: homePage }],
    }),
  )
  const [home] = await db.select().from(sitePages).where(eq(sitePages.tenantId, seed.tenantId))
  await mockAiReply(slug, { ops: [{ op: 'remove', id: 'hero-1' }], note: 'Removed.' })
  await page.goto(`${app}/${slug}/website/editor/${home!.id}`)
  await page.getByRole('button', { name: 'Ask AI' }).click()
  await expect(page.getByRole('note')).toHaveText('AI site editing isn’t enabled for your account.')
  await expect(page.getByPlaceholder('What should change?')).toHaveCount(0)
  const usage = await db.select().from(aiUsage).where(eq(aiUsage.tenantId, seed.tenantId))
  expect(usage).toHaveLength(0)
})
