import { expect, test } from '@playwright/test'
import { businessDateOf } from '@spa/core'
import { timeEntries } from '@spa/db'
import { eq } from 'drizzle-orm'
import { app, screenshotAt, seedCatalog, signUpOwner, testDb } from './helpers'

test('time clock: PIN kiosk, timesheet, leave approval blocks the calendar', async ({ page }) => {
  const { slug } = await signUpOwner(page)
  const seed = await seedCatalog(slug)
  const [maya] = seed.staffIds
  const tomorrow = businessDateOf(new Date(Date.now() + 24 * 3600_000), '05:00')

  await test.step('manager sets a PIN, Maya clocks in at the kiosk', async () => {
    await page.goto(`${app}/${slug}/timeclock`)
    await expect(page.getByRole('heading', { name: 'Time clock', level: 1 })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Maya — No PIN yet' })).toBeDisabled()
    await page.getByRole('button', { name: 'PIN for Maya' }).click()
    await page.getByLabel('New PIN').fill('2468')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('PIN saved')).toBeVisible()

    await page.getByRole('button', { name: 'Maya — Clocked out' }).click()
    await page.getByLabel('PIN', { exact: true }).fill('1111')
    await page.getByRole('button', { name: 'Clock in' }).click()
    await expect(page.getByText('Wrong PIN').first()).toBeVisible()
    await page.getByLabel('PIN', { exact: true }).fill('2468')
    await page.getByRole('button', { name: 'Clock in' }).click()
    await expect(page.getByText(/Maya clocked in at \d{2}:\d{2}/)).toBeVisible()
    await expect(page.getByRole('button', { name: /^Maya — In since \d{2}:\d{2}$/ })).toBeVisible()
  })

  await test.step('two hours later she clocks out; the timesheet shows the hours', async () => {
    const db = testDb()
    const [open] = await db.select().from(timeEntries).where(eq(timeEntries.staffId, maya!))
    await db
      .update(timeEntries)
      .set({ clockIn: new Date(Date.now() - 2 * 3600_000) })
      .where(eq(timeEntries.id, open!.id))
    await page.reload()
    await page.getByRole('button', { name: /^Maya — In since/ }).click()
    await page.getByLabel('PIN', { exact: true }).fill('2468')
    await page.getByRole('button', { name: 'Clock out' }).click()
    await expect(page.getByText('Maya clocked out — 2 h 0 min worked')).toBeVisible()

    await page.getByRole('link', { name: 'Timesheet' }).click()
    await expect(page.getByRole('heading', { name: 'Actual vs planned' })).toBeVisible()
    const row = page.getByRole('row', { name: /Maya/ }).filter({ hasText: '2 h 0 min' })
    await expect(row.first()).toBeVisible()
  })

  await test.step('leave request → approval → Maya is off the calendar', async () => {
    await page.getByRole('link', { name: 'Leave' }).click()
    await page.getByRole('button', { name: 'Request leave' }).click()
    await page.getByLabel('Team member').selectOption({ label: 'Maya' })
    await page.getByLabel('Type').selectOption({ label: 'Unpaid leave' })
    await page.getByLabel('First day').fill(tomorrow)
    await page.getByLabel('Last day').fill(tomorrow)
    await page.getByRole('button', { name: 'Send request' }).click()
    await expect(page.getByText('Leave requested')).toBeVisible()
    await expect(page.getByText('Pending', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Approve' }).click()
    await expect(page.getByText('Leave approved')).toBeVisible()
    await expect(page.getByText('Approved', { exact: true })).toBeVisible()
    await screenshotAt(page, 'timeclock-leave')

    await page.goto(`${app}/${slug}/calendar?date=${tomorrow}`)
    await expect(page.getByText('On leave')).toBeVisible()
  })
})
