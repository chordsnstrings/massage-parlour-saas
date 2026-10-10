// F28 (PLAN §17): WhatsApp outbox assignment — per-message "Assigned to", Mine / Unassigned / All filter, bulk assign,
// the assignee's own sidebar badge and an audit row per change. Sending stays click-to-send.
import { expect, test } from '@playwright/test'
import { auditLog, outbox } from '@spa/db'
import { and, eq } from 'drizzle-orm'
import { addMember, app, createLogin, OWNER_PASSWORD, seedCatalog, signUpOwner, testDb } from './helpers'

test('outbox assignment: assign, bulk assign, filter and the assignee badge', async ({ browser }) => {
  test.setTimeout(180_000)
  const owner = await (await browser.newContext()).newPage()
  const { slug } = await signUpOwner(owner)
  const seed = await seedCatalog(slug)
  const db = testDb()
  await db.insert(outbox).values(
    ['Noor', 'Layla', 'Mina'].map((name, i) => ({
      tenantId: seed.tenantId,
      branchId: seed.branchId,
      clientId: seed.clientId,
      kind: 'custom' as const,
      phoneE164: '971501234567',
      text: `Hello ${name}, your offer is ready.`,
      dueAt: new Date(Date.now() - (3 - i) * 60_000),
    })),
  )
  const desk = await (await browser.newContext()).newPage()
  const email = `desk-${slug.slice(-8)}@e2e.test`
  await createLogin(desk, { name: 'Desk Noor', email, password: OWNER_PASSWORD })
  await addMember(slug, email, 'receptionist')

  const cards = owner.getByRole('article')
  await test.step('owner assigns one message, then the rest in bulk', async () => {
    await owner.goto(`${app}/${slug}/messages`)
    await expect(cards).toHaveCount(3)
    await expect(owner.getByRole('link', { name: /Unassigned 3/ })).toBeVisible()
    await cards.first().getByTestId('assignee').selectOption({ label: 'Desk Noor' })
    await expect(owner.getByText('Assigned 1 message')).toBeVisible()
    await expect(owner.getByRole('link', { name: /Unassigned 2/ })).toBeVisible()

    await owner.getByLabel('Select all').check()
    const bulk = owner.getByTestId('bulk-assign')
    await expect(bulk).toContainText('3 selected')
    await bulk.getByLabel('Assign to…').selectOption({ label: 'Desk Noor' })
    await bulk.getByRole('button', { name: 'Assign', exact: true }).click()
    await expect(owner.getByText('Assigned 2 messages')).toBeVisible()
    await expect(owner.getByRole('link', { name: /Unassigned 0/ })).toBeVisible()
    for (const card of await cards.all())
      await expect(card.getByTestId('assignee')).toHaveValue(/[0-9a-f-]{36}/)
  })

  await test.step('the assignee sees their badge and the Mine filter', async () => {
    await desk.goto(`${app}/${slug}`)
    await expect(desk.getByTestId('nav-mine')).toHaveText(/3/)
    await desk.goto(`${app}/${slug}/messages?who=mine`)
    await expect(desk.getByRole('article')).toHaveCount(3)
    await expect(desk.getByRole('article').first().getByText('Mine', { exact: true })).toBeVisible()
    // The owner has nothing assigned: no badge, empty Mine filter.
    await owner.goto(`${app}/${slug}/messages?who=mine`)
    await expect(owner.getByText('All caught up')).toBeVisible()
    await expect(owner.getByTestId('nav-mine')).toHaveCount(0)
  })

  await test.step('unassigning updates the badge; every change is audited', async () => {
    await owner.goto(`${app}/${slug}/messages`)
    await cards.first().getByTestId('assignee').selectOption({ label: 'Unassigned' })
    await expect(owner.getByText('Unassigned 1 message')).toBeVisible()
    await desk.reload()
    await expect(desk.getByRole('article')).toHaveCount(2)
    await expect(desk.getByTestId('nav-mine')).toHaveText(/2/)
    const rows = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(and(eq(auditLog.tenantId, seed.tenantId), eq(auditLog.entity, 'outbox')))
    expect(rows.filter((r) => r.action === 'outbox.assigned')).toHaveLength(3)
    expect(rows.filter((r) => r.action === 'outbox.unassigned')).toHaveLength(1)
  })
  for (const ctx of browser.contexts()) await ctx.close()
})
