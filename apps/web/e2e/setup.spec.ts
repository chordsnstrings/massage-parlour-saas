import { expect, test } from '@playwright/test'
import { branches, staff, tenants } from '@spa/db'
import { eq } from 'drizzle-orm'
import { screenshotAt, signUpOwner, testDb } from './helpers'

test('owner sets up menu, rooms, a therapist with shifts and opening hours', async ({ page }) => {
  const { slug, dashboard } = await signUpOwner(page)

  await test.step('sample UAE menu fills services and rooms', async () => {
    await page.goto(`${dashboard}/services`)
    await expect(page.getByText('No services yet')).toBeVisible()
    await page.getByRole('button', { name: 'Add a sample UAE spa menu' }).click()
    await expect(page.getByText('Couples Swedish massage', { exact: true })).toBeVisible()
    await expect(page.getByText('Deep tissue massage', { exact: true })).toBeVisible()
    await expect(
      page
        .getByText('90 min · AED 480.00')
        .or(page.getByText(/90 min · AED\s?480/))
        .first(),
    ).toBeVisible()
    await expect(page.getByText('2 therapists')).toBeVisible()
    await expect(page.getByText('Couples suite')).toBeVisible()
    await expect(page.getByText('Room 1')).toBeVisible()
  })

  await test.step('add a bilingual service with two durations', async () => {
    await page.getByRole('button', { name: 'Add service' }).first().click()
    const sheet = page.getByRole('dialog')
    await sheet.getByLabel('Name (English)').fill('Head & shoulders')
    await sheet.getByLabel('Name (Arabic)').fill('الرأس والكتفين')
    await expect(sheet.getByLabel('Name (Arabic)')).toHaveAttribute('dir', 'rtl')
    await sheet.getByLabel('Duration 1 (minutes)').fill('30')
    await sheet.getByLabel('Price 1 (AED)').fill('180')
    await sheet.getByLabel('Duration 2 (minutes)').fill('45')
    await sheet.getByLabel('Price 2 (AED)').fill('240')
    await sheet.getByRole('button', { name: 'Add service' }).click()
    await expect(sheet).toBeHidden()
    await expect(page.getByText('Head & shoulders', { exact: true })).toBeVisible()
    await expect(page.getByText(/45 min · AED\s?240/)).toBeVisible()
  })

  await screenshotAt(page, 'setup')

  await test.step('create a therapist with skills', async () => {
    await page.goto(`${dashboard}/staff`)
    await expect(page.getByText('No therapists yet')).toBeVisible()
    await page.getByRole('button', { name: 'Add therapist' }).first().click()
    const sheet = page.getByRole('dialog')
    await sheet.getByLabel('Display name').fill('Maya')
    await sheet.getByLabel('Gender').selectOption('female')
    await sheet.getByLabel('UAE mobile').fill('050 765 4321')
    await sheet.getByLabel('Commission').fill('12.5')
    await sheet.getByLabel('Base salary').fill('3500')
    // Skills default to every active service; Maya doesn't do the Moroccan bath.
    await sheet.getByText('Moroccan bath', { exact: true }).click()
    await sheet.getByRole('button', { name: 'Add therapist' }).click()
    await page.waitForURL(/\/staff\/[0-9a-f-]{36}$/)
    await expect(page.getByRole('heading', { name: 'Maya' })).toBeVisible()
    await expect(page.getByText('+971507654321')).toBeVisible()
    await expect(page.getByText('7 of 8 services')).toBeVisible()
  })

  await test.step('generate shifts from a weekly pattern (one past midnight)', async () => {
    await page.getByLabel('Works on Friday').uncheck()
    await page.getByLabel('Monday start').fill('16:00')
    await page.getByLabel('Monday end').fill('02:00')
    await expect(page.getByText('next day')).toBeVisible()
    await page.getByRole('button', { name: 'Generate shifts' }).click()
    await expect(page.getByText(/\d+ shifts added/)).toBeVisible()
    const list = page.getByRole('list', { name: 'Upcoming shifts' })
    await expect(list.getByRole('listitem').first()).toBeVisible()
    expect(await list.getByRole('listitem').count()).toBeGreaterThanOrEqual(11)
    await expect(list.getByText('16:00–02:00').first()).toBeVisible()
    await expect(list.getByText('+1 day').first()).toBeVisible()
    await expect(list.getByText(/^Fri /)).toHaveCount(0)

    // Same pattern again: every shift overlaps → friendly error from the EXCLUDE constraint.
    await page.getByRole('button', { name: 'Generate shifts' }).click()
    await expect(page.getByText(/overlap shifts this therapist already has/)).toBeVisible()

    const before = await list.getByRole('listitem').count()
    await list
      .getByRole('button', { name: /Delete shift/ })
      .first()
      .click()
    await expect(list.getByRole('listitem')).toHaveCount(before - 1)
  })

  await screenshotAt(page, 'setup-staff')

  await test.step('staff list shows the therapist card', async () => {
    await page.goto(`${dashboard}/staff`)
    await expect(page.getByRole('link', { name: /Maya/ })).toBeVisible()
    await expect(page.getByText(/Female · 7 services/)).toBeVisible()
  })

  await test.step('opening hours: closed Friday, late-night Saturday split', async () => {
    await page.goto(`${dashboard}/settings`)
    await page.getByRole('link', { name: /Opening hours/ }).click()
    await expect(page.getByRole('heading', { name: 'Opening hours' })).toBeVisible()
    await page.getByRole('button', { name: 'Remove Friday interval 1' }).click()
    await page.getByLabel('Saturday closes 1').fill('16:00')
    await page.getByRole('button', { name: 'Add hours on Saturday' }).click()
    await expect(page.getByText('closes after midnight').first()).toBeVisible()
    await page.getByLabel('Monday opens 1').fill('11:00')
    await page.getByRole('button', { name: 'Save hours' }).click()
    await expect(page.getByText('Opening hours saved')).toBeVisible()
    await screenshotAt(page, 'setup-hours')

    const db = testDb()
    const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, slug))
    const [branch] = await db.select().from(branches).where(eq(branches.tenantId, tenant!.id))
    expect(branch!.openingHours.fri).toEqual([])
    expect(branch!.openingHours.mon).toEqual([{ open: '11:00', close: '00:00' }])
    expect(branch!.openingHours.sat).toEqual([
      { open: '10:00', close: '16:00' },
      { open: '18:00', close: '02:00' },
    ])
    const people = await db.select().from(staff).where(eq(staff.tenantId, tenant!.id))
    expect(people.map((p) => [p.displayName, p.commissionPct])).toEqual([['Maya', '12.50']])
  })
})
