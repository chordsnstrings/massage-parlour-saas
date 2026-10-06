import { expect, test } from '@playwright/test'
import { enqueueBookingMessage } from '@spa/services'
import { app, screenshotAt, seedBooking, seedCatalog, signUpOwner, testDb } from './helpers'

test('whatsapp outbox: send a confirmation, skip a reminder by keyboard, edit a template', async ({
  page,
}) => {
  const { slug } = await signUpOwner(page)
  const seed = await seedCatalog(slug)
  const booking = await seedBooking(seed)
  await testDb().transaction(async (tx) => {
    await enqueueBookingMessage(tx, booking.id, 'booking_confirmation')
    await enqueueBookingMessage(tx, booking.id, 'reminder', new Date(Date.now() + 3600_000))
  })

  await page.goto(`${app}/${slug}/messages`)
  await expect(page.getByRole('heading', { name: 'WhatsApp', exact: true })).toBeVisible()
  const card = page.getByRole('article', { name: 'Confirmation for Fatima Al Mansoori' })
  await expect(card).toBeVisible()
  await expect(card.getByText(/Swedish massage at Serenity Spa is confirmed/)).toBeVisible()
  await expect(card.getByRole('button', { name: /Open in WhatsApp/ })).toBeVisible()
  await expect(page.getByText('Send responsibly')).toBeVisible()
  await screenshotAt(page, 'messages')

  await card.getByRole('button', { name: 'Mark sent' }).click()
  await expect(page.getByText('Marked as sent · Fatima Al Mansoori')).toBeVisible()
  await expect(page.getByText('All caught up')).toBeVisible()

  await page.getByRole('link', { name: /Sent/ }).first().click()
  await expect(page.getByRole('article', { name: 'Confirmation for Fatima Al Mansoori' })).toBeVisible()
  await expect(page.getByText(/by Aisha Rahman/)).toBeVisible()

  // Scheduled reminder: skip it with the keyboard.
  await page.getByRole('link', { name: /Scheduled/ }).click()
  await expect(page.getByRole('article', { name: 'Reminder for Fatima Al Mansoori' })).toBeVisible()
  await page.keyboard.press('x')
  await expect(page.getByText('Skipped · Fatima Al Mansoori')).toBeVisible()
  await expect(page.getByText('Nothing scheduled')).toBeVisible()

  await page.goto(`${app}/${slug}/messages/templates`)
  await expect(page.getByRole('heading', { name: 'Message templates' })).toBeVisible()
  await page.getByRole('button', { name: 'Reminder' }).click()
  const english = page.getByLabel('English')
  await english.fill('Hello  see you {day} at {time}.')
  await english.press('Home')
  for (let i = 0; i < 6; i++) await english.press('ArrowRight')
  await page.getByRole('button', { name: '{first_name}' }).click()
  await expect(page.getByTestId('preview-en')).toContainText('Hello Fatima see you')
  await expect(page.getByTestId('preview-ar')).toContainText('فاطمة')
  await screenshotAt(page, 'messages-templates')
  await page.getByRole('button', { name: 'Save template' }).click()
  await expect(page.getByText('Template saved')).toBeVisible()
  await expect(page.getByText('Customised')).toBeVisible()
})
