import { expect, test } from '@playwright/test'
import { app, screenshotAt, seedCatalog, signUpOwner } from './helpers'

test('AI studio: configure the receptionist and open the live chat', async ({ page }) => {
  const { slug } = await signUpOwner(page, { plan: 'premium' })
  await seedCatalog(slug)
  await page.goto(`${app}/${slug}/ai`)
  await expect(page.getByRole('heading', { name: 'Your AI team' })).toBeVisible()
  await page.getByRole('button', { name: 'Configure' }).first().click()
  await page.getByLabel('Switched on').check()
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Saved')).toBeVisible()
  await expect(page.getByText('Needs approval').first()).toBeVisible()
  await screenshotAt(page, 'ai-studio')

  await page.getByRole('link', { name: 'Try the receptionist' }).click()
  await expect(page.getByRole('heading', { name: 'Try your AI receptionist' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'How much is a 60 minute massage?' })).toBeVisible()
  await screenshotAt(page, 'ai-try')
})
