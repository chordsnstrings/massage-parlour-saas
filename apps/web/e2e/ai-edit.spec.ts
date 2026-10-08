import { expect, test } from '@playwright/test'
import { aiUsage, auditLog, pageVersions, sitePages, sites } from '@spa/db'
import { ensureSite } from '@spa/services'
import { applySiteEditOps, type SiteEditOp } from '@spa/services/site-kit'
import { and, desc, eq } from 'drizzle-orm'
import { siteEditSchema } from '../src/components/site/ai-schema'
import { SECTION_PRESETS } from '../src/components/site/presets'
import { app, makeStudio, mockAiReply, screenshotAt, seedCatalog, signUpOwner, testDb } from './helpers'

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

test('Website Studio: Ask AI previews an edit, applies it to the draft and undoes it', async ({ page }) => {
  const { slug } = await signUpOwner(page, { spa: 'Saffron Spa' })
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
  const draft = async () => {
    const [v] = await db
      .select()
      .from(pageVersions)
      .where(eq(pageVersions.pageId, home!.id))
      .orderBy(desc(pageVersions.createdAt))
      .limit(1)
    return JSON.stringify(v!.data)
  }
  const accent = async () => {
    const [s] = await db.select().from(sites).where(eq(sites.tenantId, seed.tenantId))
    return (s!.theme as { accent?: string }).accent
  }
  const ops: SiteEditOp[] = [
    { op: 'update', id: 'hero-1', props: { title: { en: NEW_HERO, ar: 'هدوء ذهبي في المدينة' } } },
    { op: 'add', type: 'FAQ', after: 'hero-1' },
    { op: 'theme', tokens: { accent: '#b8892b' } },
  ]
  await mockAiReply(slug, { ops, note: 'Gold accent, a warmer hero and an FAQ.' })

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
    expect(await accent()).toBe('#b8892b')
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
    expect(await accent()).toBe('#5e7d6b')
  })
})
