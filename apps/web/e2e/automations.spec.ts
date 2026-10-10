import { expect, test } from '@playwright/test'
import { jobRuns, tenants } from '@spa/db'
import { eq } from 'drizzle-orm'
import { app, signUpOwner, testDb } from './helpers'

test('automations: switch one off (kept after reload), locked platform duties, last-24h run log', async ({
  page,
}) => {
  const { slug } = await signUpOwner(page, { plan: 'premium' })
  const [t] = await testDb().select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug))
  await testDb()
    .insert(jobRuns)
    .values({ tenantId: t!.id, job: 'packages-expire', status: 'ok', summary: { count: 3 } })

  await page.goto(`${app}/${slug}`)
  await page.getByRole('link', { name: 'Automations' }).first().click()
  await expect(page.getByRole('heading', { name: 'Automations', exact: true })).toBeVisible()
  await expect(page.getByText('12 active')).toBeVisible()
  await expect(page.getByText('Always on')).toHaveCount(2)
  await expect(page.getByRole('cell', { name: /Package expiry · 3 items/ })).toBeVisible()

  const toggle = page.getByRole('switch', { name: 'Booking confirmations & reminders: on or off' })
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await toggle.click()
  await expect(page.getByText('Booking confirmations & reminders switched off')).toBeVisible()
  await page.reload()
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await expect(page.getByText('11 active')).toBeVisible()

  const [row] = await testDb()
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, t!.id))
  expect(row!.settings.automations).toEqual({ bookingMessages: false })
})
