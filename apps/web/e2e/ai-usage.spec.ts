import { expect, test } from '@playwright/test'
import { aiUsage, auditLog, tenants } from '@spa/db'
import { and, eq } from 'drizzle-orm'
import { admin, signInPlatformAdmin, signUpOwner, testDb } from './helpers'

// PLAN §18 G18: the console shows a spa's AI spend against its budget; the budget edit persists (audited), the
// kill switch flips, and the spa dashboard shows the 80 % warning / 100 % paused banner.
test('console AI usage: spend per spa, budget edit, kill switch, dashboard banner', async ({ browser }) => {
  test.setTimeout(180_000) // two surfaces, several reloads
  const ownerCtx = await browser.newContext()
  const adminCtx = await browser.newContext()
  const owner = await ownerCtx.newPage()
  const { slug, dashboard } = await signUpOwner(owner, { spa: 'Usage Spa' })
  const db = testDb()
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, slug))
  await db.insert(aiUsage).values([
    {
      tenantId: tenant!.id,
      agentKey: 'dm_agent',
      modelId: 'seed-lite',
      tokensIn: 4000,
      tokensOut: 1000,
      costUsd: '20',
    },
    {
      tenantId: tenant!.id,
      agentKey: 'content_agent',
      modelId: 'seed-pro',
      tokensIn: 100,
      tokensOut: 50,
      costUsd: '1.25',
    },
  ])

  // 21.25 of the default USD 25 = 85 % → the owner sees the warning banner.
  await owner.goto(dashboard)
  await expect(owner.getByText(/AI budget 85% used this month/)).toBeVisible()

  const ops = await adminCtx.newPage()
  await signInPlatformAdmin(ops)
  await ops.goto(`${admin}/ai/usage?sort=name`)
  await expect(ops.getByRole('heading', { name: 'AI usage', exact: true })).toBeVisible()
  const row = ops.locator('tr', { has: ops.getByTestId(`ai-usage-${slug}`) })
  await expect(row.getByTestId('ai-month')).toContainText('$21.25')
  await expect(row.getByTestId('ai-month')).toContainText('2 calls')
  await expect(row.getByTestId('ai-used')).toContainText('85%')

  // Lower the budget below the spend → paused for the spa.
  await row.getByTestId('ai-budget-input').fill('20')
  await row.getByTestId('ai-budget-save').click()
  await expect(ops.getByText('Usage Spa: AI budget USD 20.00 / month')).toBeVisible()
  await owner.reload()
  await expect(
    owner.getByText('AI paused: monthly AI budget reached — contact us. AI restarts on the 1st.'),
  ).toBeVisible()

  // Raise it; the edit persists across a reload and is audited.
  await row.getByTestId('ai-budget-input').fill('50')
  await row.getByTestId('ai-budget-save').click()
  await expect(ops.getByText('Usage Spa: AI budget USD 50.00 / month')).toBeVisible()
  await ops.reload()
  await expect(row.getByTestId('ai-budget-input')).toHaveValue('50.00')
  await expect(row.getByTestId('ai-used')).toContainText('43%')
  const [saved] = await db.select().from(tenants).where(eq(tenants.id, tenant!.id))
  expect(Number(saved!.aiBudgetUsd)).toBe(50)
  const audits = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.tenantId, tenant!.id), eq(auditLog.action, 'platform.ai.budget_updated')))
  expect(audits).toHaveLength(2)

  // Per-spa kill switch.
  await row.getByTestId('ai-toggle').click()
  await expect(ops.getByText('AI off for Usage Spa')).toBeVisible()
  await expect(row.getByText('AI off', { exact: true })).toBeVisible()
  await owner.reload()
  await expect(owner.getByText('AI is switched off for your spa — contact us.')).toBeVisible()

  // Drill-down: daily cost + by-agent split.
  await row.getByTestId(`ai-usage-${slug}`).click()
  await expect(ops.getByRole('heading', { name: 'Usage Spa' })).toBeVisible()
  await expect(ops.getByText('Daily cost')).toBeVisible()
  await expect(ops.getByRole('cell', { name: /dm_agent/ })).toBeVisible()
  await ownerCtx.close()
  await adminCtx.close()
})
