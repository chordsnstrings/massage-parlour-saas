import { expect, type Page, test } from '@playwright/test'
import { auditLog, plans, spaApplications, subscriptions, tenants, user } from '@spa/db'
import { and, eq, inArray, isNull, ne } from 'drizzle-orm'
import {
  admin,
  app,
  applyForSpa,
  base,
  planIdOf,
  signInPlatformAdmin,
  signUpOwner,
  testDb,
  uniqueSlug,
} from './helpers'

// Plans + entitlements (PLAN §18.8, owner 2026-10-09): Premium (setup AED 14,000 + AED 3,000/month) and Standard
// (setup AED 9,000 + AED 2,000/month, no AI / marketing / extra branches), excl. VAT. Pricing page with a comparison
// generated from the core feature list; a Standard spa's menu leaves the Premium pages out and shows "Available on
// Premium" when one is opened directly; the super-admin's "Grant Premium features" switches them on; per-spa
// discounts show on the setup invoice issued at acceptance.

test('pricing: Premium and Standard with setup + monthly prices and the comparison', async ({ page }) => {
  await page.goto(`${base}/pricing`)
  await expect(page.getByRole('heading', { name: 'Pick your plan. We handle the rest.' })).toBeVisible()
  const premium = page.getByTestId('plan-card-premium')
  const standard = page.getByTestId('plan-card-standard')
  await expect(premium).toContainText(/AED\s?3,000\s?\/ month/)
  await expect(premium).toContainText(/one-time setup AED\s?14,000/)
  await expect(premium).toContainText('Excl. VAT')
  await expect(standard).toContainText(/AED\s?2,000\s?\/ month/)
  await expect(standard).toContainText(/one-time setup AED\s?9,000/)
  await expect(standard).toContainText('One branch')
  await expect(page.getByText(/24,000/)).toHaveCount(0)

  const table = page.getByTestId('plan-compare')
  const row = (name: RegExp) => table.getByRole('row', { name })
  const yes = '[aria-label="Included"]'
  const no = '[aria-label="Not included"]'
  // Gated rows: Premium only. Everything else: on both plans (Standard keeps the whole CRM).
  for (const name of [/AI receptionist/, /Campaigns/, /More than one branch/]) {
    await expect(row(name).locator(yes)).toHaveCount(1)
    await expect(row(name).locator(no)).toHaveCount(1)
  }
  for (const name of [/Point of sale/, /Online booking/, /payroll/]) {
    await expect(row(name).locator(yes)).toHaveCount(2)
  }
  await expect(page.getByText('I am already a customer on the yearly plan. What changes?')).toBeVisible()

  // Each card applies for its own plan: the form opens with it preselected.
  await standard.getByRole('link', { name: 'Apply for Standard' }).click()
  await page.waitForURL(/\/signup\?plan=standard$/)
  await expect(page.getByLabel('Plan')).toHaveValue(await planIdOf('standard'))
  await expect(page.getByLabel('Plan').locator('option:checked')).toHaveText(
    /^Standard · setup fee AED\s?9,000 \+ AED\s?2,000 \/ month · excl\. VAT$/,
  )
  await expect(page.getByLabel('Plan').locator('option', { hasText: /legacy/i })).toHaveCount(0)
})

test('a Standard spa: no AI, marketing or branches until the super-admin grants Premium', async ({
  page,
  browser,
}) => {
  const { slug, dashboard } = await signUpOwner(page, { spa: 'Standard Spa', plan: 'standard' })
  const menu = page.getByRole('navigation', { name: 'Main menu' })
  const tabs = page.getByRole('navigation', { name: 'Pages in this section' })
  const settingsTabs = page.getByRole('navigation', { name: 'Settings sections' })

  await test.step('the menu leaves the Premium pages out', async () => {
    await expect(menu.getByRole('link', { name: 'Calendar', exact: true })).toBeVisible()
    await expect(menu.getByRole('link', { name: 'Reviews', exact: true })).toHaveCount(0)
    await expect(page.getByText(/AI allowance/)).toHaveCount(0)
    await expect(page.getByText(/^Renews .* · AED\s?2,000\/mo$/)).toBeVisible()
    // Inbox keeps WhatsApp + Enquiries (website enquiry form, every plan — F15), no Instagram or Campaigns;
    // Marketing keeps only Analytics: one page, so no section tabs.
    await page.goto(`${dashboard}/messages`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(menu.getByRole('link', { name: 'Inbox & follow-ups', exact: true })).toBeVisible()
    await expect(tabs.getByRole('link')).toHaveText(['WhatsApp', 'Enquiries'])
    await page.goto(`${dashboard}/analytics`)
    await expect(menu.getByRole('link', { name: 'Marketing', exact: true })).toBeVisible()
    await expect(tabs).toHaveCount(0)
    await page.goto(`${dashboard}/settings`)
    await expect(settingsTabs.getByRole('link', { name: 'Spa profile' })).toBeVisible()
    await expect(settingsTabs.getByRole('link', { name: 'Branches' })).toHaveCount(0)
  })

  await test.step('opened directly, each shows "Available on Premium"', async () => {
    for (const path of [
      '/campaigns',
      '/inbox',
      '/ai',
      '/ai/try',
      '/ai/content',
      '/ai/reviews',
      '/settings/branches',
    ]) {
      await page.goto(`${dashboard}${path}`)
      await expect(page.getByTestId('plan-upsell'), path).toContainText('Available on Premium')
    }
    await expect(page.getByTestId('plan-upsell')).toContainText('More branches is part of Premium')
    await page.goto(`${dashboard}/automations`)
    // Gated automations never run on Standard: shown with a Premium pill instead of a switch.
    await expect(page.getByRole('switch', { name: /Quiet-slot offers/ })).toHaveCount(0)
    await expect(page.getByRole('switch', { name: /Booking confirmations/ })).toHaveCount(1)
    await page.goto(`${dashboard}/billing`)
    await expect(
      page.getByText('Premium adds AI & Instagram automation, marketing tools and more branches'),
    ).toBeVisible()
    await expect(page.getByText(/AED\s?2,000/).first()).toBeVisible()
  })

  await test.step('in Thai too', async () => {
    await page.goto(`${dashboard}/campaigns`)
    await page.getByRole('button', { name: 'ไทย' }).click()
    await expect(page.getByTestId('plan-upsell')).toContainText('มีในแพ็กเกจ Premium')
    await page.getByRole('button', { name: 'EN' }).click()
    await expect(page.getByTestId('plan-upsell')).toContainText('Available on Premium')
  })

  await test.step('the super-admin grants Premium features (audited)', async () => {
    const ctx = await browser.newContext()
    const ops = await ctx.newPage()
    await signInPlatformAdmin(ops)
    const [t] = await testDb().select().from(tenants).where(eq(tenants.slug, slug))
    await ops.goto(`${admin}/tenants/${t!.id}`)
    await expect(ops.getByTestId('plan-card')).toContainText('Standard')
    await expect(ops.getByTestId('plan-features')).toContainText('Core only')
    await ops.getByLabel('Feature tier').selectOption('premium')
    await ops.getByRole('button', { name: 'Save feature tier' }).click()
    await expect(ops.getByTestId('tier-override')).toHaveText('Premium features granted')
    await expect(ops.getByTestId('plan-features')).toContainText('AI & Instagram automation')
    const [row] = await testDb()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.tenantId, t!.id), eq(auditLog.action, 'platform.tenant.feature_tier')))
    expect(row?.data).toEqual({ from: null, to: 'premium' })
    await ctx.close()
  })

  await test.step('the Premium pages appear', async () => {
    await page.goto(`${dashboard}/campaigns`)
    await expect(page.getByRole('heading', { name: 'Campaigns', exact: true })).toBeVisible()
    await expect(page.getByTestId('plan-upsell')).toHaveCount(0)
    await expect(menu.getByRole('link', { name: 'Reviews', exact: true })).toBeVisible()
    await expect(tabs.getByRole('link')).toHaveText(['WhatsApp', 'Instagram', 'Campaigns', 'Enquiries'])
    await page.goto(`${dashboard}/analytics`)
    await expect(tabs.getByRole('link', { name: 'Social posts' })).toBeVisible()
    await expect(tabs.getByRole('link', { name: 'AI studio' })).toBeVisible()
    await page.goto(`${dashboard}/settings/branches`)
    await expect(page.getByRole('heading', { name: 'Branches', level: 1 })).toBeVisible()
    await expect(settingsTabs.getByRole('link', { name: 'Branches' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add branch' })).toBeVisible()
  })
})

test('discounts set at acceptance show on the setup invoice and the monthly invoices', async ({
  page,
  browser,
}) => {
  const slug = uniqueSlug('disc')
  const email = `owner-${slug}@e2e.test`
  await applyForSpa(page, { slug, email, spa: 'Discount Spa', planId: await planIdOf('premium') })
  const [application] = await testDb().select().from(spaApplications).where(eq(spaApplications.email, email))

  const ctx = await browser.newContext()
  const ops = await ctx.newPage()
  await signInPlatformAdmin(ops)
  await ops.goto(`${admin}/applications/${application!.id}`)
  await ops.getByRole('button', { name: 'Accept', exact: true }).click()
  await expect(ops.getByLabel('Plan')).toHaveValue(await planIdOf('premium'))
  // Only the offered plans (Premium, Standard + any custom active plan), never the legacy yearly plan.
  await expect(ops.getByLabel('Plan').locator('option', { hasText: 'legacy' })).toHaveCount(0)
  const fee = ops.getByTestId('setup-fee')
  await expect(fee).toContainText(/Setup fee AED\s14,000 · invoice total AED\s14,700 \(incl\. VAT\)/)
  await ops.getByLabel('Setup fee discount: type').selectOption('percent')
  await ops.getByLabel('Setup fee discount: value').fill('10')
  await expect(fee).toContainText(/− discount AED\s1,400 = AED\s12,600/)
  await expect(fee).toContainText(/invoice total AED\s13,230 \(incl\. VAT\)/)
  await ops.getByLabel('Monthly fee discount: type').selectOption('amount')
  await ops.getByLabel('Monthly fee discount: value').fill('500')
  await expect(ops.getByTestId('monthly-fee')).toContainText(/= AED\s2,500 per month/)
  await ops.getByRole('button', { name: 'Accept and create spa' }).click()
  await expect(
    ops.getByText(/Discount Spa is live · invoice \S+ paid · 12 subscription invoices/),
  ).toBeVisible()
  await expect(ops.getByTestId('setup-payment')).toContainText(/discount 10% \(−AED\s1,400\)/)

  await ops.getByRole('link', { name: 'Open the spa' }).click()
  const setup = ops.getByRole('row', { name: /One-time setup fee/ })
  await expect(setup).toContainText('discount 10%')
  await expect(setup.getByTestId('invoice-discount')).toContainText(
    /list AED\s14,000 · discount 10% −AED\s1,400/,
  )
  await expect(setup).toContainText(/AED\s13,230/)
  const month1 = ops.getByRole('row', { name: /month 1 of 12/ })
  await expect(month1.getByTestId('invoice-discount')).toContainText(
    /list AED\s3,000 · discount AED 500\.00 −AED\s500/,
  )
  await expect(month1).toContainText(/AED\s2,625/) // 2,500 + 5 % VAT
  // The discounts stay on the spa (Plan & features), audited with the acceptance.
  await expect(ops.getByLabel('Setup fee discount: value')).toHaveValue('10')
  await expect(ops.getByLabel('Monthly fee discount: value')).toHaveValue('500')
  const [t] = await testDb().select().from(tenants).where(eq(tenants.slug, slug))
  const [accepted] = await testDb()
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.tenantId, t!.id), eq(auditLog.action, 'platform.application.accepted')))
  expect((accepted!.data as { discounts?: unknown }).discounts).toEqual({
    setup: { kind: 'percent', value: '10.00' },
    monthly: { kind: 'amount', value: '500.00' },
  })
  await ctx.close()
})

// R19 (owner 2026-10-10): Delete on Console → Plans & prices. An unused plan is deleted; a plan a spa is on is
// archived — off Plans & prices, /pricing and sign-up, still named on the spa's row in Console → Spas — and can be
// restored (hidden until edited); a built-in plan, or one only a past application chose, is archived too; the last
// plan new spas can get is refused. Cards are found by their unique names.
const SHOTS = process.env.E2E_SHOTS_DIR ?? 'test-results/screens'
/** Desktop + 390 px screenshots of the current state (an open sheet stays open across the resize). */
async function shot(page: Page, file: string, fullPage = true) {
  for (const [width, height] of [
    [1280, 800],
    [390, 844],
  ] as const) {
    await page.setViewportSize({ width, height })
    await page.waitForTimeout(400) // the sheet / grid settles after the resize
    await page.screenshot({ path: `${SHOTS}/plans-${file}-${width}.png`, fullPage })
  }
  await page.setViewportSize({ width: 1280, height: 800 })
}

test('console: delete an unused plan, archive a used one and restore it; the last offered plan stays', async ({
  page,
  browser,
}) => {
  const tag = uniqueSlug('r19')
  const db = testDb()
  const name = (k: string) => `R19 ${k} ${tag}`
  const [unused, used, only, applied] = await db
    .insert(plans)
    .values(
      ['Unused', 'Archive', 'Only', 'Applied'].map((k, i) => ({
        code: `${tag}-${i}`,
        name: name(k),
        priceAed: `${133_200 + i * 120}`,
        billingInterval: 'month' as const,
        // `Archive` sorts first: /pricing shows it as the Premium-tier card until it is archived.
        sort: i === 1 ? 0 : 900 + i,
      })),
    )
    .returning()
  // `Applied`: only a rejected application points at it (a kept record, never accepted).
  const applicant = `${tag}-applicant`
  await db.insert(user).values({ id: applicant, name: 'R19 Applicant', email: `${applicant}@plans.test` })
  const pastAppValues = {
    userId: applicant,
    applicantName: 'R19 Applicant',
    email: `${applicant}@plans.test`,
    phone: '+971501234567',
    spaName: `R19 Applied ${tag}`,
    slug: `${tag}-applied`,
    emirate: 'dubai',
    streetAddress: 'Street 1',
    planId: applied!.id,
    preferredStart: '2026-11-01',
    status: 'rejected' as const,
  }
  const [pastApp] = await db.insert(spaApplications).values(pastAppValues).returning()
  let pendingAppId = ''
  const spaName = `R19 Spa ${tag}`
  const [spa] = await db
    .insert(tenants)
    .values({ slug: `${tag}-spa`, name: spaName, planId: used!.id })
    .returning()
  await db.insert(subscriptions).values({
    tenantId: spa!.id,
    planId: used!.id,
    status: 'active',
    priceAed: '24000',
    billingInterval: 'year',
    currentPeriodStart: '2026-01-01',
    currentPeriodEnd: '2026-12-31',
  })
  const audited = async (action: string) =>
    (await db.select().from(auditLog).where(eq(auditLog.action, action))).map((r) => r.data)
  const card = (n: string) => page.getByRole('region', { name: n, exact: true })
  const visitor = await browser.newPage()
  const signupPlans = async () => {
    await visitor.goto(`${app}/signup`)
    return visitor.getByLabel('Plan').locator('option').allTextContents()
  }

  try {
    await signInPlatformAdmin(page)
    await page.goto(`${admin}/plans`)
    await expect(card(name('Unused')).getByRole('button', { name: 'Delete' })).toBeVisible()
    await shot(page, 'page')
    await page.setViewportSize({ width: 360, height: 780 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.setViewportSize({ width: 1280, height: 800 })

    await test.step('a built-in plan, or one only a past application chose, is archived, not deleted', async () => {
      // Built in (the deploy seed would add a deleted one back): Archive, whatever its use; the dialog is just closed.
      const [standard] = await db.select().from(plans).where(eq(plans.code, 'standard'))
      await card(standard!.name).getByRole('button', { name: 'Delete' }).click()
      const builtIn = page.getByRole('dialog', { name: `Delete ${standard!.name}?` })
      await expect(builtIn.getByRole('button', { name: 'Archive plan' })).toBeVisible()
      await expect(builtIn).not.toContainText("This can't be undone.")
      await page.keyboard.press('Escape')
      await expect(builtIn).toHaveCount(0)

      await card(name('Applied')).getByRole('button', { name: 'Delete' }).click()
      const dialog = page.getByRole('dialog', { name: `Delete ${name('Applied')}?` })
      await expect(dialog).toContainText(
        `1 past application chose ${name('Applied')}, so it is archived, not deleted. It will be removed from this page, the pricing page and new sign-ups. You can restore it from Archived plans.`,
      )
      await shot(page, 'past-application-dialog', false)
      await dialog.getByRole('button', { name: 'Archive plan' }).click()
      await expect(
        page.getByText(`${name('Applied')} archived. Restore it from Archived plans.`),
      ).toBeVisible()
      await expect(card(name('Applied'))).toHaveCount(0)
      expect((await db.select().from(plans).where(eq(plans.id, applied!.id)))[0]?.archivedAt).toBeTruthy()
    })

    await test.step('a pending application on an archived plan says so; accept asks for a plan', async () => {
      const [pending] = await db
        .insert(spaApplications)
        .values({
          ...pastAppValues,
          spaName: `R19 Pending ${tag}`,
          slug: `${tag}-pending`,
          status: 'pending',
        })
        .returning()
      pendingAppId = pending!.id
      await page.goto(`${admin}/applications/${pending!.id}`)
      await expect(
        page.getByText(new RegExp(`^${name('Applied')} · .* \\(no longer offered\\)$`)),
      ).toBeVisible()
      await page.getByRole('button', { name: 'Accept', exact: true }).click()
      await expect(page.getByLabel('Plan')).toHaveValue('')
      await expect(
        page.getByText(
          `The plan this applicant chose (${name('Applied')}) is no longer offered. Choose one.`,
        ),
      ).toBeVisible()
      await shot(page, 'application-archived-plan', false)
      await page.goto(`${admin}/plans`)
    })

    await test.step('a plan nothing points at is deleted', async () => {
      await card(name('Unused')).getByRole('button', { name: 'Delete' }).click()
      const dialog = page.getByRole('dialog', { name: `Delete ${name('Unused')}?` })
      await expect(dialog).toContainText("This can't be undone.")
      await shot(page, 'delete-dialog', false)
      await dialog.getByRole('button', { name: 'Delete plan' }).click()
      await expect(page.getByText(`${name('Unused')} deleted`)).toBeVisible()
      await expect(card(name('Unused'))).toHaveCount(0)
      expect(await db.select().from(plans).where(eq(plans.id, unused!.id))).toHaveLength(0)
      expect(await audited('platform.plan.deleted')).toContainEqual({
        code: unused!.code,
        name: name('Unused'),
      })
    })

    await test.step('a plan a spa is on is archived: gone for new spas, still on the spa', async () => {
      await visitor.goto(`${base}/pricing`)
      await expect(visitor.getByTestId(`plan-card-${used!.code}`)).toBeVisible()
      expect(await signupPlans()).toContainEqual(expect.stringContaining(name('Archive')))
      await page.goto(`${admin}/plans`) // fresh page: no toast left from the step above
      await card(name('Archive')).getByRole('button', { name: 'Delete' }).click()
      const dialog = page.getByRole('dialog', { name: `Delete ${name('Archive')}?` })
      await expect(dialog).toContainText(
        `1 spa is on ${name('Archive')}. It will be removed from this page, the pricing page and new sign-ups. Those spas keep their plan and price until you change their subscription. You can restore it from Archived plans.`,
      )
      await shot(page, 'archive-dialog', false)
      await dialog.getByRole('button', { name: 'Archive plan' }).click()
      await expect(
        page.getByText(`${name('Archive')} archived. Restore it from Archived plans.`),
      ).toBeVisible()
      await expect(card(name('Archive'))).toHaveCount(0)
      expect(await audited('platform.plan.archived')).toContainEqual({
        code: used!.code,
        name: name('Archive'),
        spas: 1,
      })

      await visitor.goto(`${base}/pricing`)
      await expect(
        visitor.getByRole('heading', { name: 'Pick your plan. We handle the rest.' }),
      ).toBeVisible()
      await expect(visitor.getByTestId(`plan-card-${used!.code}`)).toHaveCount(0)
      expect(await signupPlans()).not.toContainEqual(expect.stringContaining(name('Archive')))

      await page.goto(`${admin}/tenants?q=${tag}`)
      await expect(page.getByRole('row', { name: new RegExp(`^${spaName}`) })).toContainText(name('Archive'))
      const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.tenantId, spa!.id))
      expect(sub).toMatchObject({ planId: used!.id, priceAed: '24000.00' })
    })

    await test.step('Archived plans lists it; Restore brings it back hidden', async () => {
      await page.goto(`${admin}/plans`)
      await page.getByRole('link', { name: /^Archived plans \(\d+\)$/ }).click()
      const archived = page
        .getByRole('region', { name: 'Archived plans' })
        .getByRole('region', { name: name('Archive'), exact: true })
      await expect(archived).toContainText(
        /Archived .* · 1 spa keeps it until you change their subscription\./,
      )
      await expect(archived.getByRole('button', { name: 'Edit' })).toHaveCount(0)
      await expect(archived.getByRole('button', { name: 'Delete' })).toHaveCount(0)
      await shot(page, 'archived-list')
      await archived.getByRole('button', { name: 'Restore' }).click()
      await expect(
        page.getByText(`${name('Archive')} restored. Edit it to offer it to new spas again.`),
      ).toBeVisible()
      const back = page.getByRole('region', { name: name('Archive'), exact: true })
      await expect(back.getByText('Hidden', { exact: true })).toBeVisible()
      await expect(back.getByRole('button', { name: 'Edit' })).toBeVisible()
      expect((await db.select().from(plans).where(eq(plans.id, used!.id)))[0]).toMatchObject({
        archivedAt: null,
        active: false,
      })
      expect(await audited('platform.plan.restored')).toContainEqual({
        code: used!.code,
        name: name('Archive'),
      })

      // Archived again (another admin) while this Edit sheet is open: the save is refused, nothing is written.
      await back.getByRole('button', { name: 'Edit' }).click()
      const sheet = page.getByRole('dialog', { name: `Edit ${name('Archive')}` })
      await sheet.getByRole('checkbox', { name: 'Available for new spas' }).check()
      await db.update(plans).set({ archivedAt: new Date(), active: false }).where(eq(plans.id, used!.id))
      await sheet.getByRole('button', { name: 'Save' }).click()
      await expect(page.getByText(`Restore ${name('Archive')} before editing it.`)).toBeVisible()
      const [stale] = await db.select().from(plans).where(eq(plans.id, used!.id))
      expect(stale).toMatchObject({ active: false, archivedAt: expect.any(Date) })
      expect(await audited('platform.plan.updated')).not.toContainEqual(
        expect.objectContaining({ code: used!.code }),
      )
      await db.update(plans).set({ archivedAt: null }).where(eq(plans.id, used!.id))
    })

    await test.step('the last plan new spas can get is refused', async () => {
      // Briefly the only offered plan (workers: 1, so no other spec sees this); the others come back in `finally`.
      const others = await db
        .select({ id: plans.id })
        .from(plans)
        .where(
          and(
            eq(plans.active, true),
            isNull(plans.archivedAt),
            ne(plans.code, 'legacy-yearly'),
            ne(plans.id, only!.id),
          ),
        )
      const ids = others.map((o) => o.id)
      try {
        if (ids.length) await db.update(plans).set({ active: false }).where(inArray(plans.id, ids))
        await page.goto(`${admin}/plans`)
        await card(name('Only')).getByRole('button', { name: 'Delete' }).click()
        await page
          .getByRole('dialog', { name: `Delete ${name('Only')}?` })
          .getByRole('button', { name: 'Delete plan' })
          .click()
        await expect(
          page.getByText(
            `${name('Only')} is the only plan new spas can get. Add another plan or make one available first.`,
          ),
        ).toBeVisible()
        expect(await db.select().from(plans).where(eq(plans.id, only!.id))).toHaveLength(1)
      } finally {
        if (ids.length) await db.update(plans).set({ active: true }).where(inArray(plans.id, ids))
      }
    })
  } finally {
    // Whatever happened above, no test plan stays offered (the pricing tests read the first Premium-tier plan).
    await db.update(plans).set({ active: false }).where(eq(plans.id, used!.id))
    await db
      .delete(spaApplications)
      .where(inArray(spaApplications.id, [pastApp!.id, ...(pendingAppId ? [pendingAppId] : [])]))
    await db.delete(user).where(eq(user.id, applicant))
    await db.delete(plans).where(inArray(plans.id, [unused!.id, only!.id, applied!.id]))
    await visitor.close()
  }
})
