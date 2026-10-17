import { expect, test } from '@playwright/test'
import { aiUsage, auditLog } from '@spa/db'
import { and, eq } from 'drizzle-orm'
import {
  ADMIN,
  addMember,
  app,
  createLogin,
  hoursOnToday,
  mockAiReply,
  OWNER_PASSWORD,
  passTwoFactor,
  seedBooking,
  seedCatalog,
  signInPlatformAdmin,
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
  let asked: { action: string; type: string; body: string } | undefined

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
    // The ask request, kept to replay it as a super-admin below.
    desk.on('request', (r) => {
      if (r.headers()['next-action'] && r.postData()?.includes('What was revenue today?'))
        asked = {
          action: r.headers()['next-action']!,
          type: r.headers()['content-type'] ?? 'text/plain;charset=UTF-8',
          body: r.postData() ?? '',
        }
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

  await test.step('a super-admin acting on the spa gets no Ask AI, and the action refuses them', async () => {
    const ctx = await browser.newContext()
    const admin = await ctx.newPage()
    await signInPlatformAdmin(admin)
    await admin.goto(`${app}/login?next=${encodeURIComponent(new URL(dashboard).pathname)}`)
    if (await admin.getByLabel('Email').isVisible()) {
      await admin.getByLabel('Email').fill(ADMIN.email)
      await admin.getByLabel('Password').fill(ADMIN.password)
      await admin.getByRole('button', { name: 'Sign in' }).click()
      await admin.waitForURL(/\/two-factor/)
      await passTwoFactor(admin)
    }
    await admin.waitForURL(dashboard)
    await expect(admin.getByRole('navigation', { name: 'Main menu' })).toBeVisible()
    await expect(admin.getByTestId('ask-ai-open')).toHaveCount(0)
    const before = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.tenantId, seed.tenantId), eq(auditLog.action, 'ai.assistant.asked')))
    const text = await admin.evaluate(
      async ({ action, type, body }) =>
        (
          await fetch(window.location.href, {
            method: 'POST',
            headers: { 'next-action': action, 'content-type': type, accept: 'text/x-component' },
            body,
          })
        ).text(),
      asked!,
    )
    expect(text).toContain("You don't have permission to do that.")
    const after = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.tenantId, seed.tenantId), eq(auditLog.action, 'ai.assistant.asked')))
    expect(after).toHaveLength(before.length)
    await ctx.close()
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
