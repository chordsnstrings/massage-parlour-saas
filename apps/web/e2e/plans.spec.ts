import { expect, test } from '@playwright/test'
import { auditLog, spaApplications, tenants } from '@spa/db'
import { and, eq } from 'drizzle-orm'
import {
  admin,
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
