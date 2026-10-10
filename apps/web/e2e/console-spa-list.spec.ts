import { mkdirSync } from 'node:fs'
import { expect, type Page, test } from '@playwright/test'
import { aiUsage, branches, plans, storedFiles, subscriptions, tenants } from '@spa/db'
import { sql } from 'drizzle-orm'
import { admin, planIdOf, signInPlatformAdmin, testDb, uniqueSlug } from './helpers'

// F21 console spa list fitted to one page (owner 2026-10-10: "all data in one page without go left/right"):
// no horizontal overflow at any width, worst-case rows, and every server sort key still reachable.
const SHOTS = process.env.E2E_SHOTS_DIR ?? 'test-results/screens'
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000)
const isoDay = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' })

async function seed(tag: string) {
  const db = testDb()
  const [legacy] = await db
    .insert(plans)
    .values({
      code: `${tag}-legacy`,
      name: 'Premium monthly (legacy)',
      priceAed: '3000',
      billingInterval: 'month',
      active: false,
    })
    .returning()
  const premium = await planIdOf('premium')
  const standard = await planIdOf('standard')
  const spa = (
    key: string,
    name: string,
    joinedDaysAgo: number,
    extra: Partial<typeof tenants.$inferInsert> = {},
  ) => ({ slug: `${tag}-${key}`, name, createdAt: daysAgo(joinedDaysAgo), ...extra })
  const rows = await db
    .insert(tenants)
    .values([
      spa(
        'be-relax-massage-center-spa-jumeirah-lake-towers-cluster-x',
        'Be Relax Massage Center Spa – Jumeirah Lake Towers Cluster X',
        300,
        {
          status: 'active',
          featureTier: 'standard',
        },
      ),
      spa('al-noor', 'Al Noor Thai Wellness & Foot Reflexology Lounge', 200, {
        status: 'past_due',
        billingStage: 'overdue',
        billingOverdueSince: isoDay(daysAgo(1)),
      }),
      spa('serenity', 'Serenity Hammam & Moroccan Bath – Dubai Marina Walk', 120, {
        status: 'read_only',
        billingStage: 'read_only',
        billingOverdueSince: isoDay(daysAgo(20)),
      }),
      spa('lotus', 'Lotus Garden Spa', 2, { status: 'trial' }),
      spa('jasmine', 'Jasmine Touch Massage Center', 400, { status: 'cancelled' }),
      spa('mainspa', 'Mainspa Deira', 500, { status: 'cancelled', deletedAt: daysAgo(1) }),
    ])
    .returning()
  const by = (key: string) => rows.find((r) => r.slug === `${tag}-${key}`)!
  const big = by('be-relax-massage-center-spa-jumeirah-lake-towers-cluster-x')
  const sub = (tenantId: string, planId: string, priceAed: string) => ({
    tenantId,
    planId,
    status: 'active' as const,
    priceAed,
    billingInterval: 'month' as const,
    currentPeriodStart: isoDay(daysAgo(10)),
    currentPeriodEnd: isoDay(daysAgo(-20)),
  })
  await db
    .insert(subscriptions)
    .values([
      sub(big.id, legacy!.id, '3000'),
      sub(by('al-noor').id, standard, '2000'),
      sub(by('serenity').id, premium, '3000'),
    ])
  // Worst case: five-digit bookings, > 10 GB of files, AI over budget.
  const [branch] = await db
    .insert(branches)
    .values({ tenantId: big.id, name: 'Main', isDefault: true })
    .returning()
  await db.execute(sql`insert into bookings (tenant_id, branch_id, ref_code, source, business_date, starts_at, ends_at,
      created_at)
    select ${big.id}, ${branch!.id}, 'FIT' || g, 'walk_in', current_date, now(), now(), now() - g * interval '1 minute'
    from generate_series(1, 12480) g`)
  await db
    .insert(storedFiles)
    .values(
      Array.from({ length: 7 }, () => ({ tenantId: big.id, contentType: 'video/mp4', size: 2_000_000_000 })),
    )
  await db
    .insert(aiUsage)
    .values({ tenantId: big.id, agentKey: 'receptionist', modelId: 'm', costUsd: '27.40' })
}

/** Names of the listed spas in their current order (table or cards, whichever is shown). */
const names = (page: Page) => page.locator('[data-testid="spa-list"] .tl-name:visible').allTextContents()
const sortLink = (page: Page, label: string) =>
  page.getByRole('link', {
    name: new RegExp(`^Sort by ${label.replace(/[()]/g, '\\$&')}( \\(sorted, .+\\))?$`),
  })

async function noSideScroll(page: Page, width: number) {
  await page.setViewportSize({ width, height: width < 768 ? 844 : 900 })
  await page.waitForTimeout(300)
  const m = await page.evaluate(() => {
    const card = document.querySelector<HTMLElement>('[data-testid="spa-list"]')!
    const overflowing = [...card.querySelectorAll<HTMLElement>('th, td, li, dd')].filter(
      (el) => el.offsetParent !== null && el.scrollWidth > el.clientWidth + 1,
    ).length
    const doc = document.documentElement
    return { doc: doc.scrollWidth - doc.clientWidth, card: card.scrollWidth - card.clientWidth, overflowing }
  })
  expect(m, `no sideways overflow at ${width} px`).toEqual({ doc: 0, card: 0, overflowing: 0 })
}

test('console spa list: one page at every width, every metric sortable', async ({ page }) => {
  test.setTimeout(180_000)
  const tag = uniqueSlug('fit')
  await seed(tag)
  await signInPlatformAdmin(page)
  const list = `${admin}/tenants?q=${tag}`

  await test.step('worst-case rows fit at 1024 / 1280 / 1440 / 1920 (table) and 768 / 390 / 360 (cards)', async () => {
    mkdirSync(SHOTS, { recursive: true })
    await page.goto(`${list}&sort=signin`)
    await expect(page.getByText('6 spas')).toBeVisible()
    for (const width of [1024, 1280, 1440, 1920, 768, 390, 360]) {
      await noSideScroll(page, width)
      const cards = width < 1024
      await expect(page.getByRole('table')).toBeVisible({ visible: !cards })
      if ([1024, 1280, 1440, 1920, 390].includes(width))
        await page.screenshot({ path: `${SHOTS}/spa-list-${width}.png`, fullPage: true })
    }
    // The whole list (every spa in the test database) fits too.
    await page.goto(`${admin}/tenants`)
    for (const width of [1024, 1440, 390]) await noSideScroll(page, width)
    await page.setViewportSize({ width: 1280, height: 900 })
  })

  await test.step('every figure is shown, incl. the billing-stage date, tier override and AI budget', async () => {
    await page.goto(list)
    const big = page.getByRole('row', { name: /Be Relax Massage Center Spa/ })
    await expect(big.locator('[data-key="bookings30"]')).toHaveText('12,480')
    await expect(big.locator('[data-key="storage"]')).toHaveText('13.04 GB')
    await expect(big.locator('[data-key="ai"]')).toHaveText('$27.40 / 25')
    await expect(big.locator('.tl-pct')).toHaveText(/^Over budget\s*110%$/)
    await expect(big.getByText('Premium monthly (legacy)').filter({ visible: true })).toBeVisible()
    await expect(big.getByText('Standard tier').filter({ visible: true })).toBeVisible()
    await expect(big.getByText('override').filter({ visible: true })).toBeVisible()
    await expect(big.getByText(/^Until /).filter({ visible: true })).toBeVisible()
    const alNoor = page.getByRole('row', { name: /Al Noor Thai/ })
    await expect(alNoor.getByText('past due')).toBeVisible()
    await expect(alNoor.getByText(/^Read-only from /)).toBeVisible()
    const serenity = page.getByRole('row', { name: /Serenity Hammam/ })
    await expect(serenity.getByText('read-only (billing)')).toBeVisible()
    await expect(serenity.getByText('Read-only until paid')).toBeVisible()
    await expect(page.getByRole('row', { name: /Mainspa Deira/ }).getByText('deleted')).toBeVisible()
  })

  await test.step('each header key sorts on the server; a second click flips; empty values last', async () => {
    const A = 'Al Noor Thai Wellness & Foot Reflexology Lounge'
    const B = 'Be Relax Massage Center Spa – Jumeirah Lake Towers Cluster X'
    const S = 'Serenity Hammam & Moroccan Bath – Dubai Marina Walk'
    const cases: [string, string, (n: string[]) => void][] = [
      ['Name', 'name', (n) => expect(n[0]).toBe(A)],
      ['Status', 'status', (n) => expect(n[0]).toBe(B)],
      ['Sign-in', 'signin', (n) => expect(n).toHaveLength(6)],
      ['Booking', 'booking', (n) => expect(n[0]).toBe(B)],
      ['Joined', 'joined', (n) => expect(n[0]).toBe('Lotus Garden Spa')],
      ['Bookings 30 d', 'bookings30', (n) => expect(n[0]).toBe(B)],
      ['Team', 'members', (n) => expect(n).toHaveLength(6)],
      ['Storage', 'storage', (n) => expect(n[0]).toBe(B)],
      ['AI this month', 'ai', (n) => expect(n[0]).toBe(B)],
      ['Plan', 'plan', (n) => expect(n.slice(0, 3)).toEqual([S, B, A])],
    ]
    await page.goto(list)
    for (const [label, key, check] of cases) {
      await sortLink(page, label).click()
      await expect(page).toHaveURL(new RegExp(`sort=${key}(&|$)`))
      await expect(sortLink(page, label)).toHaveAccessibleName(/\(sorted, /)
      await expect(page.locator('th[aria-sort]')).toHaveCount(1)
      check(await names(page))
    }
    // Plan, flipped: Z → A, and the three spas without a plan stay last.
    await sortLink(page, 'Plan').click()
    await expect(page).toHaveURL(/sort=plan&dir=desc/)
    expect(await names(page)).toEqual([
      A,
      B,
      S,
      'Jasmine Touch Massage Center',
      'Lotus Garden Spa',
      'Mainspa Deira',
    ])
    // Last booking ascending: the one spa with bookings first, empty values last.
    await page.goto(`${list}&sort=booking&dir=asc`)
    expect((await names(page))[0]).toBe(B)
  })

  await test.step('Sort by + direction controls (the only sort control on phones)', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(list)
    await page.getByLabel('Sort by').selectOption('storage')
    await page.getByRole('button', { name: 'Sort', exact: true }).click()
    await expect(page).toHaveURL(/sort=storage$/)
    expect((await names(page))[0]).toBe('Be Relax Massage Center Spa – Jumeirah Lake Towers Cluster X')
    await expect(page.getByRole('link', { name: /^Order: Highest first/ })).toBeVisible()
    await page.getByRole('link', { name: /^Order: Highest first/ }).click()
    await expect(page).toHaveURL(/sort=storage&dir=asc/)
    await expect(page.getByRole('link', { name: /^Order: Lowest first/ })).toBeVisible()
    // Search keeps the sort; old links (?sort=…&dir=…) keep working.
    await page.getByRole('searchbox', { name: /Search spas/ }).fill('lotus')
    await page.getByRole('searchbox', { name: /Search spas/ }).press('Enter')
    await expect(page).toHaveURL(/sort=storage&dir=asc&q=lotus|q=lotus.*sort=storage/)
    expect(await names(page)).toEqual(['Lotus Garden Spa'])
  })
})
