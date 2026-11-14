import { expect, test } from '@playwright/test'
import { app, screenshotAt, seedBooking, seedCatalog, signUpOwner } from './helpers'

test('whatsapp outbox: send a confirmation, skip the reminders by keyboard, edit a template', async ({
  page,
}) => {
  const { slug } = await signUpOwner(page)
  const seed = await seedCatalog(slug)
  // A confirmed booking 30 h out: confirmation now, reminders 24 h and 2 h before (planned by createBooking, G4).
  await seedBooking(seed, 30)

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

  // Scheduled reminders (day before, then 2 h before): skip both with the keyboard.
  await page.getByRole('link', { name: /Scheduled/ }).click()
  await expect(page.getByRole('article', { name: 'Reminder for Fatima Al Mansoori' })).toBeVisible()
  await expect(page.getByRole('article', { name: 'Reminder (2 h) for Fatima Al Mansoori' })).toBeVisible()
  await page.keyboard.press('x')
  await expect(page.getByText('Skipped · Fatima Al Mansoori')).toBeVisible()
  await expect(page.getByRole('article', { name: 'Reminder for Fatima Al Mansoori' })).toHaveCount(0)
  await page.keyboard.press('x')
  await expect(page.getByText('Nothing scheduled')).toBeVisible()

  await page.goto(`${app}/${slug}/messages/templates`)
  await expect(page.getByRole('heading', { name: 'Message templates' })).toBeVisible()
  await page.getByRole('button', { name: 'Reminder', exact: true }).click()
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
