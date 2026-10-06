import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { app, screenshotAt, signUpOwner } from './helpers'

const download = async (page: import('@playwright/test').Page, click: () => Promise<void>) => {
  const event = page.waitForEvent('download')
  await click()
  const d = await event
  return { name: d.suggestedFilename(), body: readFileSync((await d.path())!) }
}

test('data: template, CSV import with column mapping, client export and full zip', async ({ page }) => {
  const { slug } = await signUpOwner(page)
  await page.goto(`${app}/${slug}/settings/data`)
  await expect(page.getByRole('heading', { name: 'Import & export', level: 1 })).toBeVisible()
  await expect(page.getByText('No imports yet')).toBeVisible()

  await test.step('download the clients template', async () => {
    const tpl = await download(page, () =>
      page.getByRole('link', { name: 'Download clients template' }).click(),
    )
    expect(tpl.name).toBe('clients-template.csv')
    expect(tpl.body.toString('utf8')).toContain(
      '"Name","Mobile","Gender","Birthday","Tags","Notes","Language"',
    )
  })

  await test.step('upload an Excel-style CSV (BOM, semicolons) and map the unknown column', async () => {
    await page.getByRole('link', { name: 'Import clients' }).click()
    await expect(page.getByRole('heading', { name: 'Import clients', level: 1 })).toBeVisible()
    const csv =
      '﻿First Name;Last Name;Mob;Email;Date of Birth;Tags\r\n' +
      'Mariam;Al Hashimi;050 765 4321;m@example.ae;05/03/1991;vip\r\n' +
      'Hessa;Saeed;+971 55 222 3344;;1990-11-02;\r\n' +
      'Broken;Row;12345;;31/02/1990;\r\n'
    await page
      .getByLabel('CSV file')
      .setInputFiles({ name: 'clients.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
    await expect(page.getByText('Match your columns')).toBeVisible()
    await expect(page.getByLabel('First Name', { exact: true })).toHaveValue('firstName')
    await expect(page.getByLabel('Email', { exact: true })).toHaveValue('email')
    await expect(page.getByLabel('Mob', { exact: true })).toHaveValue('')
    await page.getByLabel('Mob', { exact: true }).selectOption('phone')
    await expect(page.getByText('+971 50 765 4321').first()).toBeVisible()
    await expect(page.getByText('Mariam Al Hashimi').first()).toBeVisible()
    await expect(page.getByText(/3 rows · 1 with errors · 0 already exist/)).toBeVisible()
    await expect(page.getByText(/not a UAE mobile number/).first()).toBeVisible()
    await screenshotAt(page, 'data-import')
  })

  await test.step('import: 2 created, 1 error with a downloadable error CSV', async () => {
    await page.getByRole('button', { name: 'Import 2 clients' }).click()
    await expect(page.getByRole('heading', { name: 'Import finished' })).toBeVisible()
    await expect(page.getByText('Row 4', { exact: true })).toBeVisible()
    const errors = await download(page, () =>
      page.getByRole('button', { name: 'Download error CSV' }).click(),
    )
    const text = errors.body.toString('utf8')
    expect(text).toContain('"Row","First Name","Last Name","Mob","Email","Date of Birth","Tags","Error"')
    expect(text).toContain('"4","Broken","Row","12345"')
  })

  await test.step('the clients are in the list', async () => {
    await page.getByRole('link', { name: 'View clients' }).click()
    await expect(page.getByRole('link', { name: /Mariam Al Hashimi/ }).first()).toBeVisible()
    await expect(page.getByRole('link', { name: /Hessa Saeed/ }).first()).toBeVisible()
    await expect(page.getByText('+971 50 765 4321').first()).toBeVisible()
  })

  await test.step('history, client CSV export and full zip', async () => {
    await page.goto(`${app}/${slug}/settings/data`)
    await expect(page.getByText('clients.csv').first()).toBeVisible()
    await expect(page.getByText('2 new · 0 updated · 0 skipped').first()).toBeVisible()
    await screenshotAt(page, 'data')

    await page.getByLabel('What to export').selectOption('clients')
    const csv = await download(page, () => page.getByRole('button', { name: 'Download CSV' }).click())
    const body = csv.body.toString('utf8')
    expect(body.startsWith('﻿"Name","Mobile","Gender","Birthday","Language","Tags"')).toBe(true)
    expect(body).toContain('"Mariam Al Hashimi","050 765 4321","","1991-03-05","en","vip"')

    const zip = await download(page, () => page.getByRole('link', { name: 'Download .zip' }).click())
    expect(zip.name).toMatch(new RegExp(`^${slug}-export-\\d{4}-\\d{2}-\\d{2}\\.zip$`))
    expect(zip.body.subarray(0, 2).toString()).toBe('PK')
  })
})
