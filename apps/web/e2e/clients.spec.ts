import { expect, test } from '@playwright/test'
import { app, screenshotAt, seedBooking, seedCatalog, signUpOwner } from './helpers'

test('client profile: preferences, treatment note, intake template and a signed intake', async ({ page }) => {
  const { slug } = await signUpOwner(page)
  const seed = await seedCatalog(slug)
  await seedBooking(seed)

  await test.step('the list shows Fatima with her number and is searchable', async () => {
    await page.goto(`${app}/${slug}/clients`)
    await expect(page.getByRole('heading', { name: 'Clients', level: 1 })).toBeVisible()
    await expect(page.getByRole('link', { name: /Fatima Al Mansoori/ }).first()).toBeVisible()
    await expect(page.getByText('+971 50 123 4567').first()).toBeVisible()
    await page.getByLabel('Search clients').fill('zzz')
    await expect(page.getByText('No matching clients')).toBeVisible()
    await page.getByLabel('Search clients').fill('4567')
    await expect(page.getByRole('link', { name: /Fatima Al Mansoori/ }).first()).toBeVisible()
    await page.getByLabel('Search clients').fill('')
    await expect(page).toHaveURL(new RegExp(`/${slug}/clients$`))
    await screenshotAt(page, 'clients')
  })

  await test.step('open Fatima: the booking is in her visit history', async () => {
    await page
      .getByRole('link', { name: /Fatima Al Mansoori/ })
      .first()
      .click()
    await expect(page.getByRole('heading', { name: /Fatima Al Mansoori/, level: 1 })).toBeVisible()
    await expect(page.getByTestId('visit-history')).toContainText('Swedish massage · 60 min')
    await expect(page.getByTestId('visit-history')).toContainText('Confirmed')
  })

  await test.step('set preferences', async () => {
    await page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Preferences' }) })
      .getByRole('button', { name: 'Edit' })
      .click()
    const sheet = page.getByRole('dialog')
    await sheet.getByLabel('Pressure').selectOption('Firm')
    await sheet.getByLabel('Preferred therapist').selectOption({ label: 'Maya' })
    await sheet.getByLabel('Allergies').fill('Nut oils')
    await sheet.getByLabel('Focus areas').fill('Shoulders and lower back')
    await sheet.getByRole('button', { name: 'Save' }).click()
    await expect(sheet).toBeHidden()
    const prefs = page.getByTestId('preferences')
    await expect(prefs).toContainText('Firm')
    await expect(prefs).toContainText('Nut oils')
    await expect(prefs).toContainText('Maya')
  })

  await test.step('add a treatment note', async () => {
    await page.getByLabel('New note').fill('Tight trapezius; used deep tissue on the left shoulder.')
    await page.getByRole('button', { name: 'Add note' }).click()
    await expect(page.getByTestId('treatment-notes')).toContainText('Tight trapezius')
    await expect(page.getByLabel('New note')).toHaveValue('')
  })

  await test.step('create the recommended intake template', async () => {
    await page.goto(`${app}/${slug}/settings/intake`)
    await expect(page.getByRole('heading', { name: 'Intake & waiver', level: 1 })).toBeVisible()
    await page.getByRole('button', { name: 'Use recommended template' }).click()
    await expect(page.getByText(/Version 1 ·/)).toBeVisible()
    await expect(page.getByTestId('intake-question')).toHaveCount(8)
    await expect(page.getByLabel('Waiver (English)')).toHaveValue(/I confirm that the information/)
    await screenshotAt(page, 'intake-settings')
  })

  await test.step('sign an intake on the tablet', async () => {
    await page.goto(`${app}/${slug}/clients/${seed.clientId}`)
    await page.getByRole('link', { name: 'Sign intake' }).click()
    await expect(page.getByRole('heading', { name: 'Massage intake & consent' })).toBeVisible()
    for (const q of [/pregnant/, /surgery or an injury/, /high blood pressure/, /skin conditions/]) {
      await page.getByRole('group', { name: q }).getByText('No', { exact: true }).click()
    }
    await page
      .getByRole('group', { name: /Preferred pressure/ })
      .getByText('Firm')
      .click()
    await page
      .getByRole('group', { name: /Allergies/ })
      .getByRole('textbox')
      .fill('Nut oils')
    await page.getByLabel('I have read and accept the above').check()

    // Submitting unsigned keeps the answers and asks for a signature.
    await page.getByRole('button', { name: 'Sign and submit' }).click()
    await expect(page.getByText('Please sign in the box')).toBeVisible()
    await expect(
      page.getByRole('group', { name: /pregnant/ }).getByRole('radio', { name: 'No' }),
    ).toBeChecked()

    const box = (await page.getByTestId('signature-pad').boundingBox())!
    await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.6)
    await page.mouse.down()
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(
        box.x + box.width * (0.15 + i * 0.05),
        box.y + box.height * (0.6 - Math.sin(i / 2) * 0.25),
        { steps: 2 },
      )
    }
    await page.mouse.up()
    await screenshotAt(page, 'intake-form')
    await page.getByRole('button', { name: 'Sign and submit' }).click()

    await expect(page).toHaveURL(/\/intake\/[0-9a-f-]{36}$/)
    await expect(page.getByRole('heading', { name: 'Consent', exact: true })).toBeVisible()
    await expect(page.getByTestId('signature').locator('path')).toHaveAttribute('d', /^M[\d.]+ [\d.]+ L/)
    await expect(page.getByText('Nut oils')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Print' })).toBeVisible()
  })

  await test.step('F27: the signed PDF is stored and downloadable (private, with the record hash)', async () => {
    const link = page.getByTestId('intake-pdf-download')
    await expect(link).toBeVisible()
    await expect(page.getByTestId('intake-integrity')).toContainText('Record unchanged since signing')
    const href = await link.getAttribute('href')
    expect(href).toMatch(/^\/files\/[0-9a-f-]{36}$/)
    const pdf = await page.evaluate(async (u) => {
      const r = await fetch(u)
      const bytes = new Uint8Array(await r.arrayBuffer())
      return {
        status: r.status,
        type: r.headers.get('content-type'),
        cache: r.headers.get('cache-control'),
        head: String.fromCharCode(...bytes.slice(0, 5)),
        size: bytes.length,
      }
    }, href!)
    expect(pdf).toMatchObject({
      status: 200,
      type: 'application/pdf',
      cache: 'private, no-cache',
      head: '%PDF-',
    })
    expect(pdf.size).toBeGreaterThan(5_000)
    const download = page.waitForEvent('download')
    await link.click()
    expect((await download).suggestedFilename()).toMatch(
      /^intake-Fatima-Al-Mansoori-\d{4}-\d{2}-\d{2}-[0-9a-f]{8}\.pdf$/,
    )
    // Regenerating replaces the file (new id), the record hash stays.
    await page.getByRole('button', { name: 'Regenerate PDF' }).click()
    await expect(page.getByText('PDF ready')).toBeVisible()
    await expect(page.getByTestId('intake-pdf-download')).not.toHaveAttribute('href', href!)
    expect(await page.evaluate(async (u) => (await fetch(u)).status, href!)).toBe(404)
  })

  await test.step('the signed intake is listed on the profile', async () => {
    await page.getByRole('link', { name: 'Fatima Al Mansoori' }).click()
    const list = page.getByTestId('intake-list')
    await expect(list).toContainText('Massage intake & consent')
    await expect(list).toContainText('v1')
    await expect(list.getByTestId('intake-pdf-link')).toHaveAttribute('href', /^\/files\/[0-9a-f-]{36}$/)
    await screenshotAt(page, 'client-profile')
  })

  await test.step('F27: Settings > Data exports the signed PDFs as one zip', async () => {
    await page.goto(`${app}/${slug}/settings/data`)
    const zipLink = page.getByTestId('intake-pdfs-export')
    await expect(zipLink).toBeVisible()
    const zip = await page.evaluate(
      async (u) => {
        const r = await fetch(u)
        const bytes = new Uint8Array(await r.arrayBuffer())
        return { status: r.status, type: r.headers.get('content-type'), sig: Array.from(bytes.slice(0, 4)) }
      },
      (await zipLink.getAttribute('href'))!,
    )
    expect(zip).toEqual({ status: 200, type: 'application/zip', sig: [0x50, 0x4b, 0x03, 0x04] })
  })
})
