import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { app, ExcelJS, openXlsx, screenshotAt, sheetRows, signUpOwner } from './helpers'

const download = async (page: import('@playwright/test').Page, click: () => Promise<void>) => {
  const event = page.waitForEvent('download')
  await click()
  const d = await event
  return { name: d.suggestedFilename(), body: readFileSync((await d.path())!) }
}

test('data: xlsx template, CSV + xlsx import with column mapping, xlsx client export and full workbook', async ({
  page,
}) => {
  const { slug } = await signUpOwner(page)
  await page.goto(`${app}/${slug}/settings/data`)
  await expect(page.getByRole('heading', { name: 'Import & export', level: 1 })).toBeVisible()
  await expect(page.getByText('No imports yet')).toBeVisible()

  await test.step('download the clients template', async () => {
    const tpl = await download(page, () =>
      page.getByRole('link', { name: 'Download clients template' }).click(),
    )
    expect(tpl.name).toBe('clients-template.xlsx')
    const ws = (await openXlsx(tpl.body)).worksheets[0]!
    expect(sheetRows(ws)[3]).toEqual(['Name', 'Mobile', 'Gender', 'Birthday', 'Tags', 'Notes', 'Language'])
    expect(ws.getCell('A4').font?.bold).toBe(true)
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
      .getByLabel('Excel or CSV file')
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

  await test.step('import: 2 created, 1 error with a downloadable error workbook', async () => {
    await page.getByRole('button', { name: 'Import 2 clients' }).click()
    await expect(page.getByRole('heading', { name: 'Import finished' })).toBeVisible()
    await expect(page.getByText('Row 4', { exact: true })).toBeVisible()
    const errors = await download(page, () =>
      page.getByRole('button', { name: 'Download error file' }).click(),
    )
    expect(errors.name).toBe('clients-import-errors.xlsx')
    const rows = sheetRows((await openXlsx(errors.body)).worksheets[0]!)
    expect(rows[3]).toEqual([
      'Row',
      'First Name',
      'Last Name',
      'Mob',
      'Email',
      'Date of Birth',
      'Tags',
      'Error',
    ])
    expect(rows[4]?.slice(0, 4)).toEqual([4, 'Broken', 'Row', '12345'])
  })

  await test.step('the clients are in the list', async () => {
    await page.getByRole('link', { name: 'View clients' }).click()
    await expect(page.getByRole('link', { name: /Mariam Al Hashimi/ }).first()).toBeVisible()
    await expect(page.getByRole('link', { name: /Hessa Saeed/ }).first()).toBeVisible()
    await expect(page.getByText('+971 50 765 4321').first()).toBeVisible()
  })

  await test.step('an .xlsx upload is read from its first sheet (title rows skipped)', async () => {
    await page.goto(`${app}/${slug}/settings/data/import/clients`)
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Clients')
    ws.addRow(['My old system'])
    ws.addRow([])
    ws.addRow(['Name', 'Mobile', 'Birthday'])
    ws.addRow(['Layla Rahman', 971504441122, new Date(Date.UTC(1993, 6, 9))])
    await page.getByLabel('Excel or CSV file').setInputFiles({
      name: 'clients.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from(await wb.xlsx.writeBuffer()),
    })
    await expect(page.getByText('Match your columns')).toBeVisible()
    await expect(page.getByLabel('Mobile', { exact: true })).toHaveValue('phone')
    await expect(page.getByText('+971 50 444 1122').first()).toBeVisible()
    await expect(page.getByText(/1 row · 0 with errors · 0 already exist/)).toBeVisible()
  })

  await test.step('history, client Excel export and full workbook', async () => {
    await page.goto(`${app}/${slug}/settings/data`)
    await expect(page.getByText('clients.csv').first()).toBeVisible()
    await expect(page.getByText('2 new · 0 updated · 0 skipped').first()).toBeVisible()
    await screenshotAt(page, 'data')

    await page.getByLabel('What to export').selectOption('clients')
    const xlsx = await download(page, () => page.getByRole('button', { name: 'Download Excel' }).click())
    expect(xlsx.name).toMatch(/^clients-.+\.xlsx$/)
    const sheet = (await openXlsx(xlsx.body)).worksheets[0]!
    expect(String(sheet.getCell('A1').value)).toMatch(/ — Clients$/)
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 4 })
    const rows = sheetRows(sheet)
    expect(rows[3]?.slice(0, 6)).toEqual(['Name', 'Mobile', 'Gender', 'Birthday', 'Language', 'Tags'])
    const mariam = rows.find((r) => r[0] === 'Mariam Al Hashimi')!
    expect(mariam[1]).toBe('050 765 4321')
    expect(mariam[3]).toEqual(new Date('1991-03-05T00:00:00Z'))
    expect(mariam[5]).toBe('vip')

    const full = await download(page, () => page.getByRole('link', { name: 'Download .xlsx' }).click())
    expect(full.name).toMatch(new RegExp(`^${slug}-export-\\d{4}-\\d{2}-\\d{2}\\.xlsx$`))
    const book = await openXlsx(full.body)
    expect(book.worksheets[0]!.name).toBe('README')
    expect(book.getWorksheet('clients')).toBeTruthy()
  })
})
