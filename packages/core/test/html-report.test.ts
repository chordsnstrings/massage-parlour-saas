import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CRM_DEFAULTS_MAX } from '../src/html-crm'
import { type HtmlDesignWarningCode, htmlDesignReport, htmlDesignReportLine } from '../src/html-report'

// biome-ignore lint/suspicious/noExplicitAny: the tests shape synthetic design data freely
type Json = any

/** A clean contract v2 design (neutral defaults, ids, ui{}, Arabic font, bound markup): no warnings. */
const v2data = (): Json => ({
  contract: {
    version: 2,
    locales: ['en', 'ar'],
    fields: { 'ui.wa.*': { locales: ['en'] } },
    l10n: { ar: { 'ui.form.submit': 'إرسال', 'ui.form.err_phone': 'رقم مثل 050 123 4567' } },
  },
  spa: {
    name: 'Your Spa',
    short_name: 'Your Spa',
    logo_on_dark: '',
    logo_on_light: '',
    experience: [
      { id: 'message', title: 'Message us', text: 'Tell us the treatment' },
      { id: 'arrive', title: 'Arrive', text: 'We greet you' },
    ],
  },
  journey: [{ id: 'welcome', title: 'Slow down.', tags: ['Calm'], clip: null, cta: false }],
  contact: { whatsapp_number: '', whatsapp_message: 'Hello {spa}', phones: [] },
  location: { address_line1: '', city: '' },
  hours: [],
  services: [],
  staff: [],
  ui: {
    form: { submit: 'Send', err_phone: 'A number like 050 123 4567' },
    wa: { intro: 'Hello {spa}, I would like to book:' },
  },
})
const FONT = '<style>@font-face{font-family:"CL Arabic";src:url(a.woff2);unicode-range:U+0600-06FF}</style>'
const page = (data: Json, opts: { head?: string; body?: string; title?: string; font?: string } = {}) =>
  `<!doctype html><html><head><title>${opts.title ?? '{{spa_name}}'}</title>${opts.font ?? FONT}${opts.head ?? ''}</head><body><button data-crm-text="ui.form.submit">Send</button><p>Welcome</p>${opts.body ?? ''}<script>window.CRM_DATA = ${JSON.stringify(data)};</script><script>render()</script></body></html>`
const codes = (html: string) => htmlDesignReport(html).warnings.map((w) => w.code)
const fixture = (name: string) =>
  readFileSync(new URL(`../../../apps/web/e2e/fixtures/${name}`, import.meta.url), 'utf8')

describe('htmlDesignReport (R28 P5)', () => {
  it('reads a design without a contract as "Not connected to the CRM"', () => {
    const r = htmlDesignReport(
      '<html><head><title>{{spa_name}}</title></head><body><h1>Hi</h1><img src="a.jpg" alt="Lounge"></body></html>',
    )
    expect(r).toMatchObject({ contract: 'none', mode: null, locales: ['en'], pictures: 1, warnings: [] })
    expect(r.slots.total).toBe(0)
    expect(r.texts).toEqual({ total: 3, editable: 3, crm: 0, script: 0, bound: 0 })
    expect(htmlDesignReportLine(r)).toBe('Not connected to the CRM · 3 page texts editable')
    expect(htmlDesignReport(fixture('fidelity.html')).contract).toBe('none')
  })

  it('reads a v1 literal design', () => {
    const r = htmlDesignReport(fixture('crm-contract.html'))
    expect(r).toMatchObject({ contract: 'v1', mode: 'literal', locales: ['en'] })
    expect(htmlDesignReportLine(r)).toMatch(
      /^CRM contract v1 · \d+ editable values? · \d+ of \d+ page texts editable/,
    )
  })

  it('reads a clean v2 design: counts, locales and no warnings', () => {
    const r = htmlDesignReport(page(v2data()))
    expect(r.contract).toBe('v2')
    expect(r.mode).toBe('literal')
    expect(r.locales).toEqual(['en', 'ar'])
    expect(r.warnings).toEqual([])
    expect(r.slots.ui).toBe(3)
    expect(r.slots.byKind).toMatchObject({ text: 10, tags: 1, video: 1, bool: 1, image: 2 })
    expect(r.texts).toEqual({ total: 3, editable: 2, crm: 1, script: 0, bound: 1 })
    expect(htmlDesignReportLine(r)).toBe(
      `CRM contract v2 · ${r.slots.total} editable values (3 interface texts) · 2 of 3 page texts editable`,
    )
  })

  it('names every authoring problem, in order', () => {
    const d = v2data()
    expect(codes(page({ ...d, locale: 'en' }))).toEqual(['locale-in-data'])
    const noIds = v2data()
    for (const x of noIds.spa.experience) delete x.id
    expect(htmlDesignReport(page(noIds)).warnings).toEqual([
      {
        code: 'no-ids',
        message: 'spa.experience has no item ids: edits are kept by position.',
        path: 'spa.experience',
      },
    ])
    const team = (guard: string) =>
      page(d, {
        body: `<div data-crm-list="staff"><template><figure class="tcard"${guard}><img data-item-src="photo" alt=""></figure></template></div>`,
      })
    expect(codes(team(''))).toEqual(['staff-no-photo-guard'])
    expect(codes(team(' data-if="photo"'))).toEqual([])
    expect(codes(page({ ...d, spa: { ...d.spa, name: 'Be Relax' } }))).toEqual(['named-spa'])
    // A phone in a story text is flagged; the same format example in reviewed system copy is not.
    const phone = v2data()
    phone.journey[0].title = 'Call 050 123 4567'
    expect(htmlDesignReport(page(phone)).warnings[0]!.message).toBe(
      "The design's defaults carry contact details (050 123 4567).",
    )
    expect(
      codes(page({ ...d, hours: [{ day: 'mon' }], contact: { ...d.contact, phones: [{ number: '+971' }] } })),
    ).toEqual(['contact-in-defaults'])
    // A demo spa's logo left in the defaults (never shown on v2: the CRM's or the spa's website content).
    const logo = htmlDesignReport(
      page({ ...d, spa: { ...d.spa, logo_on_dark: 'data:image/png;base64,AAAA' } }),
    )
    expect(logo.warnings).toEqual([
      {
        code: 'logo-in-defaults',
        message:
          "The design's defaults carry a logo (spa.logo_on_dark); spas never see it: each shows its CRM or website-content logo.",
        path: 'spa.logo_on_dark',
      },
    ])
    expect(codes(page(d, { title: 'Be Relax Spa' }))).toEqual(['fixed-title'])
    expect(codes(page(d, { body: '<script>document.title = "x"</script>' }))).toEqual(['fixed-title'])
    expect(codes(page(d, { font: '' }))).toEqual(['no-arabic-font'])
    expect(
      codes(
        page(d, {
          font: '<link href="https://fonts.googleapis.com/css2?family=Noto+Naskh+Arabic&display=swap" rel="stylesheet">',
        }),
      ),
    ).toEqual([])
    expect(htmlDesignReport(page(d, { body: '<a data-crm-text="ui.nope">x</a>' })).warnings).toEqual([
      {
        code: 'bound-no-slot',
        message: 'data-crm-text "ui.nope" names no text in CRM_DATA.',
        path: 'ui.nope',
      },
    ])
    expect(codes(page({ ...d, ui: { ...d.ui, hero_image: '' } }))).toEqual(['ui-kind'])
    const { ui: _ui, ...noUi } = d
    expect(codes(page(noUi, { body: '' }).replace('data-crm-text="ui.form.submit"', ''))).toEqual(['no-ui'])
    expect(codes(page(d, { body: '<iframe src="https://www.youtube.com/embed/x"></iframe>' }))).toEqual([
      'embeds',
    ])
  })

  it('warns about a non-JSON CRM_DATA, an oversized crm-defaults and a v1 design for one spa', () => {
    const r = htmlDesignReport('<html><body><script>window.CRM_DATA = {a: 1};</script></body></html>')
    expect(r.contract).toBe('none')
    expect(r.warnings.map((w) => w.code)).toEqual(['not-json'])
    const big = JSON.stringify({ spa: { note: 'x'.repeat(CRM_DEFAULTS_MAX) } })
    const endpoint = htmlDesignReport(
      `<html><head><title>{{spa_name}}</title><meta name="crm-endpoint" content="{{crm_data_url}}"><script type="application/json" id="crm-defaults">${big}</script></head><body></body></html>`,
    )
    expect(endpoint).toMatchObject({ contract: 'v1', mode: 'endpoint' })
    expect(endpoint.warnings.map((w) => w.code)).toEqual(['defaults-too-large'])
    const v1 = htmlDesignReport(fixture('crm-contract.html'))
    expect(v1.warnings.map((w) => w.code)).toContain('named-spa' satisfies HtmlDesignWarningCode)
    expect(v1.warnings.map((w) => w.code)).not.toContain('logo-in-defaults') // v1: its logos are its own
  })

  it('never throws and stays fast on a 5 MB design', () => {
    for (const junk of [
      null,
      undefined,
      42,
      '',
      '<<<>>>',
      '<script>window.CRM_DATA = {',
      '<meta name=crm-endpoint>',
    ])
      expect(() => htmlDesignReport(junk as never)).not.toThrow()
    expect(htmlDesignReport(null as never).contract).toBe('none')
    const d = v2data()
    d.spa.experience_image = `data:image/png;base64,${'A'.repeat(5_000_000)}`
    const texts = Array.from({ length: 300 }, (_, i) => `<p>Text ${i}</p>`).join('')
    const html = page(d, { body: texts })
    const t0 = performance.now()
    const r = htmlDesignReport(html)
    expect(performance.now() - t0).toBeLessThan(400)
    expect(r.contract).toBe('v2')
    expect(r.texts.total).toBe(303)
  })
})
