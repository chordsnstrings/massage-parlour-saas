import { expect, test } from '@playwright/test'
import { subscriptions, tenants } from '@spa/db'
import { addMonths } from '@spa/services'
import { eq } from 'drizzle-orm'
import { admin, signInPlatformAdmin, signUpOwner, testDb } from './helpers'

const daysAgo = (n: number) =>
  new Date(Date.now() - n * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' })

// PLAN §14.8 R3/R11/R12: the super-admin issues the 12-month schedule, sets Paid / Must pay, pauses and reminds;
// the spa sees its schedule, the red overdue bar and the paused notice.
test('platform billing: schedule, overdue bar, mark paid, pause and reminder', async ({ browser }) => {
  const ownerCtx = await browser.newContext()
  const adminCtx = await browser.newContext()
  const owner = await ownerCtx.newPage()
  const ops = await adminCtx.newPage()
  const { slug, dashboard } = await signUpOwner(owner, { spa: 'Billing Spa' })
  await signInPlatformAdmin(ops)

  const db = testDb()
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, slug))
  // Monthly plan whose first installment fell due 5 days ago (the second is next month).
  const start = daysAgo(5)
  await db
    .update(subscriptions)
    .set({
      status: 'active',
      priceAed: '24000',
      setupFeeAed: '0',
      billingInterval: 'month',
      currentPeriodStart: start,
      currentPeriodEnd: addMonths(start, 12),
    })
    .where(eq(subscriptions.tenantId, tenant!.id))
  const bar = owner.getByText('Please pay your invoice to avoid your account being paused.')

  await test.step('super-admin generates the 12-month schedule', async () => {
    await ops.goto(`${admin}/tenants/${tenant!.id}`)
    await ops.getByRole('button', { name: 'Generate payment schedule' }).click()
    await expect(ops.getByText('12 invoices created')).toBeVisible()
    await expect(ops.getByText('overdue', { exact: true }).filter({ visible: true })).toHaveCount(1)
  })

  await test.step('spa sees the red bar and the schedule with Must pay dots', async () => {
    await owner.goto(`${dashboard}/billing`)
    await expect(bar).toBeVisible()
    await expect(owner.getByText(/12 monthly payments of/)).toBeVisible()
    await expect(owner.getByText('Month 1 of 12', { exact: true })).toBeVisible()
    await expect(owner.getByText('Must pay')).toHaveCount(12)
  })

  await test.step('reminder gives a click-to-send WhatsApp message', async () => {
    await ops.reload()
    await ops.getByRole('button', { name: 'Generate payment reminder' }).click()
    await expect(ops.getByRole('textbox', { name: 'Reminder message' })).toHaveValue(/Hello Billing Spa/)
    await expect(ops.getByRole('link', { name: 'Send on WhatsApp' })).toHaveAttribute('href', /wa\.me/)
    await owner.reload()
    await expect(owner.getByText(/Payment reminder/)).toBeVisible()
  })

  await test.step('pause makes the dashboard read-only with a notice; resume restores it', async () => {
    await ops.reload()
    await ops.getByRole('button', { name: 'Pause spa' }).click()
    await expect(ops.getByText('Billing Spa paused')).toBeVisible()
    await owner.goto(dashboard)
    await expect(owner.getByText(/Your account is paused for late payment/)).toBeVisible()
    await ops.reload()
    await ops.getByRole('button', { name: 'Resume spa' }).click()
    await expect(ops.getByText('Billing Spa resumed')).toBeVisible()
  })

  await test.step('marking the overdue invoice paid clears the bar', async () => {
    await ops.reload()
    await ops
      .getByRole('row', { name: /month 1 of 12/ })
      .getByRole('button', { name: 'Mark paid' })
      .click()
    await expect(ops.getByText(/marked paid/)).toBeVisible()
    await owner.goto(`${dashboard}/billing`)
    await expect(owner.getByText('Must pay')).toHaveCount(11)
    await expect(bar).toHaveCount(0)
  })

  await ownerCtx.close()
  await adminCtx.close()
})
