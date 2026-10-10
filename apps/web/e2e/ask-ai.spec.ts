import { expect, test } from '@playwright/test'
import { aiUsage, auditLog } from '@spa/db'
import { and, eq } from 'drizzle-orm'
import {
  addMember,
  app,
  createLogin,
  hoursOnToday,
  mockAiReply,
  OWNER_PASSWORD,
  seedBooking,
  seedCatalog,
  signUpOwner,
  testDb,
  today,
} from './helpers'

// F30 (PLAN §17): dashboard "Ask AI" for staff — read-only tools through the gateway (fixture model, real tools,
// metering and audit), deep links to the screens, per-tool permission checks, Premium only.
const call = (name: string, args: unknown) => ({
  role: 'assistant',
  content: null,
  tool_calls: [{ id: `c-${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
})

test('Premium spa: staff ask, get an answer with deep links; a role without reports.view gets no revenue', async ({
  browser,
}) => {
  test.setTimeout(180_000)
  const owner = await (await browser.newContext()).newPage()
  const { slug, dashboard } = await signUpOwner(owner, { plan: 'premium' })
  const seed = await seedCatalog(slug)
  await seedBooking(seed, hoursOnToday(2))
  const db = testDb()
  const drawer = owner.getByTestId('ask-ai')

  await test.step('owner asks about today: the tool reads the calendar, the answer links to it', async () => {
    await mockAiReply(slug, {
      __steps: [
        call('bookings_summary', { from: today() }),
        { role: 'assistant', content: 'You have 1 booking today: Swedish massage with Maya.' },
      ],
    })
    await owner.goto(dashboard)
    await owner.getByTestId('ask-ai-open').click()
    await expect(drawer.getByRole('heading', { name: 'Ask AI' })).toBeVisible()
    await expect(drawer.getByText('AI can make mistakes.', { exact: false })).toBeVisible()
    await expect(drawer.getByRole('button', { name: 'How many bookings do we have tomorrow?' })).toBeVisible()
    await drawer.getByLabel('Your question').fill('How many bookings today?')
    await drawer.getByLabel('Your question').press('Enter')
    await expect(drawer.getByTestId('ask-ai-question')).toHaveText(/How many bookings today\?/)
    const answer = drawer.getByTestId('ask-ai-answer')
    await expect(answer).toContainText('You have 1 booking today: Swedish massage with Maya.')
    await expect(answer.getByRole('link', { name: 'Bookings' })).toBeVisible()
    await answer.getByRole('link', { name: /^Calendar · / }).click()
    await owner.waitForURL(`${dashboard}/calendar?date=${today()}`)
    await expect(drawer).toBeHidden()

    const [row] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.tenantId, seed.tenantId), eq(auditLog.action, 'ai.assistant.asked')))
    expect(row!.data).toMatchObject({
      question: 'How many bookings today?',
      outcome: 'answered',
      tools: ['bookings_summary'],
      denied: [],
      locale: 'en',
    })
    expect(JSON.stringify(row!.data)).not.toContain('Swedish massage with Maya') // never the answer
    const usage = await db
      .select()
      .from(aiUsage)
      .where(and(eq(aiUsage.tenantId, seed.tenantId), eq(aiUsage.agentKey, 'staff_assistant')))
    expect(usage).toHaveLength(2) // tool step + answer, each metered
  })

  await test.step('a receptionist (no reports.view) asks for revenue: the tool refuses, no Reports link', async () => {
    const desk = await (await browser.newContext()).newPage()
    const email = `desk-${slug.slice(-8)}@e2e.test`
    await createLogin(desk, { name: 'Desk Noor', email, password: OWNER_PASSWORD })
    await addMember(slug, email, 'receptionist')
    await mockAiReply(slug, {
      __steps: [
        call('revenue_summary', { from: today(), to: today() }),
        {
          role: 'assistant',
          content: 'Your role can’t see revenue figures. Please ask the owner or a manager.',
        },
      ],
    })
    await desk.goto(`${app}/${slug}`)
    await desk.getByTestId('ask-ai-open').click()
    const deskDrawer = desk.getByTestId('ask-ai')
    await deskDrawer.getByLabel('Your question').fill('What was revenue today?')
    await deskDrawer.getByRole('button', { name: 'Ask', exact: true }).click()
    const answer = deskDrawer.getByTestId('ask-ai-answer')
    await expect(answer).toContainText('Your role can’t see revenue figures.')
    await expect(answer.getByRole('link')).toHaveCount(0)
    const rows = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.tenantId, seed.tenantId), eq(auditLog.action, 'ai.assistant.asked')))
    expect(rows.map((r) => r.data)).toContainEqual(
      expect.objectContaining({ question: 'What was revenue today?', denied: ['revenue_summary'] }),
    )
  })
})

test('Standard spa: Ask AI shows the Premium upsell, no question box', async ({ page }) => {
  const { dashboard } = await signUpOwner(page, { plan: 'standard' })
  await page.goto(dashboard)
  const open = page.getByTestId('ask-ai-open')
  await expect(open).toContainText('Premium')
  await open.click()
  const upsell = page.getByTestId('ask-ai-upsell')
  await expect(upsell).toContainText('Ask AI is part of Premium')
  await expect(upsell.getByRole('link', { name: 'Compare plans' })).toBeVisible()
  await expect(upsell.getByRole('link', { name: 'Your subscription' })).toHaveAttribute('href', /\/billing$/)
  await expect(page.getByTestId('ask-ai').getByLabel('Your question')).toHaveCount(0)
})
