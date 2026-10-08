import { expect, test } from '@playwright/test'
import { bookings, tenants, user } from '@spa/db'
import { eq, sql } from 'drizzle-orm'
import { seedBooking, seedCatalog, signUpOwner, testDb } from './helpers'

// X5 (PLAN §14.7 B4 + Settings → Security): ⌘K / Ctrl+K global search; 2FA policy redirect, mask-phones toggle,
// audit log viewer.
test('global search: Ctrl+K palette with grouped results and keyboard navigation', async ({ page }) => {
  const { slug, dashboard } = await signUpOwner(page)
  const seed = await seedCatalog(slug)
  await seedBooking(seed)
  const [b] = await testDb()
    .select({ id: bookings.id, ref: bookings.refCode })
    .from(bookings)
    .where(eq(bookings.tenantId, seed.tenantId))
  await page.goto(dashboard)

  const dialog = page.getByRole('dialog', { name: 'Search the spa' })
  const input = dialog.getByRole('combobox', { name: 'Search' })
  const list = dialog.getByRole('listbox')
  await test.step('Ctrl+K opens the palette; results are grouped', async () => {
    // Retry until the shell has hydrated (the shortcut listener is attached on mount).
    await expect(async () => {
      if (!(await dialog.isVisible())) await page.keyboard.press('Control+k')
      await expect(dialog).toBeVisible({ timeout: 1_000 })
    }).toPass()
    await input.fill('fatima')
    await expect(
      list.getByRole('group', { name: 'Clients' }).getByRole('option', { name: /Fatima Al Mansoori/ }),
    ).toBeVisible()
    await expect(list.getByText('+971501234567')).toBeVisible() // owner has clients.phone
    await expect(
      list.getByRole('group', { name: 'Bookings' }).getByRole('option', { name: new RegExp(b!.ref) }),
    ).toBeVisible()
  })

  await test.step('arrow keys move the highlight, Enter opens the booking', async () => {
    const options = list.getByRole('option')
    await expect(options.first()).toHaveAttribute('aria-selected', 'true')
    await input.press('ArrowDown')
    await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true')
    await input.press('Enter')
    await page.waitForURL(`${dashboard}/bookings/${b!.id}`)
    await expect(dialog).toBeHidden()
  })

  await test.step('phone and reference search; nothing found; Esc closes', async () => {
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await input.fill('050 123 4567')
    await expect(list.getByRole('option')).toHaveCount(1) // only the client matches by phone
    await expect(list.getByRole('option', { name: /Fatima Al Mansoori/ })).toBeVisible()
    await input.fill(b!.ref.toLowerCase())
    await expect(list.getByRole('group', { name: 'Bookings' }).getByRole('option')).toHaveCount(1)
    await input.fill('zzqqxx')
    await expect(dialog.getByText('Nothing found for “zzqqxx”.')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })
})

test('security: mask-phones toggle, audit log, and the 2FA policy redirect', async ({ page }) => {
  const { slug, dashboard } = await signUpOwner(page)
  const db = testDb()
  const require2fa = page.getByRole('switch', { name: 'Require 2FA for owner & managers' })
  const save = page.getByRole('button', { name: 'Save security' })

  await test.step('the policy cannot be turned on without your own 2FA', async () => {
    await page.goto(`${dashboard}/settings`)
    await expect(require2fa).toHaveAttribute('aria-checked', 'false')
    await require2fa.click()
    await save.click()
    await expect(page.getByText('Turn on two-step verification for your own account first.')).toBeVisible()
  })

  await test.step('unmasking phones grants therapists clients.phone (tenant override)', async () => {
    await page.reload()
    const mask = page.getByRole('switch', { name: 'Mask client phones for therapists' })
    await expect(mask).toHaveAttribute('aria-checked', 'true')
    await mask.click()
    await save.click()
    await expect(page.getByText('Security settings saved')).toBeVisible()
    const [t] = await db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.slug, slug))
    expect(t!.settings.roleOverrides?.therapist?.grant).toContain('clients.phone')
    await page.reload()
    await expect(mask).toHaveAttribute('aria-checked', 'false')
    await expect(page.getByText('settings.security.updated').first()).toBeVisible() // recent activity
  })

  await test.step('the audit log lists the change with the actor name', async () => {
    await page.getByRole('link', { name: 'View full audit log' }).click()
    await page.waitForURL(`${dashboard}/settings/audit`)
    const row = page.getByRole('row').filter({ hasText: 'settings.security.updated' })
    await expect(row).toContainText('Aisha Rahman')
    await page.getByLabel('Action').selectOption('settings.security.updated')
    await page.getByRole('button', { name: 'Apply' }).click()
    await page.waitForURL(/action=settings\.security\.updated/)
    await expect(page.getByRole('row')).toHaveCount(2) // header + the one entry
  })

  await test.step('with the policy on, an owner without 2FA is sent to set it up', async () => {
    await db
      .update(tenants)
      .set({ settings: sql`${tenants.settings} || '{"require2fa": true}'::jsonb` })
      .where(eq(tenants.slug, slug))
    await page.goto(dashboard)
    await page.waitForURL(/\/account\?require2fa=/)
    await expect(page.getByText(/requires two-step verification/)).toBeVisible()
    // Once 2FA is on (row, not the cached session), the dashboard opens again.
    await db
      .update(user)
      .set({ twoFactorEnabled: true })
      .where(eq(user.email, `owner-${slug}@e2e.test`))
    await page.goto(dashboard)
    await expect(page).toHaveURL(dashboard)
    await expect(page.getByRole('navigation', { name: 'Main menu' })).toBeVisible()
  })
})
