import { expect, test } from '@playwright/test'
import { dubaiInstant } from '@spa/core'
import { app, screenshotAt, seedBooking, seedCatalog, signUpOwner, today } from './helpers'

test('reception works the day calendar: check in, then book a client into a free slot', async ({ page }) => {
  const { slug } = await signUpOwner(page)
  const seed = await seedCatalog(slug)
  // Fixed clock time: the drag step below relies on Maya being busy 14:15–15:15 (+15 min cleanup).
  await seedBooking(seed, '14:15')

  await test.step('today shows the booking in Maya’s column', async () => {
    await page.goto(`${app}/${slug}/calendar`)
    await expect(page.getByRole('heading', { name: 'Calendar', level: 1 })).toBeVisible()
    const maya = page.getByRole('group', { name: 'Maya' })
    await expect(maya.getByRole('button', { name: /Fatima Al Mansoori/ })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Walk-ins' })).toBeVisible()
  })

  await test.step('open the booking and check the client in', async () => {
    await page
      .getByRole('group', { name: 'Maya' })
      .getByRole('button', { name: /Fatima Al Mansoori/ })
      .click()
    const sheet = page.getByRole('dialog')
    await expect(sheet.getByRole('heading', { name: 'Fatima Al Mansoori' })).toBeVisible()
    await expect(sheet.getByText('Confirmed', { exact: true })).toBeVisible()
    await sheet.getByRole('button', { name: 'Check in' }).click()
    await expect(sheet.getByText('Checked in', { exact: true })).toBeVisible()
    await expect(sheet.getByRole('link', { name: 'Check out' })).toHaveAttribute(
      'href',
      /sales\/new\?booking=/,
    )
    await page.keyboard.press('Escape')
    await expect(sheet).toBeHidden()
  })

  await test.step('click a free slot and book Fatima with Ploy', async () => {
    await page.getByRole('button', { name: 'New booking with Ploy at 15:00' }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet.getByRole('heading', { name: 'New booking' })).toBeVisible()
    await expect(sheet.getByLabel('Time')).toHaveValue('15:00')
    await sheet.getByLabel('Client').fill('Fati')
    await sheet.getByRole('button', { name: /Fatima Al Mansoori/ }).click()
    await sheet.getByLabel('Source').selectOption('whatsapp')
    await sheet.getByRole('button', { name: 'Create booking' }).click()
    await expect(sheet.getByRole('heading', { name: 'Booking confirmed' })).toBeVisible()
    await expect(sheet.getByRole('link', { name: 'Send confirmation on WhatsApp' })).toHaveAttribute(
      'href',
      /971501234567/,
    )
    await sheet.getByRole('button', { name: 'Done' }).click()
    await expect(
      page.getByRole('group', { name: 'Ploy' }).getByRole('button', { name: /Fatima Al Mansoori/ }),
    ).toBeVisible()
  })

  await test.step('drag: a clash rolls back, a free time sticks', async () => {
    const ploy = page.getByRole('group', { name: 'Ploy' })
    const maya = page.getByRole('group', { name: 'Maya' })
    const block = ploy.getByRole('button', { name: /15:00–16:00 Fatima Al Mansoori/ })
    await block.evaluate((el) => el.scrollIntoView({ block: 'center' }))
    const drag = async (dx: number, dy: number) => {
      const box = (await block.boundingBox())!
      const x = box.x + box.width / 2
      const y = box.y + 12
      await page.mouse.move(x, y)
      await page.mouse.down()
      await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 6 })
      await page.mouse.move(x + dx, y + dy, { steps: 6 })
      await page.mouse.up()
    }
    const colWidth = (await ploy.boundingBox())!.width
    // Maya is with Fatima until 15:15 (+15 min cleanup) — moving there must fail and snap back.
    await drag(-colWidth, 0)
    await expect(page.getByText(/clashes with another booking/)).toBeVisible()
    await expect(block).toBeVisible()
    await expect(maya.getByRole('button', { name: /Fatima Al Mansoori/ })).toHaveCount(1)
    // One hour later (72 px per hour) is free.
    await drag(0, 72)
    await expect(page.getByText(/moved to 16:00/)).toBeVisible()
    await expect(ploy.getByRole('button', { name: /16:00–17:00 Fatima Al Mansoori/ })).toBeVisible()
  })

  await page.reload()
  await page.mouse.move(0, 0)
  await expect(page.getByRole('group', { name: 'Ploy' })).toBeVisible()
  await screenshotAt(page, 'calendar')
})

test('walk-ins follow the rotation; rooms view; cancelled bookings hide behind a toggle', async ({
  page,
}) => {
  const { slug } = await signUpOwner(page)
  const seed = await seedCatalog(slug)
  // Keep the booking inside today's business day (05:00 → 05:00 Dubai): 2 h ahead while that (plus its length)
  // still fits, otherwise 3 h ago — late at night "+2 h" would land on the next business day.
  const dayEnd = dubaiInstant(today(), 29 * 60).getTime()
  await seedBooking(seed, Date.now() + 4 * 3600_000 <= dayEnd ? 2 : -3)
  await page.goto(`${app}/${slug}/calendar`)
  const panel = page.locator('section', { has: page.getByRole('heading', { name: 'Walk-ins' }) })
  await expect(panel.locator('[aria-current="true"]')).toContainText('Maya')

  await test.step('walk-in goes to the next free therapist and moves her to the back', async () => {
    await page.getByRole('button', { name: 'Walk-in' }).first().click()
    const sheet = page.getByRole('dialog')
    await expect(sheet.getByLabel('Therapist')).toContainText('Next in rotation (Maya)')
    await sheet.getByLabel('Name').fill('Sara')
    await sheet.getByRole('button', { name: 'Start walk-in' }).click()
    await expect(page.getByText('Walk-in checked in with Maya')).toBeVisible()
    await expect(sheet).toBeHidden()
    await expect(
      page.getByRole('group', { name: 'Maya' }).getByRole('button', { name: /Sara/ }),
    ).toBeVisible()
    await expect(panel.locator('[aria-current="true"]')).toContainText('Ploy')
  })

  await test.step('rooms view shows the booking in its room; cancelling hides it', async () => {
    await page.getByRole('button', { name: 'Rooms' }).click()
    const room1 = page.getByRole('group', { name: 'Room 1' })
    await room1.getByRole('button', { name: /Fatima Al Mansoori/ }).click()
    const sheet = page.getByRole('dialog')
    await sheet.getByRole('button', { name: 'Cancel…' }).click()
    await sheet.getByLabel('Cancellation reason').fill('Client is travelling')
    await sheet.getByRole('button', { name: 'Cancel booking' }).click()
    await expect(sheet.getByText('Cancelled', { exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(room1.getByRole('button', { name: /Fatima Al Mansoori/ })).toHaveCount(0)
    await page.getByLabel(/Show cancelled/).check()
    await expect(room1.getByRole('button', { name: /Fatima Al Mansoori/ })).toBeVisible()
  })
})
