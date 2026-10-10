import { expect, test } from '@playwright/test'
import { businessDateOf, dubaiInstant } from '@spa/core'
import {
  bookings,
  branches,
  clients,
  memberBranches,
  members,
  roles,
  rooms,
  sales,
  shifts,
  tenants,
  user,
} from '@spa/db'
import { createSale } from '@spa/services'
import { and, eq } from 'drizzle-orm'
import { app, screenshotAt, seedCatalog, signUpOwner, site, testDb } from './helpers'

test('owner adds a second branch, scopes a receptionist to it, and a client books there online (G22)', async ({
  page,
}) => {
  const { slug } = await signUpOwner(page, { spa: 'Twin Spa' })
  const seed = await seedCatalog(slug)
  const db = testDb()

  // Settings → Branches: add "JLT".
  await page.goto(`${app}/${slug}/settings/branches`)
  await expect(page.getByRole('heading', { name: 'Branches', level: 1 })).toBeVisible()
  await page.getByRole('button', { name: 'Add branch' }).click()
  await page.getByLabel('Branch name').fill('JLT')
  await page.getByLabel('Address').fill('Cluster D, JLT')
  await page.getByLabel('Business day ends at').fill('04:00')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('branch-name').filter({ hasText: 'JLT' })).toBeVisible()
  await screenshotAt(page, 'settings-branches')
  const [jlt] = await db
    .select()
    .from(branches)
    .where(and(eq(branches.tenantId, seed.tenantId), eq(branches.name, 'JLT')))
  expect(jlt).toMatchObject({ address: 'Cluster D, JLT', isDefault: false, active: true })
  expect(jlt!.businessDayCutoff.slice(0, 5)).toBe('04:00')
  expect(Object.keys(jlt!.openingHours)).toHaveLength(7) // copied from the main branch

  // Team: a receptionist works only at JLT.
  const now = new Date()
  await db.insert(user).values({
    id: `u-${slug}`,
    name: 'Rana Front Desk',
    email: `rana-${slug}@example.com`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  const [rec] = await db
    .select()
    .from(roles)
    .where(and(eq(roles.tenantId, seed.tenantId), eq(roles.key, 'receptionist')))
  const [member] = await db
    .insert(members)
    .values({ tenantId: seed.tenantId, userId: `u-${slug}`, roleId: rec!.id })
    .returning()
  await page.goto(`${app}/${slug}/team`)
  const row = page.getByRole('row', { name: /Rana Front Desk/ })
  await expect(row.getByText('All branches')).toBeVisible()
  await row.getByRole('button', { name: 'Edit' }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByLabel('All branches').uncheck()
  await sheet.getByLabel('JLT').check()
  await sheet.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('row', { name: /Rana Front Desk/ }).getByText('JLT')).toBeVisible()
  expect(await db.select().from(memberBranches).where(eq(memberBranches.memberId, member!.id))).toEqual([
    { tenantId: seed.tenantId, memberId: member!.id, branchId: jlt!.id },
  ])
  const [scoped] = await db.select().from(members).where(eq(members.id, member!.id))
  expect(scoped!.allBranches).toBe(false)

  // JLT gets a room and Ploy works there tomorrow.
  // The booking page's "Tomorrow" follows JLT's own day cutoff (04:00), not the default 05:00 (they differ 04:00–05:00).
  const tomorrow = businessDateOf(new Date(Date.now() + 24 * 3600_000), jlt!.businessDayCutoff.slice(0, 5))
  await db.insert(rooms).values({ tenantId: seed.tenantId, branchId: jlt!.id, name: 'JLT Room' })
  await db.delete(shifts).where(eq(shifts.staffId, seed.staffIds[1]!))
  await db.insert(shifts).values({
    tenantId: seed.tenantId,
    staffId: seed.staffIds[1]!,
    branchId: jlt!.id,
    startsAt: dubaiInstant(tomorrow, 5 * 60),
    endsAt: dubaiInstant(tomorrow, 29 * 60),
  })

  // Public booking page: choose JLT, then book.
  await page.goto(`${site(slug)}/book`)
  await page.getByLabel('Branch').selectOption(jlt!.id)
  await expect(page).toHaveURL(new RegExp(`branch=${jlt!.id}`))
  const swedish = page.getByRole('region', { name: 'Swedish massage' })
  await swedish.getByRole('button', { name: /60 min/ }).click()
  await page.getByRole('button', { name: /^Tomorrow/ }).click()
  const firstTime = page.getByTestId('slots').getByRole('button').first()
  await expect(firstTime).toBeVisible()
  await firstTime.click()
  await page.getByLabel('Your name').fill('Layla Branch')
  await page.getByLabel('UAE mobile').fill('050 765 4321')
  await page.getByRole('button', { name: 'Request booking' }).click()
  await expect(page.getByRole('heading', { name: 'Booking requested' })).toBeVisible()
  const ref = (await page.getByTestId('booking-ref').textContent())?.trim() ?? ''
  const [booked] = await db
    .select({ branchId: bookings.branchId })
    .from(bookings)
    .where(and(eq(bookings.tenantId, seed.tenantId), eq(bookings.refCode, ref)))
  expect(booked?.branchId).toBe(jlt!.id)

  // The dashboard overview offers the branch picker now that there are two.
  await page.goto(`${app}/${slug}`)
  await expect(page.getByRole('link', { name: 'All branches' })).toBeVisible()
  await page.getByRole('link', { name: 'JLT' }).click()
  await expect(page).toHaveURL(new RegExp(`branch=${jlt!.id}`))
})

test('staff issue a full tax invoice with the customer’s billing details (G16)', async ({ page }) => {
  const { slug } = await signUpOwner(page, { spa: 'Invoice Spa' })
  const seed = await seedCatalog(slug)
  const db = testDb()
  await db
    .update(tenants)
    .set({ legalName: 'Invoice Spa LLC', trn: '100111222333444' })
    .where(eq(tenants.id, seed.tenantId))
  const { sale } = await db.transaction((tx) =>
    createSale(tx, {
      tenantId: seed.tenantId,
      branchId: seed.branchId,
      clientId: seed.clientId,
      lines: [
        {
          kind: 'service',
          description: 'Swedish massage 60 min',
          qty: 2,
          unitPriceAed: 350,
          discountAed: 50,
        },
      ],
      payments: [{ method: 'card_terminal', amountAed: 650 }],
    }),
  )

  await page.goto(`${app}/${slug}/sales/${sale.id}`)
  await page.getByRole('link', { name: 'Full tax invoice' }).click()
  await expect(page.getByRole('heading', { name: 'Tax invoice', level: 1 })).toBeVisible()
  await expect(page.getByText('Add the customer’s billing details')).toBeVisible()
  await page.getByLabel('Billing name').fill('Gulf Trading LLC')
  await page.getByLabel('Billing address').fill('Office 501, Bay Square, Business Bay, Dubai')
  await page.getByLabel('Customer TRN').fill('12345')
  await page.getByRole('button', { name: 'Save billing details' }).click()
  await expect(page.getByText('A TRN has 15 digits').first()).toBeVisible()
  await page.getByLabel('Customer TRN').fill('100 2223 3344 4555')
  await page.getByRole('button', { name: 'Save billing details' }).click()

  const invoice = page.locator('#invoice')
  await expect(invoice.getByTestId('invoice-customer')).toHaveText('Gulf Trading LLC')
  await expect(invoice.getByTestId('invoice-customer-trn')).toContainText('100222333444555')
  await expect(invoice.getByText('Tax Invoice')).toBeVisible()
  await expect(invoice.getByText('فاتورة ضريبية')).toBeVisible()
  await expect(invoice.getByText('100111222333444')).toBeVisible()
  await expect(invoice.getByTestId('invoice-number')).toHaveText(String(sale.number))
  await expect(invoice.getByTestId('invoice-total')).toContainText('650')
  await expect(invoice.getByRole('cell', { name: 'AED 619.05' })).toBeVisible() // taxable amount: 650 − 30.95 VAT
  await screenshotAt(page, 'tax-invoice')

  const [saved] = await db.select().from(sales).where(eq(sales.id, sale.id))
  const [client] = await db.select().from(clients).where(eq(clients.id, seed.clientId))
  const billing = {
    name: 'Gulf Trading LLC',
    address: 'Office 501, Bay Square, Business Bay, Dubai',
    trn: '100222333444555',
  }
  expect(saved!.billing).toEqual(billing)
  expect(client!.billing).toEqual(billing)
})
