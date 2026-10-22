import { readFile } from 'node:fs/promises'
import { expect, type Page, test } from '@playwright/test'
import { branches, tenants } from '@spa/db'
import { eq } from 'drizzle-orm'
import { admin, makeStudio, PORT, signInStudioOnAdmin, signUpOwner, site, studioUrl, testDb } from './helpers'

/**
 * Contract §12 (R33, owner "Option A"): crawlers that run no JavaScript read the spa's address, phone numbers, opening
 * hours and links in the raw HTML of a `contract.prefill` design (the real BE RELAX v2.8 file), where visitors see
 * them; once the design's script has run, every prefilled slot, link and list row reads exactly what the raw HTML says.
 */
const V28 = new URL('../../../docs/design/be-relax-site/be-relax-v2.8.html', import.meta.url)
const NAME = 'BE RELAX Prefill'
const PIN = 'https://maps.app.goo.gl/r33PrefillPin'
const LATE = { open: '11:00', close: '02:00' }
const LATER = { open: '11:00', close: '03:00' }
const HOURS = { mon: [LATE], tue: [LATE], wed: [LATE], thu: [LATE], fri: [LATER], sat: [LATER], sun: [] }

// The raw page writes the spa's (Dubai) year, the script the browser's: a Dubai browser, so the footer year agrees
// on New Year's Eve too.
test.use({ timezoneId: 'Asia/Dubai' })

/** A request to a spa host as a crawler sends it (Node can't resolve *.localhost: 127.0.0.1 + Host). */
async function raw(page: Page, url: string) {
  const u = new URL(url)
  const res = await page.request.fetch(`http://127.0.0.1:${PORT}${u.pathname}${u.search}`, {
    headers: { host: u.host },
    failOnStatusCode: false,
    maxRedirects: 0,
  })
  expect(res.status()).toBe(200)
  return res.text()
}

/** What the rendered page and its raw HTML say in every prefilled place (compared in the page, on its DOM). */
type Side = {
  slots: string[][]
  note: string
  noteValues: string[]
  links: string[]
  lists: Record<string, string[]>
}
const READ = (rawHtml: string): { raw: Side; live: Side } => {
  const LISTS = ['phones', 'whatsapp-phones', 'hours-rows']
  const flat = (s: string | null) => (s ?? '').replace(/\s+/g, '')
  const read = (d: Document, prefilledOnly: Set<string> | null): Side => {
    // Text slots outside templates, lists and the data-crm-tpl note (its script rebuilds it without data-crm).
    const slots = [...d.querySelectorAll('[data-crm]')].filter(
      (e) => !e.closest('[data-crm-list]') && !e.closest('[data-crm-tpl]'),
    )
    const links = [...d.querySelectorAll('a[href]')].filter(
      (a) => !a.closest('[data-crm-list]') && !a.closest('#world') && !a.classList.contains('lang-link'),
    )
    const rows = (name: string) =>
      [...d.querySelectorAll(`[data-crm-list="${name}"]`)].flatMap((box) =>
        [...box.children]
          .filter((c) => c.tagName !== 'TEMPLATE')
          .map((c) => {
            const row = c.cloneNode(true) as Element
            for (const x of row.querySelectorAll('.call-btn')) x.remove() // the script's Call buttons
            const anchors = [...row.querySelectorAll('a'), ...(row.tagName === 'A' ? [row] : [])]
            return [
              flat(row.textContent),
              ...anchors.map((a) => `${a.getAttribute('href')}${a.hasAttribute('hidden') ? ' hidden' : ''}`),
              ...[...row.querySelectorAll('[data-copy]')].map((b) => b.getAttribute('data-copy')),
            ].join(' | ')
          }),
      )
    return {
      slots: slots.map((e, i) => [
        String(i),
        e.getAttribute('data-crm') ?? '',
        prefilledOnly && !prefilledOnly.has(String(i)) ? '' : (e.textContent ?? ''),
      ]),
      note: flat(d.querySelector('[data-crm-tpl]')?.textContent ?? ''),
      noteValues: [...(d.querySelector('[data-crm-tpl]')?.querySelectorAll('span') ?? [])].map(
        (x) => x.textContent ?? '',
      ),
      links: links.map((a) => a.getAttribute('href') ?? ''),
      lists: Object.fromEntries(LISTS.map((n) => [n, rows(n)])),
    }
  }
  const doc = new DOMParser().parseFromString(rawHtml, 'text/html')
  const r = read(doc, null)
  // Compare only the slots the raw page filled (text, no markup; live-status is the script's alone).
  const filled = new Set(
    [...doc.querySelectorAll('[data-crm]')]
      .filter((e) => !e.closest('[data-crm-list]') && !e.closest('[data-crm-tpl]'))
      .flatMap((e, i) => (e.children.length === 0 && e.textContent?.trim() ? [String(i)] : [])),
  )
  r.slots = r.slots.map(([i, k, t]) => [i!, k!, filled.has(i!) ? t! : ''])
  return { raw: r, live: read(document, filled) }
}

test('contract §12: a prefill design has the CRM facts in its raw HTML, and the script shows the same', async ({
  page,
  browser,
}) => {
  test.setTimeout(420_000)
  const design = await readFile(V28, 'utf8')
  const owner = await signUpOwner(page, { spa: 'Prefill Spa' })
  const { slug } = owner
  const db = testDb()
  const [t] = await db.select().from(tenants).where(eq(tenants.slug, slug))
  await db
    .update(branches)
    .set({
      phone: '02 557 6533',
      whatsappE164: '971525108633',
      address: '250 Al Meena Street, Al Zahiyah, Abu Dhabi, UAE',
      mapsUrl: PIN,
      openingHours: HOURS,
    })
    .where(eq(branches.tenantId, t!.id))
  await makeStudio(slug)
  await signInStudioOnAdmin(page, owner.email)

  await page.goto(`${admin}/templates`)
  await page.getByRole('button', { name: 'Upload HTML' }).click()
  const up = page.getByRole('dialog')
  await up.getByLabel('Template name').fill(NAME)
  await up
    .getByLabel('HTML file')
    .setInputFiles({ name: 'be-relax-v2.8.html', mimeType: 'text/html', buffer: Buffer.from(design) })
  await up.getByRole('checkbox', { name: /Spas can pick it right away/ }).check()
  await up.getByRole('button', { name: 'Upload' }).click()
  await expect(page.getByText(new RegExp(`${NAME} uploaded\\. Stored exactly as the file\\.`))).toBeVisible({
    timeout: 60_000,
  })
  await page.goto(studioUrl(slug))
  await page.getByRole('button', { name: `Use ${NAME}` }).click()
  await expect(page.getByTestId('current-template')).toHaveText(NAME, { timeout: 30_000 })
  await page.getByRole('button', { name: 'Publish site' }).click()
  await page.getByRole('button', { name: 'Publish now' }).click()
  await expect(page.getByText('Published 1 page')).toBeVisible({ timeout: 30_000 })

  const home = site(slug)
  await test.step('raw HTML (no JavaScript): address, hours, phone numbers, WhatsApp and map links', async () => {
    const en = await raw(page, `${home}/`)
    expect(en).toContain('<h3 data-crm="address-line1">250 Al Meena Street</h3>')
    expect(en).toContain('<p data-crm="address">Al Zahiyah, Abu Dhabi, UAE</p>')
    expect(en).toContain('<span class="big" data-crm="working-hours">hours vary by day</span>')
    expect(en).toContain('<p data-crm="operating-days">Mon – Thu, Fri – Sat</p>')
    expect(en).toContain(
      '<li><span data-item="days">Mon – Thu</span><b data-item="time">11 AM – 2 AM</b></li><li><span data-item="days">Fri – Sat</span><b data-item="time">11 AM – 3 AM</b></li><li><span data-item="days">Sun</span><b data-item="time">Closed</b></li>',
    )
    expect(en).toContain('<b data-crm="phone" data-phone="0">02 557 6533</b>')
    expect(en).toContain('<span data-crm="phone" data-phone="1">052 510 8633</span>')
    expect(en).toMatch(
      /<a class="pill" href="https:\/\/wa\.me\/971525108633\?text=Hello%20Prefill%20Spa%2C[^"]*"/,
    )
    expect(en).toContain(`<a class="map-link" data-crm="address" href="${PIN}"`)
    expect(en).toContain('<a class="pill solid" href="#book">')
    expect(en).toContain(
      '<span data-crm="spa-name">Prefill Spa</span> · <span data-crm="city">Abu Dhabi</span>',
    )
    expect(en).not.toContain('<a class="map-link" data-crm="address" href="[crm-maps-link]"')

    const ar = await raw(page, `${home}/?lang=ar`)
    expect(ar).toContain('<span data-crm="city">أبوظبي</span>')
    expect(ar).toContain('<span class="big" data-crm="working-hours">تختلف المواعيد حسب اليوم</span>')
    expect(ar).toContain('<b data-item="time">11 ص – 2 ص</b>')
    expect(ar).toContain(
      '<span data-crm-text="ui.contact.whatsapp">واتساب</span> <span data-crm="phone" data-phone="1">052 510 8633</span>',
    )
    expect(ar).toContain('<p data-crm="address">Al Zahiyah, Abu Dhabi, UAE</p>')
    expect(ar).toContain(`href="${PIN}"`)
    expect(ar).toContain('href="https://wa.me/971525108633?text=')
  })

  for (const lang of ['', '?lang=ar']) {
    await test.step(`the script shows exactly the prefilled text, links and rows ${lang || '(English)'}`, async () => {
      const rawHtml = await raw(page, `${home}/${lang}`)
      await page.goto(`${home}/${lang}`, { waitUntil: 'domcontentloaded' })
      await expect(page.locator('#crmRoot')).not.toHaveClass(/crm-loading/, { timeout: 60_000 })
      const { raw: r, live } = await page.evaluate(READ, rawHtml)
      expect(r.slots.filter(([, , text]) => text).length).toBeGreaterThanOrEqual(8)
      expect(live.slots).toEqual(r.slots)
      // The booking form's note: its days and hours as prefilled; its words are the design's until the script
      // localises them (data-crm-text outside the list rows is not prefilled, §12), so whole on the English page.
      expect(live.noteValues).toEqual(r.noteValues)
      expect(r.noteValues).toEqual(
        lang
          ? ['الاثنين – الخميس, الجمعة – السبت', 'تختلف المواعيد حسب اليوم']
          : ['Mon – Thu, Fri – Sat', 'hours vary by day'],
      )
      if (!lang) expect(live.note).toBe(r.note)
      // Every link the raw page already has (not a [crm-…] token) is the one the script leaves.
      expect(live.links.length).toBe(r.links.length)
      const kept = r.links.flatMap((href, i) => (href.startsWith('[crm-') ? [] : [[href, live.links[i]]]))
      expect(
        kept.filter(([a]) => /^(?:https:\/\/wa\.me\/|#book$|https:\/\/maps)/.test(a!)).length,
      ).toBeGreaterThanOrEqual(4)
      for (const [a, b] of kept) expect(b).toBe(a)
      expect(r.lists.phones).toHaveLength(4) // the Book card's numbers + the Find us call list
      expect(r.lists['whatsapp-phones']).toHaveLength(1)
      expect(r.lists['hours-rows']).toHaveLength(3)
      expect(live.lists).toEqual(r.lists)
    })
  }

  await test.step('a browser without JavaScript shows the address, the hours and a phone number', async () => {
    const ctx = await browser.newContext({ javaScriptEnabled: false })
    const visitor = await ctx.newPage()
    await visitor.goto(`${home}/`, { waitUntil: 'domcontentloaded' })
    await expect(visitor.locator('#visit h3[data-crm="address-line1"]')).toHaveText('250 Al Meena Street')
    await expect(visitor.locator('#visit h3[data-crm="address-line1"]')).toBeVisible()
    await expect(visitor.locator('#visit [data-crm="working-hours"]')).toHaveText('hours vary by day')
    await expect(visitor.locator('#visit .call-list b[data-crm="phone"]').first()).toHaveText('02 557 6533')
    await expect(visitor.locator('#visit .call-list b[data-crm="phone"]').first()).toBeVisible()
    await ctx.close()
  })
})
