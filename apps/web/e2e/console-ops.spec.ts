import { expect, test } from '@playwright/test'
import { announcementDismissals, platformInvoices, tenants } from '@spa/db'
import { createPlatformInvoice } from '@spa/services'
import { eq } from 'drizzle-orm'
import { admin, signInPlatformAdmin, signUpOwner, testDb } from './helpers'

const daysAgo = (n: number) =>
  new Date(Date.now() - n * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' })

// F20 (PLAN §17): feature flags (default + per-spa override, audited) and announcements shown in the spa dashboard
// as a dismissible banner per member.
test('console: feature flags and announcements', async ({ browser }) => {
  test.setTimeout(180_000) // two surfaces, four console pages
  const ownerCtx = await browser.newContext()
  const adminCtx = await browser.newContext()
  const owner = await ownerCtx.newPage()
  const ops = await adminCtx.newPage()
  const { slug, dashboard } = await signUpOwner(owner, { spa: 'Flags Spa' })
  await signInPlatformAdmin(ops)

  await test.step('code flag is listed; an owner-defined flag gets a default and a per-spa override', async () => {
    await ops.goto(`${admin}/flags`)
    const code = ops.getByTestId('flag-billing.autoTransitions')
    await expect(code.getByText('read by code')).toBeVisible()
    await expect(code.getByText('default on')).toBeVisible()
    await ops.getByRole('button', { name: 'New flag' }).click()
    await ops.getByLabel('Key').fill('e2e.demoFlag')
    await ops.getByLabel('Description').fill('Demo flag')
    await ops.getByText('On for every spa (unless overridden)').click()
    await ops.getByRole('button', { name: 'Save' }).click()
    await expect(ops.getByText('Flag saved')).toBeVisible()
    const demo = ops.getByTestId('flag-e2e.demoFlag')
    await expect(demo.getByText('default on')).toBeVisible()
    await demo.getByLabel('Spa').selectOption({ label: `Flags Spa (${slug})` })
    await demo.getByLabel('Value').selectOption('off')
    await demo.getByRole('button', { name: 'Set override' }).click()
    await expect(ops.getByText('Override saved')).toBeVisible()
    await expect(demo.getByRole('link', { name: 'Flags Spa' })).toBeVisible()
    await demo.getByRole('button', { name: 'Delete flag' }).click()
    await expect(ops.getByText('Flag deleted')).toBeVisible()
    await expect(ops.getByTestId('flag-e2e.demoFlag')).toHaveCount(0)
  })

  await test.step('an announcement to this spa shows in its dashboard until the member dismisses it', async () => {
    await ops.goto(`${admin}/announcements`)
    await ops.getByRole('button', { name: 'New announcement' }).click()
    await ops.getByLabel('Title (English)').fill('Maintenance tonight')
    await ops.getByLabel('Title (Thai)').fill('ปิดปรับปรุงคืนนี้')
    await ops.getByLabel('Message (English)').fill('The dashboard pauses 02:00–02:15.')
    await ops.getByLabel('Severity').selectOption('warning')
    await ops.getByLabel('Show to').selectOption('tenants')
    // The multi-pick list box is not a dropdown: no chevron (dropdown Selects keep theirs).
    await expect(ops.getByLabel('Spas')).toHaveCSS('background-image', 'none')
    await expect(ops.getByLabel('Severity')).not.toHaveCSS('background-image', 'none')
    await ops.getByLabel('Spas').selectOption({ label: `Flags Spa (${slug})` })
    await ops.getByRole('button', { name: 'Publish' }).click()
    await expect(ops.getByText('Announcement published')).toBeVisible()
    await expect(ops.getByTestId('announcement').filter({ hasText: 'Maintenance tonight' })).toContainText(
      'live',
    )

    await owner.goto(dashboard)
    const banner = owner.getByRole('status', { name: /Announcement from/ })
    await expect(banner).toContainText('Maintenance tonight')
    await expect(banner).toContainText('The dashboard pauses 02:00–02:15.')
    await banner.getByRole('button', { name: 'Dismiss' }).click()
    await expect(banner).toHaveCount(0)
    // The banner hides at once; the dismissal is stored by the server action in the background.
    await expect
      .poll(async () => (await testDb().select().from(announcementDismissals)).length)
      .toBeGreaterThan(0)
    await owner.reload()
    await expect(owner.getByText('Maintenance tonight')).toHaveCount(0)
    await ops.reload()
    await expect(ops.getByText('dismissed by 1 member')).toBeVisible()
  })

  await ownerCtx.close()
  await adminCtx.close()
})

// F21 + F22 (PLAN §17): the spa list's usage columns + sorting; an unpaid invoice moves the spa overdue → read-only
// (dashboard banner, writes blocked), "Pause automatic transitions", and marking it paid lifts it.
test('console: tenant usage columns and automatic billing transitions', async ({ browser }) => {
  test.setTimeout(180_000) // two surfaces, several reloads
  const ownerCtx = await browser.newContext()
  const adminCtx = await browser.newContext()
  const owner = await ownerCtx.newPage()
  const ops = await adminCtx.newPage()
  const { slug, dashboard } = await signUpOwner(owner, { spa: 'Late Spa' })
  await signInPlatformAdmin(ops)
  const db = testDb()
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, slug))
  const id = tenant!.id
  // Only our invoice: due 3 days ago, unpaid.
  await db.update(platformInvoices).set({ status: 'void' }).where(eq(platformInvoices.tenantId, id))
  const inv = await createPlatformInvoice(db, id, {
    description: 'Late month',
    amountAed: '2000',
    issueDate: daysAgo(10),
    dueDate: daysAgo(3),
  })

  await test.step('spa list: last sign-in, usage columns and sorting', async () => {
    await ops.goto(`${admin}/tenants?q=${slug}`)
    const row = ops.getByRole('row', { name: /Late Spa/ })
    await expect(row).toBeVisible()
    // The owner just signed in (F21 stamp); no bookings yet.
    await expect(row).toContainText(/min ago|h ago/)
    await expect(row.locator('[data-key="bookings30"]')).toHaveText('0')
    await ops.getByRole('link', { name: 'Sort by Bookings 30 d' }).click()
    await expect(ops).toHaveURL(/sort=bookings30/)
    await expect(ops.getByRole('row', { name: /Late Spa/ })).toBeVisible()
  })

  await test.step('Check now: overdue, with the read-only date in the spa dashboard', async () => {
    await ops.goto(`${admin}/tenants/${id}`)
    await ops.getByRole('button', { name: 'Check now' }).click()
    await expect(ops.getByText('Billing stage: none → overdue')).toBeVisible()
    await expect(ops.getByTestId('billing-auto')).toContainText('overdue — read-only from')
    await owner.goto(dashboard)
    await expect(owner.getByText(/Invoice overdue — the dashboard becomes read-only on/)).toBeVisible()
  })

  await test.step('after the grace period: read-only; the Billing page still opens', async () => {
    await db
      .update(tenants)
      .set({ billingOverdueSince: daysAgo(8) })
      .where(eq(tenants.id, id))
    await ops.reload()
    await ops.getByRole('button', { name: 'Check now' }).click()
    await expect(ops.getByText('Billing stage: overdue → read_only')).toBeVisible()
    await owner.goto(dashboard)
    await expect(owner.getByText(/Read-only: an invoice is unpaid past the grace period/)).toBeVisible()
    await owner.goto(`${dashboard}/billing`)
    await expect(owner.getByText(inv!.number).first()).toBeVisible()
    const [row] = await db.select().from(tenants).where(eq(tenants.id, id))
    expect([row!.status, row!.billingStage]).toEqual(['read_only', 'read_only'])
  })

  await test.step('pause transitions for the spa, then mark the invoice paid: access restored', async () => {
    await ops.reload()
    await ops.getByRole('button', { name: 'Pause automatic transitions' }).click()
    await expect(ops.getByText('Automatic billing transitions paused for this spa')).toBeVisible()
    await expect(ops.getByTestId('billing-auto').getByText('transitions paused')).toBeVisible()
    await ops
      .getByRole('row', { name: /Late month/ })
      .getByRole('button', { name: 'Mark paid' })
      .click()
    await expect(ops.getByText(/marked paid/)).toBeVisible()
    await owner.goto(dashboard)
    await expect(owner.getByText(/Read-only: an invoice is unpaid/)).toHaveCount(0)
    const [row] = await db.select().from(tenants).where(eq(tenants.id, id))
    expect([row!.status, row!.billingStage]).toEqual(['active', null])
    await ops.reload()
    await ops.getByRole('button', { name: 'Resume automatic transitions' }).click()
    await expect(ops.getByText('Automatic transitions resumed')).toBeVisible()
  })

  await test.step('billing rules are tunable in Company settings', async () => {
    await ops.goto(`${admin}/settings`)
    const card = ops.getByTestId('billing-rules')
    await card.getByLabel('Grace period (days)').fill('10')
    await card.getByRole('button', { name: 'Save billing rules' }).click()
    await expect(ops.getByText('Billing rules saved')).toBeVisible()
    await card.getByLabel('Grace period (days)').fill('7')
    await card.getByRole('button', { name: 'Save billing rules' }).click()
    await expect(ops.getByText('Billing rules saved').first()).toBeVisible()
  })

  await ownerCtx.close()
  await adminCtx.close()
})
