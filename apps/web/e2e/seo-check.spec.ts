import { expect, test } from '@playwright/test'
import { aiAgentSettings, auditLog, pageVersions, seoChecks, sitePages } from '@spa/db'
import { ensureSite, publishAll } from '@spa/services'
import { and, asc, desc, eq } from 'drizzle-orm'
import {
  app,
  makeSiteAiEditor,
  mockAiReply,
  seedCatalog,
  signInStudioOnAdmin,
  signUpOwner,
  studioUrl,
  testDb,
} from './helpers'

/**
 * R30: the SEO check card on the console's spa website page. "Check now" reads the LIVE site (a published home page
 * without a search description → a high finding); "Draft fixes" (SITE_AI_EDITOR_EMAILS super-admins) is Write texts
 * on the search fields only, with a canned AI reply (AI_E2E_FIXTURE_DIR): drafts, nothing published. The spa's AI
 * studio shows the one-line summary under its SEO card.
 */
const DESC = 'Thai, Swedish and hot stone massage in Dubai Marina, open daily until midnight.'
const NEW_DESC = 'Unhurried Thai and Swedish massage at Seo Check Spa in Dubai Marina, every day.'
const pageData = (title: string, description: string) => ({
  root: { props: { title: { en: title, ar: '' }, description: { en: description, ar: '' } } },
  content: [{ type: 'Heading', props: { id: 'h-1', text: { en: 'Slow down', ar: '' }, level: 'h1' } }],
})

test('SEO check: Check now lists a missing description; Draft fixes drafts only the search fields', async ({
  page,
}) => {
  test.setTimeout(240_000)
  // SITE_AI_EDITOR_EMAILS (playwright.config.ts) lists this owner's email: owner-seo-editor@e2e.test.
  const { slug, email } = await signUpOwner(page, { spa: 'Seo Check Spa', slug: 'seo-editor' })
  await makeSiteAiEditor(slug)
  const seed = await seedCatalog(slug)
  const db = testDb()
  await db.transaction(async (tx) => {
    await ensureSite(tx, seed.tenantId, {
      key: 'nordic',
      name: 'Nordic Clean',
      theme: {},
      pages: [
        { slug: '', title: { en: 'Home' }, data: pageData('Massage in Dubai Marina', '') },
        { slug: 'services', title: { en: 'Services' }, data: pageData('Treatments and prices', DESC) },
      ],
    })
    await publishAll(tx, seed.tenantId)
  })
  const pages = await db
    .select()
    .from(sitePages)
    .where(eq(sitePages.tenantId, seed.tenantId))
    .orderBy(asc(sitePages.sort))
  const home = pages.find((p) => p.slug === '')!
  const versionsOf = (pageId: string) =>
    db
      .select()
      .from(pageVersions)
      .where(eq(pageVersions.pageId, pageId))
      .orderBy(desc(pageVersions.createdAt))

  await signInStudioOnAdmin(page, email)
  await page.goto(studioUrl(slug))
  const card = page.getByTestId('seo-check')

  await test.step('Check now: the live home page has no search description (high), audited', async () => {
    await expect(card).toContainText('No check yet.')
    // Draft fixes only once a check found something to fix.
    await expect(card.getByRole('button', { name: 'Draft fixes' })).toHaveCount(0)
    await card.getByRole('button', { name: 'Check now' }).click()
    await expect(page.getByText('Search check done: 1 thing to improve.')).toBeVisible({ timeout: 30_000 })
    await expect(card.getByTestId('seo-counts')).toContainText('1 high')
    const findings = card.getByRole('list', { name: 'SEO findings' })
    await expect(findings).toContainText('/')
    await expect(findings).toContainText('No search description')
    await expect(findings).not.toContainText('/services')
    await expect(card).toContainText('(Check now)')
    const [row] = await db.select().from(seoChecks).where(eq(seoChecks.tenantId, seed.tenantId))
    expect(row).toMatchObject({ trigger: 'manual', counts: { high: 1, medium: 0 } })
    const [logged] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.tenantId, seed.tenantId), eq(auditLog.action, 'site.seo_checked')))
    expect(logged?.data).toEqual({ counts: { high: 1, medium: 0 } })
  })

  await test.step('Draft fixes: only the home page’s search fields go into its draft; nothing is published', async () => {
    const before = await versionsOf(home.id)
    await mockAiReply(slug, {
      texts: [
        { key: 'root/title', en: 'Massage in Dubai Marina · Seo Check Spa', ar: 'تدليك في دبي مارينا' },
        { key: 'root/description', en: NEW_DESC, ar: 'تدليك تايلندي وسويدي هادئ في دبي مارينا كل يوم.' },
        // Not a search field: never written.
        { key: 'h-1/text', en: 'Changed', ar: 'تغير' },
      ],
      note: 'Search fields.',
    })
    await card.getByRole('button', { name: 'Draft fixes' }).click()
    const status = card.getByRole('status')
    await expect(status).toContainText('Search fixes drafted for 1 page in English and Arabic (Home 2)', {
      timeout: 120_000,
    })
    await expect(status).toContainText('The drafts are ready to review — check each page, then Publish.')
    const [draft] = await versionsOf(home.id)
    expect(draft!.status).toBe('draft')
    const data = draft!.data as ReturnType<typeof pageData>
    expect(data.root.props.description.en).toBe(NEW_DESC)
    expect(data.content[0]!.props.text.en).toBe('Slow down')
    // The live version is the one checked: unchanged.
    expect((await versionsOf(home.id)).filter((v) => v.status === 'published')).toEqual(
      before.filter((v) => v.status === 'published'),
    )
    const services = pages.find((p) => p.slug === 'services')!
    expect((await versionsOf(services.id)).every((v) => v.status === 'published')).toBe(true)
    const [logged] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.tenantId, seed.tenantId), eq(auditLog.action, 'site.ai_texts_written')))
    expect(logged?.data).toMatchObject({ via: 'studio_seo_fixes' })
  })

  await test.step('the spa’s AI studio: one line under the SEO card', async () => {
    await db
      .insert(aiAgentSettings)
      .values({ tenantId: seed.tenantId, agentKey: 'seo_agent', enabled: true })
      .onConflictDoNothing()
    // Same browser context: the owner's app-host session from signUpOwner (Premium: the AI studio is on).
    await page.goto(`${app}/${slug}/ai`)
    await expect(page.getByTestId('seo-check-line')).toContainText('Last search check')
    await expect(page.getByTestId('seo-check-line')).toContainText('1 thing to improve')
  })
})
