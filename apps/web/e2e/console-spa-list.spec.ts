import { mkdirSync } from 'node:fs'
import { expect, type Page, test } from '@playwright/test'
import {
  aiUsage,
  auditLog,
  branches,
  members,
  plans,
  roles,
  storedFiles,
  subscriptions,
  tenants,
  user,
} from '@spa/db'
import { eq, sql } from 'drizzle-orm'
import { admin, planIdOf, signInPlatformAdmin, testDb, uniqueSlug } from './helpers'

// F21 console spa list (owner 2026-10-10: "all data in one page without go left/right", then "what is this mess …
// remove the big box, just make the side bar till end of the page"): a flat table with one value per cell and one
// header line per column, no sideways scroll at any width, every server sort key still reachable, and the console
// sidebar running the full page height.
const SHOTS = process.env.E2E_SHOTS_DIR ?? 'test-results/screens'
const MIN = 60_000
const HOUR = 60
const DAY = 1440
const MB = 1024 ** 2
const GB = 1024 ** 3
const ago = (minutes: number) => new Date(Date.now() - minutes * MIN)
const daysAgo = (n: number) => ago(n * DAY)
const isoDay = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' })

/** The six worst-case spas the sort checks below are written against (searched by `tag`). */
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

type Fill = {
  key: string
  name: string
  joined: number // days ago
  status?: 'active' | 'trial' | 'past_due' | 'read_only' | 'cancelled'
  plan?: 'premium' | 'standard' | 'yearly'
  ends?: number // current period ends in … days
  extra?: Partial<typeof tenants.$inferInsert>
  team?: number
  signin?: number // newest staff sign-in, minutes ago
  bookings?: number // in the last 30 days
  booked?: number // newest booking, minutes ago
  storage?: number
  ai?: string
}

/** Ten everyday spas (searched by their own tag), so the full list is longer than the screen. */
async function fill(tag: string) {
  const db = testDb()
  const [premiumPlan] = await db.select({ limits: plans.limits }).from(plans).where(eq(plans.code, 'premium'))
  const [yearly] = await db
    .insert(plans)
    .values({
      code: `${tag}-yearly`,
      name: 'Yearly (legacy)',
      priceAed: '24000',
      billingInterval: 'year',
      active: false,
      limits: premiumPlan!.limits,
    })
    .returning()
  const planIds = {
    premium: await planIdOf('premium'),
    standard: await planIdOf('standard'),
    yearly: yearly!.id,
  }
  const spas: Fill[] = [
    {
      key: 'palm',
      name: 'Palm Jumeirah Wellness Retreat',
      joined: 343,
      plan: 'premium',
      ends: 18,
      extra: { aiBudgetUsd: '100' },
      team: 31,
      signin: 39 * HOUR,
      bookings: 3912,
      booked: 2 * HOUR,
      storage: 9.2 * GB,
      ai: '41.75',
    },
    {
      key: 'oud',
      name: 'Oud & Amber Hammam',
      joined: 144,
      plan: 'premium',
      ends: 21,
      team: 17,
      signin: 12,
      bookings: 2046,
      booked: 40,
      storage: 5.61 * GB,
      ai: '19.10',
    },
    {
      key: 'hatta',
      name: 'Hatta Mountain Spa & Sauna',
      joined: 370,
      plan: 'standard',
      ends: 26,
      team: 2,
      signin: 21 * DAY,
      booked: 34 * DAY,
      storage: 96 * MB,
    },
    {
      key: 'pearl',
      name: 'The Pearl Spa – Abu Dhabi Corniche',
      joined: 384,
      plan: 'standard',
      ends: 52,
      extra: { featureTier: 'premium', aiBudgetUsd: '50' },
      team: 11,
      signin: 24 * HOUR,
      bookings: 744,
      booked: 3 * HOUR,
      storage: 1.9 * GB,
      ai: '2.15',
    },
    {
      key: 'zen',
      name: 'Zen Garden Thai Massage – Al Karama',
      joined: 68,
      status: 'past_due',
      plan: 'standard',
      ends: 9,
      extra: { billingStage: 'grace', billingOverdueSince: isoDay(daysAgo(6)) },
      team: 4,
      signin: 2 * DAY,
      bookings: 96,
      booked: 5 * DAY,
      storage: 640 * MB,
    },
    {
      key: 'coral',
      name: 'Fujairah Coral Beach Spa',
      joined: 72,
      status: 'read_only',
      plan: 'premium',
      ends: 39,
      team: 7,
      signin: 9 * DAY,
      bookings: 31,
      booked: 12 * DAY,
      storage: 880 * MB,
      ai: '0.08',
    },
    {
      key: 'kerala',
      name: 'Kerala Ayurveda Wellness Centre – International City',
      joined: 3,
      status: 'trial',
      team: 1,
    },
    {
      key: 'sukhumvit',
      name: 'Sukhumvit Thai Spa – Business Bay',
      joined: 26,
      plan: 'standard',
      ends: 35,
      team: 5,
      signin: 39 * HOUR,
      bookings: 214,
      booked: 2 * HOUR,
      storage: 412 * MB,
    },
    {
      key: 'bali',
      name: 'Bali Breeze Day Spa – Mirdif City Centre',
      joined: 238,
      plan: 'yearly',
      ends: 127,
      team: 9,
      signin: 4 * DAY,
      bookings: 518,
      booked: 24 * HOUR,
      storage: 2.31 * GB,
      ai: '6.80',
    },
    {
      key: 'sharjah',
      name: 'Sharjah Ladies Massage & Beauty Lounge – Al Majaz Waterfront',
      joined: 646,
      status: 'cancelled',
      plan: 'standard',
      ends: -101,
      team: 2,
      signin: 122 * DAY,
      booked: 125 * DAY,
      storage: 3.4 * GB,
    },
  ]
  const rows = await db
    .insert(tenants)
    .values(
      spas.map((s) => ({
        slug: `${tag}-${s.key}`,
        name: s.name,
        createdAt: daysAgo(s.joined),
        status: s.status ?? 'active',
        ...s.extra,
      })),
    )
    .returning()
  for (const [i, s] of spas.entries()) {
    const t = rows[i]!
    if (s.plan)
      await db.insert(subscriptions).values({
        tenantId: t.id,
        planId: planIds[s.plan],
        status: 'active',
        priceAed: '2000',
        billingInterval: 'month',
        currentPeriodStart: isoDay(daysAgo(30 - (s.ends ?? 0))),
        currentPeriodEnd: isoDay(daysAgo(-(s.ends ?? 0))),
      })
    if (s.team) {
      const [role] = await db
        .insert(roles)
        .values({ tenantId: t.id, key: 'staff', name: 'Staff' })
        .returning()
      const people = Array.from({ length: s.team }, (_, n) => ({
        id: `${t.slug}-${n}`,
        name: `Staff ${n}`,
        email: `${t.slug}-${n}@e2e.test`,
        lastSignInAt: s.signin !== undefined && n === 0 ? ago(s.signin) : null,
      }))
      await db.insert(user).values(people)
      await db.insert(members).values(people.map((p) => ({ tenantId: t.id, userId: p.id, roleId: role!.id })))
    }
    if (s.booked !== undefined) {
      const [branch] = await db
        .insert(branches)
        .values({ tenantId: t.id, name: 'Main', isDefault: true })
        .returning()
      const n = s.bookings || 1
      const step = s.bookings ? Math.floor((30 * DAY - s.booked - 60) / n) : 0
      await db.execute(sql`insert into bookings (tenant_id, branch_id, ref_code, source, business_date, starts_at,
          ends_at, created_at)
        select ${t.id}, ${branch!.id}, 'F' || g, 'walk_in', current_date, now(), now(),
          now() - (${s.booked} + g * ${step}) * interval '1 minute'
        from generate_series(0, ${n - 1}) g`)
    }
    if (s.storage) {
      const chunks = Array.from({ length: Math.ceil(s.storage / 2e9) }, (_, n) =>
        Math.round(Math.min(2e9, s.storage! - n * 2e9)),
      )
      await db
        .insert(storedFiles)
        .values(chunks.map((size) => ({ tenantId: t.id, contentType: 'image/jpeg', size })))
    }
    if (s.ai)
      await db
        .insert(aiUsage)
        .values({ tenantId: t.id, agentKey: 'receptionist', modelId: 'm', costUsd: s.ai })
  }
}

/** Names of the listed spas in their current order (table or cards, whichever is shown). */
const names = (page: Page) => page.locator('[data-testid="spa-list"] .sl-name:visible').allTextContents()
const sortLink = (page: Page, label: string) =>
  page.getByRole('link', {
    name: new RegExp(`^Sort by ${label.replace(/[()]/g, '\\$&')}( \\(sorted, .+\\))?$`),
  })

/** The sorted header's arrow never touches a header label (its own or a neighbour's): text rects, 2 px clearance. */
const arrowClash = (page: Page) =>
  page.evaluate(() => {
    const arrow = document
      .querySelector('.sl-table thead .sl-sort[data-on] .sl-arrow')
      ?.getBoundingClientRect()
    if (!arrow) return 'no arrow'
    for (const link of document.querySelectorAll('.sl-table thead .sl-sort'))
      for (const node of link.childNodes) {
        if (node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim()) continue
        const range = document.createRange()
        range.selectNodeContents(node)
        const t = range.getBoundingClientRect()
        if (
          arrow.left < t.right + 2 &&
          arrow.right > t.left - 2 &&
          arrow.top < t.bottom &&
          arrow.bottom > t.top
        )
          return node.textContent
      }
    return null
  })

async function noSideScroll(page: Page, width: number) {
  await page.setViewportSize({ width, height: width < 768 ? 844 : 900 })
  await page.waitForTimeout(300)
  const m = await page.evaluate(() => {
    const list = document.querySelector<HTMLElement>('[data-testid="spa-list"]')!
    const overflowing = [...list.querySelectorAll<HTMLElement>('th, td, li, dd')]
      .filter((el) => el.offsetParent !== null && el.scrollWidth > el.clientWidth + 1)
      .map((el) => el.textContent?.slice(0, 40))
    const doc = document.documentElement
    return { doc: doc.scrollWidth - doc.clientWidth, list: list.scrollWidth - list.clientWidth, overflowing }
  })
  expect(m, `no sideways overflow at ${width} px`).toEqual({ doc: 0, list: 0, overflowing: [] })
}

test('console spa list: flat table on one page at every width, every metric sortable', async ({ page }) => {
  test.setTimeout(240_000)
  const tag = uniqueSlug('fit')
  const filled = uniqueSlug('fil')
  await seed(tag)
  await fill(filled)
  await signInPlatformAdmin(page)
  const list = `${admin}/tenants?q=${tag}`

  await test.step('worst-case rows fit: table at 1000 (icon rail) / 1280 / 1440 / 1920, cards at 1024 / 900 / 768 / 390 / 360', async () => {
    await page.goto(`${list}&sort=signin`)
    await expect(page.getByText('6 spas')).toBeVisible()
    for (const width of [1000, 1280, 1440, 1920, 1024, 900, 768, 390, 360]) {
      await noSideScroll(page, width)
      await expect(page.getByRole('table')).toBeVisible({ visible: [1000, 1280, 1440, 1920].includes(width) })
    }
    // Each spa's name heads its row (screen readers name the spa when moving down a column).
    await page.setViewportSize({ width: 1280, height: 900 })
    await expect(page.getByRole('rowheader')).toHaveCount(6)
    await expect(page.getByRole('rowheader', { name: /^Lotus Garden Spa/ })).toBeVisible()
  })

  await test.step('the whole (long) list: no sideways scroll, sidebar as tall as the page, nav stays in view', async () => {
    mkdirSync(SHOTS, { recursive: true })
    await page.goto(`${admin}/tenants`)
    for (const width of [1920, 1440, 1280, 1024, 900, 390]) {
      await noSideScroll(page, width)
      await page.mouse.move(width - 2, 2) // no hover band in the shots
      await page.screenshot({ path: `${SHOTS}/spa-list-${width}.png`, fullPage: true })
      if (width < 768) continue
      const side = await page.evaluate(() => {
        const aside = document.querySelector('aside')!.getBoundingClientRect()
        return {
          bottom: aside.bottom + window.scrollY,
          page: document.documentElement.scrollHeight,
          screen: window.innerHeight,
          gutter: getComputedStyle(document.querySelector('main')!).paddingInlineStart,
        }
      })
      expect(side.page, `the list is longer than the screen at ${width} px`).toBeGreaterThan(side.screen)
      // 32 px page gutter until 1440 px (the list keeps its room at 1280), 48 px from 1440.
      expect(side.gutter, `page gutter at ${width} px`).toBe(width >= 1440 ? '48px' : '32px')
      expect(side.bottom, `sidebar reaches the page bottom at ${width} px`).toBeGreaterThanOrEqual(
        side.page - 1,
      )
    }
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    // Sticky inner sidebar panel + sticky header row.
    await expect(page.getByRole('link', { name: 'Audit log' })).toBeInViewport()
    await expect(page.locator('.sl-table thead th').first()).toBeInViewport()
    await page.mouse.move(1438, 2)
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${SHOTS}/spa-list-1440-scrolled.png` })
    // Tier tag only where the plan name doesn't say it; a super-admin override shows the tier it sets.
    await expect(page.getByRole('row', { name: /Bali Breeze/ }).locator('.sl-tag')).toHaveText('Premium tier')
    await expect(page.getByRole('row', { name: /Palm Jumeirah/ }).locator('.sl-tag')).toHaveCount(0)
    await expect(page.getByRole('row', { name: /The Pearl Spa/ }).locator('.sl-tag')).toHaveText(
      '→ Premium tier (override)',
    )
    // The sidebar runs the page height on other long console pages too (same shell). Enough audit rows that the
    // log is longer than the screen even when this spec runs alone.
    await testDb()
      .insert(auditLog)
      .values(
        Array.from({ length: 20 }, (_, n) => ({
          action: 'e2e.sidebar.check',
          entity: 'e2e',
          entityId: `${n}`,
        })),
      )
    for (const [path, shot] of [
      ['/', 'overview-1440'],
      ['/audit', 'audit-1440'],
    ]) {
      await page.goto(`${admin}${path}`)
      const other = await page.evaluate(() => ({
        bottom: document.querySelector('aside')!.getBoundingClientRect().bottom + window.scrollY,
        page: document.documentElement.scrollHeight,
        screen: window.innerHeight,
      }))
      expect(other.page, `${path} is longer than the screen`).toBeGreaterThan(other.screen)
      expect(other.bottom, `sidebar reaches the bottom of ${path}`).toBeGreaterThanOrEqual(other.page - 1)
      await page.mouse.move(1438, 2)
      await page.screenshot({ path: `${SHOTS}/${shot}.png`, fullPage: true })
    }
    // The full sidebar (logo, labels, user name) still starts at 1024 px; the icon rail only below.
    await page.setViewportSize({ width: 1024, height: 768 })
    await expect(page.locator('aside').getByText('Audit log')).toBeVisible()
    await expect(page.locator('aside').getByText('Platform Admin')).toBeVisible()
    await page.setViewportSize({ width: 1000, height: 768 })
    await expect(page.locator('aside').getByText('Audit log')).toBeHidden()
    await expect(page.locator('aside').getByRole('link', { name: 'Audit log' })).toBeVisible()
  })

  await test.step('one line per spa at ≥ 1280 px for a normal-length name (plus the address line)', async () => {
    await page.goto(`${admin}/tenants?q=${filled}`)
    for (const width of [1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 })
      for (const spa of [
        'Oud & Amber Hammam',
        'Sukhumvit Thai Spa – Business Bay',
        'The Pearl Spa – Abu Dhabi Corniche',
        'Palm Jumeirah Wellness Retreat',
      ]) {
        const row = page.getByRole('row', { name: new RegExp(`^${spa}`) })
        const name = await row.locator('.sl-name').boundingBox()
        expect(name!.height, `${spa}: name on one line at ${width} px`).toBeLessThanOrEqual(22)
        // The Pearl's plan cell carries the override tag line, so only its name is checked.
        if (spa.startsWith('The Pearl')) continue
        const box = await row.boundingBox()
        expect(box!.height, `${spa}: two-line row at ${width} px`).toBeLessThanOrEqual(64)
      }
    }
    // Grace shows its stage on screen too, and when the spa turns read-only.
    await expect(page.getByRole('row', { name: /^Zen Garden/ }).locator('.sl-billing')).toHaveText(
      /^Grace · read-only from \d{1,2} [A-Z][a-z]{2}( \d{4})?$/,
    )
    // Past 60 days the activity columns show the date; the title has the full Dubai date + time.
    const sharjah = page.getByRole('row', { name: /^Sharjah Ladies/ }).locator('[data-key="signin"]')
    await expect(sharjah).toHaveText(/^(\d{1,2} [A-Z][a-z]{2}|[A-Z][a-z]{2} \d{4})$/)
    await expect(sharjah).toHaveAttribute('title', /^\d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2}$/)
  })

  await test.step('Shift+Tab never leaves the focused spa link under the sticky header row', async () => {
    await page.setViewportSize({ width: 1280, height: 600 })
    await page.goto(list)
    const links = page.locator('.sl-table .sl-name')
    const head = page.locator('.sl-table thead th').first()
    // Second spa name just inside the top of the viewport (under the header); focus the third, then Shift+Tab.
    await links.nth(1).evaluate((el) => window.scrollBy(0, el.getBoundingClientRect().top - 20))
    await links.nth(2).evaluate((el) => (el as HTMLElement).focus({ preventScroll: true }))
    await page.keyboard.press('Shift+Tab')
    await expect(links.nth(1)).toBeFocused()
    const top = (await links.nth(1).boundingBox())!.y
    const headBox = (await head.boundingBox())!
    expect(top).toBeGreaterThanOrEqual(headBox.y + headBox.height)
    const pad = await page.evaluate(() =>
      Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop),
    )
    expect(headBox.height + 8, 'scroll padding clears the header row').toBeLessThanOrEqual(pad)
    await page.setViewportSize({ width: 1280, height: 900 })
  })

  await test.step('every figure is shown, incl. the billing note, tier override and AI budget', async () => {
    await page.goto(list)
    const big = page.getByRole('row', { name: /Be Relax Massage Center Spa/ })
    await expect(big.locator('[data-key="bookings30"]')).toHaveText('12,480')
    await expect(big.locator('[data-key="storage"]')).toHaveText('13.04 GB')
    await expect(big.locator('[data-key="ai"]')).toHaveText('$27.40 / 25')
    await expect(big.locator('.sl-share')).toHaveText('110% of budget (over budget)')
    await expect(big.locator('.sl-share')).toBeVisible()
    await expect(big.getByText('Premium monthly (legacy)')).toBeVisible()
    await expect(big.locator('.sl-tag')).toHaveText('→ Standard tier (override)')
    await expect(big.locator('.sl-tag')).toBeVisible()
    await expect(big.getByText(/^until /)).toBeVisible()
    await expect(big.locator('[data-key="joined"]')).toBeVisible()
    const alNoor = page.getByRole('row', { name: /Al Noor Thai/ })
    await expect(alNoor.getByText('past due')).toBeVisible()
    await expect(alNoor.locator('.sl-billing')).toHaveText(
      /^Overdue · read-only from \d{1,2} [A-Z][a-z]{2}( \d{4})?$/,
    )
    await expect(alNoor.locator('.sl-billing')).toHaveAttribute('title', /^Invoice overdue: read-only from /)
    // Dormancy: no sign-in / booking ever counts from joining — amber 200 d in, neutral for a 2-day-old trial.
    await expect(alNoor.locator('[data-key="signin"]')).toHaveText('never')
    await expect(alNoor.locator('[data-key="signin"]')).toHaveClass(/sl-stale/)
    await expect(alNoor.locator('[data-key="booking"]')).toHaveClass(/sl-stale/)
    const lotus = page.getByRole('row', { name: /Lotus Garden Spa/ }).locator('[data-key="signin"]')
    await expect(lotus).toHaveText('never')
    await expect(lotus).not.toHaveClass(/sl-stale/)
    await expect(big.locator('[data-key="booking"]')).not.toHaveClass(/sl-stale/)
    const serenity = page.getByRole('row', { name: /Serenity Hammam/ })
    await expect(serenity.getByText('paused')).toBeVisible()
    await expect(serenity.getByText('Read-only until paid')).toBeVisible()
    await expect(page.getByRole('row', { name: /Mainspa Deira/ }).getByText('deleted')).toBeVisible()
  })

  await test.step('each header sorts on the server; a second click flips; empty values last', async () => {
    const A = 'Al Noor Thai Wellness & Foot Reflexology Lounge'
    const B = 'Be Relax Massage Center Spa – Jumeirah Lake Towers Cluster X'
    const S = 'Serenity Hammam & Moroccan Bath – Dubai Marina Walk'
    const cases: [string, string, (n: string[]) => void][] = [
      ['Spa', 'name', (n) => expect(n[0]).toBe(A)],
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
    await page.setViewportSize({ width: 1280, height: 900 }) // tight columns: the arrows have the least room
    await page.goto(`${list}&sort=signin`)
    for (const [label, key, check] of cases) {
      await sortLink(page, label).click()
      await expect(page).toHaveURL(new RegExp(`sort=${key}(&|$)`))
      await expect(sortLink(page, label)).toHaveAccessibleName(/\(sorted, /)
      await expect(page.locator('th[aria-sort]')).toHaveCount(1)
      check(await names(page))
      expect(await arrowClash(page), `${label}: arrow clear of every header label`).toBeNull()
      if (key === 'members') {
        await page.mouse.move(1278, 2)
        await page.screenshot({
          path: `${SHOTS}/spa-list-1280-team.png`,
          clip: { x: 0, y: 0, width: 1280, height: 420 },
        })
      }
    }
    // Plan, flipped: Z → A, and the three spas without a plan stay last.
    await sortLink(page, 'Plan').click()
    await expect(page).toHaveURL(/sort=plan&dir=desc/)
    await expect(page.locator('th[aria-sort="descending"]')).toHaveCount(1)
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

  await test.step('Sort by + direction controls (the only sort control with the cards)', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(list)
    // Looks like a dropdown: chevron image and the control background (not see-through).
    const look = await page
      .getByLabel('Sort by')
      .evaluate((el) => [getComputedStyle(el).backgroundImage, getComputedStyle(el).backgroundColor])
    expect(look[0]).toContain('data:image/svg+xml')
    expect(look[1]).not.toBe('rgba(0, 0, 0, 0)')
    await page.getByLabel('Sort by').selectOption('storage')
    await page.getByRole('button', { name: 'Sort', exact: true }).click()
    await expect(page).toHaveURL(/sort=storage$/)
    expect((await names(page))[0]).toBe('Be Relax Massage Center Spa – Jumeirah Lake Towers Cluster X')
    await expect(page.getByRole('link', { name: /^Order: Highest first/ })).toBeVisible()
    await page.getByRole('link', { name: /^Order: Highest first/ }).click()
    await expect(page).toHaveURL(/sort=storage&dir=asc/)
    await expect(page.getByRole('link', { name: /^Order: Lowest first/ })).toBeVisible()
    // Search keeps the sort; old links (?sort=…&dir=…) keep working.
    // Tagged slug, so tenants named "Lotus …" from other specs (or a repeat run) can't match.
    await page.getByRole('searchbox', { name: /Search spas/ }).fill(`${tag}-lotus`)
    await page.getByRole('searchbox', { name: /Search spas/ }).press('Enter')
    await expect(page).toHaveURL(
      new RegExp(`sort=storage&dir=asc&q=${tag}-lotus|q=${tag}-lotus.*sort=storage`),
    )
    expect(await names(page)).toEqual(['Lotus Garden Spa'])
    // What the columns count: a visible disclosure under the list, on cards and table alike (no hover needed).
    await expect(page.locator('.sl-legend')).not.toContainText('Hover')
    await expect(page.locator('.sl-legend')).toContainText('counted from joining')
    const defs = page.getByText('What the columns count')
    await defs.click()
    await expect(page.getByText('Active team members')).toBeVisible()
    // On desktop the table headers are the sort control; the select is hidden.
    await page.setViewportSize({ width: 1280, height: 900 })
    await expect(page.getByLabel('Sort by')).toBeHidden()
    await expect(defs).toBeVisible()
    await page.mouse.move(1278, 2)
    await page.locator('[data-testid="spa-list"]').screenshot({ path: `${SHOTS}/spa-list-defs-1280.png` })
  })
})
