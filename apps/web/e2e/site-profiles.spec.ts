import { expect, test } from '@playwright/test'
import { auditLog, branches, socialAccounts } from '@spa/db'
import { ensureSite, publishAll } from '@spa/services'
import { and, eq } from 'drizzle-orm'
import { seedCatalog, signInPlatformAdmin, signUpOwner, site, studioUrl, testDb } from './helpers'

/**
 * R33: the console's Profile links card (spa website page). A super-admin saves the spa's official profiles; the
 * public page's schema.org JSON-LD lists them in sameAs (first), then the connected Facebook Page + its Instagram
 * account (automatic, read-only in the card), then the branch's Google Maps pin; the address names its city.
 */
const PIN = 'https://maps.app.goo.gl/ProfilePin1'
const GBP = 'https://g.page/r/ProfileLinksSpa/review'
const TIKTOK = 'https://www.tiktok.com/@profilelinksspa'

test('Profile links: saved in the console, listed in the public JSON-LD sameAs with the connected accounts', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000)
  const { slug } = await signUpOwner(page, { spa: 'Profile Links Spa' })
  const seed = await seedCatalog(slug)
  const db = testDb()
  await db
    .update(branches)
    .set({ address: 'Villa 9, Al Jimi, Al Ain, UAE', mapsUrl: PIN })
    .where(eq(branches.tenantId, seed.tenantId))
  await db.transaction(async (tx) => {
    await ensureSite(tx, seed.tenantId, {
      key: 'nordic',
      name: 'Nordic Clean',
      theme: {},
      pages: [
        {
          slug: '',
          title: { en: 'Home' },
          data: {
            root: { props: { title: { en: 'Profile Links Spa', ar: '' } } },
            content: [
              { type: 'Heading', props: { id: 'h-1', text: { en: 'Slow down', ar: '' }, level: 'h1' } },
            ],
          },
        },
      ],
    })
    await publishAll(tx, seed.tenantId)
  })
  // A chosen Facebook Page with a linked Instagram account (ids unique per run: one spa per Meta account).
  const pageId = String(Date.now())
  await db.insert(socialAccounts).values({
    tenantId: seed.tenantId,
    platform: 'facebook',
    externalId: pageId,
    username: 'Profile Links Spa',
    meta: { pageId, igUsername: 'profilelinks_spa' },
    status: 'connected',
  })
  const facebook = `https://www.facebook.com/${pageId}`
  const instagram = 'https://www.instagram.com/profilelinks_spa/'

  const studio = await (await browser.newContext()).newPage()
  await signInPlatformAdmin(studio)
  await studio.goto(studioUrl(slug))
  const card = studio.getByTestId('profile-links')

  await test.step('the card shows the connected accounts; an http:// link is refused', async () => {
    const list = card.getByRole('list', { name: 'Profile links' })
    await expect(list).toContainText(facebook)
    await expect(list).toContainText('From the connected Facebook Page')
    await expect(list).toContainText(instagram)
    await expect(list).toContainText('From the connected Instagram')
    await card.getByRole('button', { name: 'Edit' }).click()
    await studio
      .getByRole('textbox', { name: 'Links' })
      .fill(`${GBP}\nhttp://www.facebook.com/profilelinksspa`)
    await studio.getByRole('button', { name: 'Save links' }).click()
    await expect(
      studio.getByText('Line 2 is not a full https:// link: http://www.facebook.com/profilelinksspa').first(),
    ).toBeVisible()
  })

  await test.step('two links saved (trimmed, blank lines and repeats dropped), audited', async () => {
    await studio.getByRole('textbox', { name: 'Links' }).fill(`  ${GBP}  \n\n${TIKTOK}\n${GBP}`)
    await studio.getByRole('button', { name: 'Save links' }).click()
    await expect(studio.getByText('Profile links saved').first()).toBeVisible()
    const list = card.getByRole('list', { name: 'Profile links' })
    await expect(list.getByRole('link', { name: GBP })).toHaveAttribute('href', GBP)
    await expect(list.getByRole('link', { name: TIKTOK })).toBeVisible()
    await expect(list.getByRole('listitem')).toHaveCount(4)
    const [row] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.tenantId, seed.tenantId), eq(auditLog.action, 'site.profiles_updated')))
    expect(row).toMatchObject({ entity: 'site', data: { count: 2, links: [GBP, TIKTOK] } })
  })

  await test.step('public JSON-LD: sameAs = saved links, connected accounts, the pin; the city is named', async () => {
    await page.goto(site(slug))
    const raw = await page.locator('script[type="application/ld+json"]').first().textContent()
    const spa = (JSON.parse(raw ?? '') as { '@graph': Record<string, unknown>[] })['@graph'][0]!
    expect(spa.sameAs).toEqual([GBP, TIKTOK, instagram, facebook, PIN])
    expect(spa.hasMap).toBe(PIN)
    expect(spa.address).toMatchObject({
      streetAddress: 'Villa 9, Al Jimi, Al Ain, UAE',
      addressLocality: 'Al Ain',
      addressRegion: 'Abu Dhabi',
      addressCountry: 'AE',
    })
  })

  await test.step("only connected accounts count: the spa's own Instagram; no expired/pending Page, no disconnected account", async () => {
    await db
      .update(socialAccounts)
      .set({ status: 'expired' })
      .where(and(eq(socialAccounts.tenantId, seed.tenantId), eq(socialAccounts.platform, 'facebook')))
    const run = Date.now()
    await db.insert(socialAccounts).values([
      { tenantId: seed.tenantId, platform: 'facebook', externalId: 'pending', status: 'pending_page' },
      {
        tenantId: seed.tenantId,
        platform: 'instagram',
        externalId: `${run}1`,
        username: 'old_handle',
        status: 'disconnected',
      },
      {
        tenantId: seed.tenantId,
        platform: 'instagram',
        externalId: `${run}2`,
        username: '@profile.links',
        status: 'connected',
      },
    ])
    const own = 'https://www.instagram.com/profile.links/'
    await page.reload()
    const raw = await page.locator('script[type="application/ld+json"]').first().textContent()
    const spa = (JSON.parse(raw ?? '') as { '@graph': Record<string, unknown>[] })['@graph'][0]!
    expect(spa.sameAs).toEqual([GBP, TIKTOK, own, PIN])
    await studio.reload()
    const list = card.getByRole('list', { name: 'Profile links' })
    await expect(list.getByRole('link', { name: own })).toBeVisible()
    await expect(list.getByRole('listitem')).toHaveCount(3)
    await expect(list).not.toContainText('Facebook Page')
    await expect(list).not.toContainText('old_handle')
  })
})
