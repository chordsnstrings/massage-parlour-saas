import { readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { auditLog, contactEnquiries } from '@spa/db'
import { and, eq, sql } from 'drizzle-orm'
import { ADMIN, admin, base, signInPlatformAdmin, testDb } from './helpers'

// Contact enquiries (PLAN §18.4, owner 2026-10-09): the marketing Contact form (server-validated, values kept on
// error, honeypot) → stored as `new` → the super-admin sees it in the console's Enquiries (nav badge), opens it
// (tel / WhatsApp click-to-send / mailto) and marks it contacted with a note (audited).
const tag = Date.now().toString(36)
const MESSAGE = 'Online booking for our two branches, please call me after 4pm.'

async function fillForm(page: Page, email: string, spa: string, phone: string) {
  await page.getByLabel('Your name', { exact: true }).fill('Layla Hassan')
  await page.getByLabel('Phone', { exact: true }).fill(phone)
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Spa name', { exact: true }).fill(spa)
  await page.getByLabel('What do you need?').fill(MESSAGE)
}

const newCount = async () => {
  const [row] = await testDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(contactEnquiries)
    .where(eq(contactEnquiries.status, 'new'))
  return row?.n ?? 0
}

test('contact form → super-admin Enquiries (badge) → marked contacted with a note', async ({ page }) => {
  const email = `layla-${tag}@e2e.test`
  const spa = `Serenity ${tag}`

  await test.step('the page shows the contact email and fits a 360 px phone', async () => {
    await page.setViewportSize({ width: 360, height: 780 })
    await page.goto(`${base}/contact`)
    await expect(page.getByRole('heading', { name: 'Send us a message' })).toBeVisible()
    await expect(page.locator('a[href="mailto:ask@spamanagement.co"]')).toBeVisible()
    await expect(page.getByRole('main').getByRole('link', { name: 'Sign in' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360)
    await page.setViewportSize({ width: 1280, height: 800 })
  })

  await test.step('an invalid phone is refused inline and every typed value stays', async () => {
    await fillForm(page, email, spa, '12345')
    await page.getByRole('button', { name: 'Send message' }).click()
    await expect(page.getByText('Enter a UAE mobile (05…) or an international number')).toBeVisible()
    await expect(page.getByText('Please check the highlighted fields.')).toBeVisible()
    await expect(page.getByLabel('Phone', { exact: true })).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByLabel('Your name', { exact: true })).toHaveValue('Layla Hassan')
    await expect(page.getByLabel('Spa name', { exact: true })).toHaveValue(spa)
    await expect(page.getByLabel('What do you need?')).toHaveValue(MESSAGE)
    expect(await testDb().select().from(contactEnquiries).where(eq(contactEnquiries.email, email))).toEqual(
      [],
    )
  })

  await test.step('fixed and sent: success state, stored as new', async () => {
    await page.getByLabel('Phone', { exact: true }).fill('050 123 4567')
    await page.getByRole('button', { name: 'Send message' }).click()
    await expect(page.getByTestId('enquiry-sent')).toContainText(
      'Thanks — we’ll reply within one working day.',
    )
    const [row] = await testDb().select().from(contactEnquiries).where(eq(contactEnquiries.email, email))
    expect(row).toMatchObject({
      status: 'new',
      name: 'Layla Hassan',
      phone: '+971501234567',
      spaName: spa,
      message: MESSAGE,
    })
    expect(row?.ipHash).toMatch(/^[0-9a-f]{32}$/)
  })

  const ctx = await page.context().browser()!.newContext()
  const p = await ctx.newPage()
  const [row] = await testDb().select().from(contactEnquiries).where(eq(contactEnquiries.email, email))

  await test.step('the super-admin sees the badge, finds it and opens it', async () => {
    await signInPlatformAdmin(p)
    const nav = p.locator('a[title="Enquiries"]')
    const before = await newCount()
    await expect(nav).toHaveText(`Enquiries${before}`)
    await nav.click()
    await expect(p.getByRole('heading', { name: 'Enquiries', level: 1 })).toBeVisible()
    await p.getByLabel('Search enquiries').fill(spa)
    await p.getByLabel('Search enquiries').press('Enter')
    await expect(p).toHaveURL(/q=Serenity/)
    await p.getByRole('link', { name: new RegExp(`Layla Hassan\\s*${spa}`) }).click()
    await expect(p.getByTestId('enquiry-message')).toHaveText(MESSAGE)
    await expect(p.getByTestId('enquiry-status')).toHaveText('New')
    await expect(p.getByRole('link', { name: 'Call' })).toHaveAttribute('href', 'tel:+971501234567')
    await expect(p.getByRole('link', { name: 'WhatsApp' })).toHaveAttribute(
      'href',
      /^https:\/\/wa\.me\/971501234567\?text=Hi%20Layla%20Hassan/,
    )
    await expect(p.getByRole('link', { name: 'Email', exact: true })).toHaveAttribute(
      'href',
      new RegExp(`^mailto:${email}\\?subject=`),
    )
  })

  await test.step('marked contacted with a note: badge drops, change audited', async () => {
    const before = await newCount()
    await p.getByLabel('Contacted').check()
    await p.getByLabel('Internal note').fill('Called — demo on Sunday')
    await p.getByRole('button', { name: 'Save' }).click()
    await expect(p.getByTestId('enquiry-status')).toHaveText('Contacted')
    await expect(p.locator('a[title="Enquiries"]')).toHaveText(
      before - 1 ? `Enquiries${before - 1}` : 'Enquiries',
    )
    const [after] = await testDb().select().from(contactEnquiries).where(eq(contactEnquiries.id, row!.id))
    expect(after).toMatchObject({ status: 'contacted', adminNote: 'Called — demo on Sunday' })
    expect(after?.handledBy).toBeTruthy()
    const audits = await testDb()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, row!.id), eq(auditLog.action, 'platform.enquiry.updated')))
    expect(audits).toHaveLength(1)
    expect(audits[0]?.data).toMatchObject({ status: { from: 'new', to: 'contacted' } })
  })

  await test.step('an empty status filter names that status', async () => {
    await p.goto(`${admin}/enquiries?status=closed`)
    await expect(p.getByText('No closed enquiries')).toBeVisible()
    await expect(p.getByText('No enquiries yet')).toHaveCount(0)
  })
  await ctx.close()
})

test('a filled honeypot looks sent but nothing is stored; the console needs a sign-in', async ({ page }) => {
  const email = `bot-${tag}@e2e.test`
  await page.goto(`${base}/contact`)
  await fillForm(page, email, `Bot spa ${tag}`, '+44 7700 900123')
  await page.locator('input[name="extra_details"]').evaluate((el: HTMLInputElement) => {
    el.value = 'https://spam.example'
  })
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page.getByTestId('enquiry-sent')).toBeVisible()
  expect(await testDb().select().from(contactEnquiries).where(eq(contactEnquiries.email, email))).toEqual([])

  await page.goto(`${admin}/enquiries`)
  await expect(page).toHaveURL(/\/login/)
})

// Saves (or removes) a console Resend key: staff email then lands in the e2e outbox (JSON files, no Resend call).
async function consoleEmailKey(page: Page, key: string | null) {
  await page.goto(`${admin}/settings`)
  const card = page.getByTestId('email-settings')
  if (key) await card.getByLabel('Resend API key').fill(key)
  else await card.getByLabel('Remove the stored key').check()
  await card.getByRole('button', { name: 'Save email settings' }).click()
  await expect(page.getByText('Email settings saved')).toBeVisible()
}

test('a new enquiry emails the super-admins (reply-to = sender); its audit row keeps no raw IP', async ({
  page,
  browser,
}) => {
  const outbox = process.env.EMAIL_E2E_OUTBOX_DIR as string
  const email = `ahmed-${tag}@e2e.test`
  const spa = `Oasis ${tag}`
  const ip = `203.0.113.${(Date.now() % 250) + 1}`
  await rm(outbox, { recursive: true, force: true })
  await signInPlatformAdmin(page)
  await consoleEmailKey(page, 're_e2eEnquiryKey_ENQ1')
  try {
    const ctx = await browser.newContext({ extraHTTPHeaders: { 'cf-connecting-ip': ip } })
    const visitor = await ctx.newPage()
    await visitor.goto(`${base}/contact`)
    await fillForm(visitor, email, spa, '+44 (0)20 7946 0958')
    await visitor.getByRole('button', { name: 'Send message' }).click()
    await expect(visitor.getByTestId('enquiry-sent')).toBeVisible()
    await ctx.close()
    const [row] = await testDb().select().from(contactEnquiries).where(eq(contactEnquiries.email, email))
    expect(row?.phone).toBe('+442079460958')

    const sentTo = async () => {
      const files = await readdir(outbox).catch(() => [] as string[])
      const mails = await Promise.all(
        files.map(async (f) => JSON.parse(await readFile(join(outbox, f), 'utf8'))),
      )
      return mails.find((m) => m.replyTo === email)
    }
    await expect.poll(async () => (await sentTo())?.to ?? null).toBe(ADMIN.email) // after() runs post-reply
    const mail = await sentTo()
    expect(mail).toMatchObject({
      to: ADMIN.email,
      replyTo: email,
      subject: `New enquiry: ${spa} (Layla Hassan)`,
    })
    expect(mail.text).toContain(MESSAGE)
    expect(mail.text).toContain(`${admin}/enquiries/${row!.id}`)

    const audits = await testDb()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, row!.id), eq(auditLog.action, 'platform.enquiry.received')))
    expect(audits).toHaveLength(1)
    expect(audits[0]?.ip).toBeNull()
    expect(JSON.stringify(audits[0])).not.toContain(ip)
  } finally {
    await consoleEmailKey(page, null)
  }
})
