import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { prefillCrmMarkup } from '../src/html-crm-prefill'
import { htmlDesignDocument, listHtmlDesignTexts } from '../src/html-design'

// biome-ignore lint/suspicious/noExplicitAny: the tests build CRM_DATA freely
type Json = any

const NOW = new Date('2026-10-17T12:00:00Z')
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const UI_EN = {
  cta: { book_now: 'Book now' },
  contact: {
    whatsapp: 'WhatsApp',
    calls: 'calls',
    and: ' & ',
    copy: 'Copy',
    mobile: 'Mobile',
    landline: 'Landline',
  },
  hours: {
    days: { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' },
    am: 'AM',
    pm: 'PM',
    closed: 'Closed',
    every_day: 'every day',
    vary: 'hours vary by day',
    closed_all: 'closed',
    form_note: 'Open {days}, {hours}',
  },
}
const UI_AR = {
  cta: { book_now: 'احجز الآن' },
  contact: {
    whatsapp: 'واتساب',
    calls: 'اتصال',
    and: ' و',
    copy: 'نسخ',
    mobile: 'جوال',
    landline: 'هاتف أرضي',
  },
  hours: {
    days: {
      mon: 'الاثنين',
      tue: 'الثلاثاء',
      wed: 'الأربعاء',
      thu: 'الخميس',
      fri: 'الجمعة',
      sat: 'السبت',
      sun: 'الأحد',
    },
    am: 'ص',
    pm: 'م',
    closed: 'مغلق',
    every_day: 'يوميًا',
    vary: 'تختلف المواعيد حسب اليوم',
    closed_all: 'مغلق',
    form_note: 'مفتوح {days}، {hours}',
  },
}
const every = (open: string, close: string) => DAYS.map((day) => ({ day, open, close, closed: false }))
const LANDLINE = { number: '+97125576533', display: '02 557 6533', label: '', calls: true, whatsapp: false }
const MOBILE = { number: '+971525108633', display: '052 510 8633', label: '', calls: false, whatsapp: true }

/** The served CRM_DATA of a prefill design (BE RELAX shape), with overrides. */
const crm = (over: Json = {}): Json => ({
  contract: { version: 2, prefill: 1, locales: ['en', 'ar'] },
  locale: 'en',
  spa: { name: 'Be Relax', short_name: 'Be Relax', area_label: 'Abu Dhabi', timezone: 'Asia/Dubai' },
  contact: {
    whatsapp_number: '+971525108633',
    whatsapp_message: 'Hello {spa}, I would like to book{service}.',
    phones: [LANDLINE, MOBILE],
  },
  location: {
    address_line1: '250 Al Meena Street',
    address_line2: 'Al Zahiyah',
    city: 'Abu Dhabi',
    country: 'UAE',
    maps_url: 'https://maps.app.goo.gl/beRelax',
  },
  hours: every('11:00', '02:00'),
  booking: { url: null, label: 'Book a session', form_endpoint: null },
  services: [],
  staff: [],
  ui: UI_EN,
  ...over,
})
const page = (data: Json, body: string) =>
  `<!doctype html><html lang="en"><head><script>window.CRM_DATA = ${JSON.stringify(data)};</script></head><body>${body}</body></html>`
const run = (data: Json, body: string, now = NOW) => {
  const html = page(data, body)
  const out = prefillCrmMarkup(html, { now })
  return out.slice(out.indexOf('<body>') + 6, out.lastIndexOf('</body>'))
}
/** The text of the first `data-crm="key"` slot after prefill. */
const slot = (data: Json, key: string, tag = 'span') => {
  const out = run(data, `<${tag} data-crm="${key}"></${tag}>`)
  return out.slice(out.indexOf('>') + 1, out.lastIndexOf('<'))
}

// The v2.7 markup the prefill writes into (be-relax-v2.7.html "find us", "book" and footer).
const VISIT = `<div data-if="has-hours"><span class="mono status" data-crm="live-status"></span><span class="big" data-crm="working-hours"></span><p data-crm="operating-days"></p><ul class="hours-list" data-if="hours-varies" data-crm-list="hours-rows"><template><li><span data-item="days"></span><b data-item="time"></b></li></template></ul></div><div data-if="address"><h3 data-crm="address-line1"></h3>
<p data-crm="address"></p><a class="map-link" data-crm="address" href="[crm-maps-link]"><span data-crm-text="ui.sections.open_maps">Open in Google Maps</span></a></div>`
const PHONES = `<div class="nums" data-crm-list="phones" data-if="phones">
  <template>
    <div class="num"><div><span class="mono" data-item="kind"></span><b data-crm="phone" data-phone="[phone-index]"></b></div><button class="copy" type="button" data-item-copy="number" data-crm-text="ui.contact.copy">Copy</button></div>
  </template>
</div>`
const WA = `<div class="wa-list" data-crm-list="whatsapp-phones" data-if="whatsapp-phones"><template><a class="pill" href="[crm-whatsapp-link]" data-phone="[phone-index]"><span data-crm-text="ui.contact.whatsapp">WhatsApp</span> <span data-crm="phone" data-phone="[phone-index]"></span></a></template></div>`
const CALLS = `<ul class="call-list" data-crm-list="phones"><template><li><div><b data-crm="phone" data-phone="[phone-index]"></b><span class="mono" data-item="kind"></span></div><a class="wa-btn" href="[crm-whatsapp-link]" data-phone="[phone-index]" data-if="whatsapp"><span data-crm-text="ui.contact.whatsapp">WhatsApp</span></a></li></template></ul>`

describe('prefillCrmMarkup: only designs that opt in', () => {
  const body = `<span data-crm="spa-name"></span><a href="[crm-booking-url]">Book</a>`
  it.each([
    ['no contract', `<html><body>${body}</body></html>`],
    ['v1 (no manifest)', page({ ...crm(), contract: undefined }, body)],
    ['v2 without prefill', page({ ...crm(), contract: { version: 2 } }, body)],
    ['another prefill format', page({ ...crm(), contract: { version: 2, prefill: 2 } }, body)],
    ['prefill true', page({ ...crm(), contract: { version: 2, prefill: true } }, body)],
    ['prefill outside contract', page({ ...crm(), contract: { version: 2 }, prefill: 1 }, body)],
    [
      'endpoint only',
      `<html><head><meta name="crm-endpoint" content="crm-data.json"><script type="application/json" id="crm-defaults">${JSON.stringify(crm())}</script></head><body>${body}</body></html>`,
    ],
    ['nothing to fill', page(crm(), '<p>Hello</p>')],
    ['every slot filled already', page(crm(), '<span data-crm="spa-name">Mine</span>')],
  ])('%s → the very same string', (_, html) => {
    expect(prefillCrmMarkup(html, { now: NOW })).toBe(html)
  })

  it('data the script cannot read (a lone surrogate in the WhatsApp message) → unchanged', () => {
    const html = page(crm({ contact: { ...crm().contact, whatsapp_message: 'x\uD800' } }), body)
    expect(prefillCrmMarkup(html)).toBe(html)
  })

  it('a lone surrogate the rows meet (no main WhatsApp number, a per-phone link) → unchanged, no throw', () => {
    const contact = { whatsapp_number: '', whatsapp_message: 'Hi \uD800', phones: [LANDLINE] }
    const html = page(crm({ contact }), `<span data-crm="spa-name"></span>${CALLS}`)
    expect(prefillCrmMarkup(html, { now: NOW })).toBe(html)
  })

  it('the real BE RELAX v2.7 file is unchanged; v2.8 (the opt-in) is filled', () => {
    const dir = new URL('../../../docs/design/be-relax-site/', import.meta.url)
    const v27 = readFileSync(new URL('be-relax-v2.7.html', dir), 'utf8')
    const v28 = readFileSync(new URL('be-relax-v2.8.html', dir), 'utf8')
    expect(prefillCrmMarkup(v27, { now: NOW })).toBe(v27)
    // v2.8 = v2.7 + "prefill":1 in its contract + the Search Console verification meta, nothing else.
    expect(
      v28
        .replace('"version":2,"prefill":1,', '"version":2,')
        .replace(
          /<!-- Google Search Console ownership[^\n]*\n<meta name="google-site-verification"[^>]*>\n/,
          '',
        ),
    ).toBe(v27)
    const head = 'window.CRM_DATA = '
    const s = v28.indexOf(head) + head.length
    const e = v28.indexOf(';</script>', s)
    const served = JSON.parse(v28.slice(s, e))
    const live = { ...served, locale: 'en', ...pick(crm(), ['contact', 'location', 'hours']) }
    live.spa = { ...served.spa, name: 'Be Relax', short_name: 'Be Relax' }
    const html = v28.slice(0, s) + JSON.stringify(live) + v28.slice(e)
    const t0 = performance.now()
    const out = prefillCrmMarkup(html, { now: NOW })
    expect(performance.now() - t0).toBeLessThan(2000)
    expect(out).toContain('<h3 data-crm="address-line1">250 Al Meena Street</h3>')
    expect(out).toContain('<p data-crm="address">Al Zahiyah, Abu Dhabi, UAE</p>')
    expect(out).toContain('<span class="big" data-crm="working-hours">11 AM – 2 AM</span>')
    expect(out).toContain('<b data-crm="phone" data-phone="0">02 557 6533</b>')
    expect(out).toContain('href="https://maps.app.goo.gl/beRelax"')
    expect(out).toContain(
      'href="https://wa.me/971525108633?text=Hello%20Be%20Relax%2C%20I%20would%20like%20to%20book."',
    )
    expect(out).toContain('<span data-crm="city">Abu Dhabi</span>')
    // Only empty data-crm slots, token hrefs and list rows change: the rest of the file as built.
    expect(out.replace(/>[^<]*</g, '><')).not.toBe(html.replace(/>[^<]*</g, '><'))
    expect(out.slice(0, out.indexOf('<body'))).toBe(html.slice(0, html.indexOf('<body')))
  })
})

const pick = (o: Json, keys: string[]) => Object.fromEntries(keys.map((k) => [k, o[k]]))

describe('values: the binder formats', () => {
  it('hours 11:00–02:00 every day: one time, "every day"', () => {
    expect(slot(crm(), 'working-hours')).toBe('11 AM – 2 AM')
    expect(slot(crm(), 'operating-days')).toBe('every day')
  })

  it('mixed and closed days: grouped day labels, "hours vary by day"', () => {
    const hours = [
      ...['mon', 'tue', 'wed', 'thu'].map((day) => ({ day, open: '11:00', close: '02:00', closed: false })),
      ...['fri', 'sat'].map((day) => ({ day, open: '11:00', close: '03:00', closed: false })),
      { day: 'sun', open: '', close: '', closed: true },
    ]
    expect(slot(crm({ hours }), 'operating-days')).toBe('Mon – Thu, Fri – Sat')
    expect(slot(crm({ hours }), 'working-hours')).toBe('hours vary by day')
    // One signature with a closed day between: that row's time; the open groups listed.
    const gap = DAYS.map((day) =>
      day === 'sat'
        ? { day, open: '', close: '', closed: true }
        : { day, open: '10:00', close: '22:00', closed: false },
    )
    expect(slot(crm({ hours: gap }), 'operating-days')).toBe('Mon – Fri, Sun')
    expect(slot(crm({ hours: gap }), 'working-hours')).toBe('10 AM – 10 PM')
    // Every day closed: "closed", no days (an empty slot stays empty).
    const shut = DAYS.map((day) => ({ day, open: '', close: '', closed: true }))
    expect(slot(crm({ hours: shut }), 'working-hours')).toBe('closed')
    expect(slot(crm({ hours: shut }), 'operating-days')).toBe('')
  })

  it('minutes, noon, midnight and 24:00', () => {
    expect(slot(crm({ hours: every('09:30', '24:00') }), 'working-hours')).toBe('9:30 AM – 12 AM')
    expect(slot(crm({ hours: every('12:00', '00:15') }), 'working-hours')).toBe('12 PM – 12:15 AM')
  })

  it('Arabic data: Arabic day / am-pm labels, Arabic city (known UAE city, else the Arabic area label)', () => {
    const ar = crm({ locale: 'ar', ui: UI_AR })
    expect(slot(ar, 'working-hours')).toBe('11 ص – 2 ص')
    expect(slot(ar, 'operating-days')).toBe('يوميًا')
    expect(slot(ar, 'city')).toBe('أبوظبي')
    expect(slot(ar, 'booking-label')).toBe('Book a session')
    expect(slot(crm({ locale: 'ar', ui: UI_AR, booking: { url: null } }), 'booking-label')).toBe('احجز الآن')
    expect(slot({ ...ar, spa: { ...ar.spa, area_label: 'الزاهية' } }, 'city')).toBe('الزاهية')
    expect(slot({ ...ar, location: { ...ar.location, city: 'Ras-Al  Khaimah.' } }, 'city')).toBe('رأس الخيمة')
    expect(slot({ ...ar, location: { ...ar.location, city: 'Khor Fakkan' } }, 'city')).toBe('Khor Fakkan')
    expect(slot(crm(), 'city')).toBe('Abu Dhabi')
    // Mixed groups on the Arabic page.
    const hours = DAYS.map((day) =>
      day === 'fri'
        ? { day, open: '', close: '', closed: true }
        : { day, open: '10:00', close: '23:30', closed: false },
    )
    expect(slot({ ...ar, hours }, 'operating-days')).toBe('الاثنين – الخميس, السبت – الأحد')
    expect(slot({ ...ar, hours }, 'working-hours')).toBe('10 ص – 11:30 م')
  })

  it('name, booking label fallback, year in Dubai, address', () => {
    expect(slot(crm(), 'spa-name')).toBe('Be Relax')
    expect(slot(crm({ booking: { url: null } }), 'booking-label')).toBe('Book now')
    expect(slot(crm(), 'address')).toBe('250 Al Meena Street, Al Zahiyah, Abu Dhabi, UAE')
    expect(slot(crm(), 'address-line1')).toBe('250 Al Meena Street')
    // 21:00 UTC on 31 December is already the new year in Dubai.
    const out = run(crm(), '<span data-crm="year"></span>', new Date('2026-12-31T21:00:00Z'))
    expect(out).toBe('<span data-crm="year">2027</span>')
  })

  it('address right after the first-line heading: the rest only', () => {
    const body = '<div><h3 data-crm="address-line1"></h3>\n<p data-crm="address"></p></div>'
    expect(run(crm(), body)).toBe(
      '<div><h3 data-crm="address-line1">250 Al Meena Street</h3>\n<p data-crm="address">Al Zahiyah, Abu Dhabi, UAE</p></div>',
    )
    // Only line 1: no rest (the script hides it), the slot stays empty.
    const only = crm({ location: { address_line1: '250 Al Meena Street', maps_url: '' } })
    expect(run(only, body)).toContain('<p data-crm="address"></p>')
    // No line 1: the whole address.
    const noLine = crm({ location: { address_line2: 'Al Zahiyah', city: 'Abu Dhabi' } })
    expect(run(noLine, body)).toContain('<p data-crm="address">Al Zahiyah, Abu Dhabi</p>')
    // Not the previous element sibling: the whole address.
    expect(run(crm(), '<h3 data-crm="address-line1"></h3><br><p data-crm="address"></p>')).toContain(
      '<p data-crm="address">250 Al Meena Street, Al Zahiyah, Abu Dhabi, UAE</p>',
    )
  })

  it('phone: the data-phone number, else the first call-only number', () => {
    expect(slot(crm(), 'phone')).toBe('02 557 6533')
    expect(run(crm(), '<b data-crm="phone" data-phone="1"></b>')).toBe(
      '<b data-crm="phone" data-phone="1">052 510 8633</b>',
    )
    expect(run(crm(), '<b data-crm="phone" data-phone="9"></b>')).toBe(
      '<b data-crm="phone" data-phone="9">02 557 6533</b>',
    )
    const both = { ...MOBILE, calls: true }
    expect(slot(crm({ contact: { phones: [both, LANDLINE] } }), 'phone')).toBe('02 557 6533')
    expect(slot(crm({ contact: { phones: [both] } }), 'phone')).toBe('052 510 8633')
    expect(slot(crm({ contact: { phones: [MOBILE] } }), 'phone')).toBe('052 510 8633')
    expect(slot(crm({ contact: { phones: [] } }), 'phone')).toBe('')
  })
})

describe('links: the three tokens', () => {
  const links = (data: Json) =>
    run(
      data,
      '<a id="w" href="[crm-whatsapp-link]">WhatsApp</a><a id="m" href=\'[crm-maps-link]\'>Map</a><a id="b" href="[crm-booking-url]">Book</a><form action="[crm-booking-endpoint]"></form>',
    )

  it('WhatsApp (message with the spa name, encoded), maps, #book; the form endpoint never', () => {
    expect(links(crm())).toBe(
      '<a id="w" href="https://wa.me/971525108633?text=Hello%20Be%20Relax%2C%20I%20would%20like%20to%20book.">WhatsApp</a>' +
        '<a id="m" href=\'https://maps.app.goo.gl/beRelax\'>Map</a><a id="b" href="#book">Book</a><form action="[crm-booking-endpoint]"></form>',
    )
  })

  it('WhatsApp: Arabic-Indic digits, the first WhatsApp phone, no message, no number → the token stays', () => {
    const ar = crm({ contact: { whatsapp_number: '+٩٧١٥٢٥١٠٨٦٣٣', whatsapp_message: '', phones: [] } })
    expect(links(ar)).toContain('href="https://wa.me/971525108633"')
    const fromPhone = crm({
      contact: { whatsapp_number: '', phones: [LANDLINE, { ...MOBILE, number: '+971 50 ۱۲۳ 4567' }] },
    })
    expect(links(fromPhone)).toContain('href="https://wa.me/971501234567"')
    expect(links(crm({ contact: { whatsapp_number: '', phones: [LANDLINE] } }))).toContain(
      'href="[crm-whatsapp-link]"',
    )
    // A per-phone link (data-phone) is the script's.
    expect(run(crm(), '<a href="[crm-whatsapp-link]" data-phone="1">x</a>')).toBe(
      '<a href="[crm-whatsapp-link]" data-phone="1">x</a>',
    )
  })

  it('maps: the search fallback from the address; a non-http link stays the script’s', () => {
    expect(links(crm({ location: { ...crm().location, maps_url: '' } }))).toContain(
      "href='https://www.google.com/maps/search/?api=1&amp;query=250%20Al%20Meena%20Street%2C%20Al%20Zahiyah%2C%20Abu%20Dhabi%2C%20UAE'",
    )
    expect(links(crm({ location: { ...crm().location, maps_url: 'javascript:alert(1)' } }))).toContain(
      "href='[crm-maps-link]'",
    )
  })

  it('booking: an in-page target only (http(s) needs the script’s target/rel); escaped per quote', () => {
    expect(links(crm({ booking: { url: 'https://book.example/x' } }))).toContain('href="[crm-booking-url]"')
    expect(links(crm({ booking: { url: '#reserve' } }))).toContain('href="#reserve"')
    expect(links(crm({ booking: { url: '#a"b&c' } }))).toContain('href="#a&quot;b&amp;c"')
    expect(run(crm({ booking: { url: "#a'b" } }), "<a href='[crm-booking-url]'>x</a>")).toBe(
      "<a href='#a&#39;b'>x</a>",
    )
  })

  it('unquoted, other elements, an entity-written token', () => {
    expect(run(crm(), '<a href=[crm-booking-url]>x</a>')).toBe('<a href=[crm-booking-url]>x</a>')
    expect(run(crm(), '<area href="[crm-booking-url]">')).toBe('<area href="[crm-booking-url]">')
    // The script matches the attribute's value: a token written with a reference counts (beside other slots).
    expect(run(crm(), '<a href="&#91;crm-booking-url]">x</a><i data-crm="x"></i>')).toBe(
      '<a href="#book">x</a><i data-crm="x"></i>',
    )
  })
})

describe('what is never filled', () => {
  it.each([
    ['inside a template', '<template><span data-crm="spa-name"></span></template>'],
    [
      'inside a list container',
      '<ul data-crm-list="services"><li><span data-crm="spa-name"></span></li></ul>',
    ],
    ['a list container itself', '<span data-crm-list="services" data-crm="spa-name"></span>'],
    ['an element with content', '<span data-crm="spa-name">Mine</span>'],
    ['an element with markup', '<span data-crm="spa-name"><i></i></span>'],
    ['the map link’s text', '<a data-crm="address" href="#x"></a>'],
    ['its own data-crm-text', '<span data-crm="spa-name" data-crm-text="ui.cta.book_now"></span>'],
    ['its own data-crm-tpl', '<span data-crm="spa-name" data-crm-tpl></span>'],
    ['live-status', '<span data-crm="live-status"></span>'],
    ['an unknown key', '<span data-crm="hours-varies"></span><span data-crm="toString"></span>'],
    ['a raw-text element', '<textarea data-crm="spa-name"></textarea><title data-crm="spa-name"></title>'],
    [
      'comments and scripts',
      '<!-- <span data-crm="spa-name"></span> --><script>"<span data-crm=\\"city\\"></span>"</script>',
    ],
    ['a void element', '<input data-crm="spa-name">'],
    [
      'table and select parts (the parser moves their text out)',
      '<table><tbody data-crm="city"><tr data-crm="phone"></tr></tbody></table><select data-crm="city"></select>',
    ],
    ['an unclosed element', '<span data-crm="spa-name"> <div></div>'],
    [
      'links inside a list (outside its template) and other links inside a template',
      '<div data-crm-list="services"><a href="[crm-booking-url]">x</a></div><template><a href="[crm-whatsapp-link]">w</a><a href="[crm-maps-link]">m</a></template>',
    ],
  ])('%s', (_, body) => {
    const html = page(crm(), body)
    expect(prefillCrmMarkup(html, { now: NOW })).toBe(html)
  })

  it('an in-page booking link inside a template gets its href (an https booking url stays the script’s)', () => {
    const body =
      '<div data-crm-list="services"><template><a class="book-link" href="[crm-booking-url]" data-book-service="[service-id]">Book</a></template></div>'
    expect(prefillCrmMarkup(page(crm(), body), { now: NOW })).toBe(
      page(crm(), body.replace('[crm-booking-url]', '#book')),
    )
    const https = page(crm({ booking: { url: 'https://book.example/x' } }), body)
    expect(prefillCrmMarkup(https, { now: NOW })).toBe(https)
  })

  it('data-if: nothing in a part the script hides (no hours / no address)', () => {
    const none = crm({ hours: [], location: { maps_url: '' } })
    const html = page(none, VISIT)
    expect(prefillCrmMarkup(html, { now: NOW })).toBe(html)
    // The data-crm-tpl form note's slots follow its own data-if.
    const note =
      '<span data-if="has-hours" data-crm-text="ui.hours.form_note" data-crm-tpl>Open <span data-crm="operating-days"></span>, <span data-crm="working-hours"></span></span>'
    expect(run(none, note)).toBe(note)
    expect(run(crm(), note)).toBe(
      '<span data-if="has-hours" data-crm-text="ui.hours.form_note" data-crm-tpl>Open <span data-crm="operating-days">every day</span>, <span data-crm="working-hours">11 AM – 2 AM</span></span>',
    )
    // An unknown data-if key doesn't hide; a list key hides when its list is empty.
    expect(run(crm(), '<div data-if="nope"><span data-crm="city"></span></div>')).toContain('>Abu Dhabi<')
    expect(run(crm(), '<div data-if="staff"><span data-crm="city"></span></div>')).toBe(
      '<div data-if="staff"><span data-crm="city"></span></div>',
    )
  })

  it('escapes text (& < > and { as an entity) and keeps whitespace-only content replaced', () => {
    const odd = crm({ spa: { name: 'A & B <Spa> {{x}}' } })
    expect(run(odd, '<span data-crm="spa-name">\n  </span>')).toBe(
      '<span data-crm="spa-name">A &amp; B &lt;Spa&gt; &#123;&#123;x}}</span>',
    )
  })
})

describe('list rows: phones, whatsapp-phones, hours-rows before their template', () => {
  it('phones: kind, number, copy attribute; the template and its whitespace stay', () => {
    expect(run(crm(), PHONES)).toBe(`<div class="nums" data-crm-list="phones" data-if="phones">
  <div class="num"><div><span class="mono" data-item="kind">landline · calls</span><b data-crm="phone" data-phone="0">02 557 6533</b></div><button class="copy" type="button" data-item-copy="number" data-crm-text="ui.contact.copy" data-copy="+97125576533">Copy</button></div><div class="num"><div><span class="mono" data-item="kind">mobile · whatsapp</span><b data-crm="phone" data-phone="1">052 510 8633</b></div><button class="copy" type="button" data-item-copy="number" data-crm-text="ui.contact.copy" data-copy="+971525108633">Copy</button></div><template>
    <div class="num"><div><span class="mono" data-item="kind"></span><b data-crm="phone" data-phone="[phone-index]"></b></div><button class="copy" type="button" data-item-copy="number" data-crm-text="ui.contact.copy">Copy</button></div>
  </template>
</div>`)
  })

  it('call list: a per-phone WhatsApp link, hidden (data-if) where the number has no WhatsApp', () => {
    const out = run(crm(), CALLS)
    expect(out).toContain(
      '<li><div><b data-crm="phone" data-phone="0">02 557 6533</b><span class="mono" data-item="kind">landline · calls</span></div><a class="wa-btn" href="https://wa.me/97125576533?text=Hello%20Be%20Relax%2C%20I%20would%20like%20to%20book." data-phone="0" data-if="whatsapp" hidden=""><span data-crm-text="ui.contact.whatsapp">WhatsApp</span></a></li>',
    )
    expect(out).toContain(
      '<a class="wa-btn" href="https://wa.me/971525108633?text=Hello%20Be%20Relax%2C%20I%20would%20like%20to%20book." data-phone="1" data-if="whatsapp"><span',
    )
    expect(out.indexOf('</li><template>')).toBeGreaterThan(0)
  })

  it('whatsapp-phones (Arabic): only WhatsApp numbers, the row texts localised as bindUi does', () => {
    const out = run(crm({ locale: 'ar', ui: UI_AR }), WA)
    expect(out).toBe(
      '<div class="wa-list" data-crm-list="whatsapp-phones" data-if="whatsapp-phones"><a class="pill" href="https://wa.me/971525108633?text=Hello%20Be%20Relax%2C%20I%20would%20like%20to%20book." data-phone="1"><span data-crm-text="ui.contact.whatsapp">واتساب</span> <span data-crm="phone" data-phone="1">052 510 8633</span></a><template><a class="pill" href="[crm-whatsapp-link]" data-phone="[phone-index]"><span data-crm-text="ui.contact.whatsapp">WhatsApp</span> <span data-crm="phone" data-phone="[phone-index]"></span></a></template></div>',
    )
    // Arabic kinds.
    expect(run(crm({ locale: 'ar', ui: UI_AR }), PHONES)).toContain(
      'data-item="kind">هاتف أرضي · اتصال</span>',
    )
  })

  it('hours-rows: only when the hours vary (data-if="hours-varies"), a row per group', () => {
    const hours = [
      ...['mon', 'tue', 'wed', 'thu'].map((day) => ({ day, open: '11:00', close: '02:00', closed: false })),
      ...['fri', 'sat'].map((day) => ({ day, open: '11:00', close: '03:00', closed: false })),
      { day: 'sun', open: '', close: '', closed: true },
    ]
    const out = run(crm({ hours }), VISIT)
    expect(out).toContain(
      '<ul class="hours-list" data-if="hours-varies" data-crm-list="hours-rows"><li><span data-item="days">Mon – Thu</span><b data-item="time">11 AM – 2 AM</b></li><li><span data-item="days">Fri – Sat</span><b data-item="time">11 AM – 3 AM</b></li><li><span data-item="days">Sun</span><b data-item="time">Closed</b></li><template>',
    )
    expect(out).toContain('<span class="big" data-crm="working-hours">hours vary by day</span>')
    expect(out).toContain('<span class="mono status" data-crm="live-status"></span>')
    // The same hours every day: the list is hidden, no rows.
    expect(run(crm(), VISIT)).toContain('data-crm-list="hours-rows"><template>')
  })

  it('no rows: an empty or hidden list, other lists, a container with other children, tables', () => {
    const none = crm({ contact: { whatsapp_number: '', phones: [] } })
    expect(run(none, PHONES)).toBe(PHONES)
    expect(run(none, `<div data-if="phones">${CALLS}</div>`)).toBe(`<div data-if="phones">${CALLS}</div>`)
    const services = '<ul data-crm-list="services"><template><li data-item="name"></li></template></ul>'
    expect(run(crm({ services: [{ id: 'a', name: 'A' }] }), services)).toBe(services)
    const sample = PHONES.replace('<template>', '<div class="num">Sample</div><template>')
    expect(run(crm(), sample)).toBe(sample)
    const text = PHONES.replace('<template>', 'Call us<template>')
    expect(run(crm(), text)).toBe(text)
    const table =
      '<table data-crm-list="phones"><template><tr><td data-crm="phone"></td></tr></template></table>'
    expect(run(crm(), table)).toBe(table)
  })

  // Rows stand in the document, where the parser closes a <p> before a block, an <a> before an <a>, … (in a
  // template they were walled off): such a list keeps its template only, as do rows that would act there.
  const wa = (row: string) => `<div data-crm-list="whatsapp-phones"><template>${row}</template></div>`
  it.each([
    [
      'a <p> container with block rows',
      PHONES.replaceAll('<div class="nums"', '<p class="nums"').replace(/<\/div>$/, '</p>'),
    ],
    [
      'an <a> above <a> rows',
      `<a href="#x">${wa('<a href="[crm-whatsapp-link]" data-phone="[phone-index]">x</a>')}</a>`,
    ],
    [
      'an <li> above <li> rows',
      `<ul><li>${wa('<li><b data-crm="phone" data-phone="[phone-index]"></b></li>')}</li></ul>`,
    ],
    ['a <p> above', `<p><span>${wa('<span data-crm="phone"></span>')}</span></p>`],
    [
      'a container the parser does not close for rows only (span)',
      '<span data-crm-list="phones"><template><i></i></template></span>',
    ],
    ['a container inside svg', '<svg><g data-crm-list="phones"><template><path/></template></g></svg>'],
    ['a block in a row’s <p>', wa('<p><span><div data-crm="phone"></div></span></p>')],
    ['<li> in a row’s <li>', wa('<li><div><li></li></div></li>')],
    ['<dt> in a row’s <dd>', wa('<dl><dd><dt></dt></dd></dl>')],
    ['a heading in a heading', wa('<h3><span><h4></h4></span></h3>')],
    ['<a> in a row’s <a>', wa('<a href="#a"><div><a href="#b">x</a></div></a>')],
    ['<button> in a <button>', wa('<button><button></button></button>')],
    ['HTML in svg', wa('<svg><g><span></span></g></svg>')],
    ['an element in an svg title', wa('<svg><title><i>x</i></title></svg>')],
    ['a script', wa('<span data-crm="phone"></span><script>count++</script>')],
    ['a script in svg', wa('<svg><script>count++</script></svg>')],
    ['a picture', wa('<span><img src="/a.png" alt=""></span>')],
    ['an iframe', wa('<iframe src="/x"></iframe>')],
    ['a style', wa('<style>b{}</style><b></b>')],
    ['a form', wa('<form><b></b></form>')],
    [
      'table rows',
      '<div data-crm-list="phones"><template><tr><td data-crm="phone"></td></tr></template></div>',
    ],
    ['an event handler', wa('<span onclick="go()"></span>')],
    ['a custom element', wa('<x-icon></x-icon>')],
    ['autofocus', wa('<button autofocus>Copy</button>')],
  ])('no rows: %s', (_, body) => {
    expect(run(crm(), body)).toBe(body)
  })

  it('rows next to a nested template’s inert content and an svg title text are still rendered', () => {
    const body = wa(
      '<span data-crm="phone" data-phone="[phone-index]"></span><svg><title>WhatsApp</title><path d="M0 0"/></svg><template><p><div></div></p><script>x</script></template>',
    )
    const out = run(crm(), body)
    expect(out).toContain(
      '<span data-crm="phone" data-phone="1">052 510 8633</span><svg><title>WhatsApp</title><path d="M0 0"/></svg><template><p><div></div></p><script>x</script></template><template>',
    )
  })

  it('row markup: placeholders, data-item / data-crm-attr / data-crm-tpl / nested templates / svg', () => {
    const tpl =
      '<ol data-crm-list="phones"><template>' +
      '<li data-x="[phone-index]" data-y="[service-id]"><svg viewBox="0 0 1 1"><path d="M0 0"/></svg>' +
      '<i data-item="label"></i><i data-item="whatsapp"></i><input data-item-alt="display" alt="old"><b data-item-alt="display"></b>' +
      '<span data-crm-attr="title:ui.contact.copy; aria-label:ui.nope; bad name:ui.contact.copy"></span>' +
      '<em data-crm-text="ui.hours.form_note" data-crm-tpl></em><span data-crm="city">x</span>' +
      '<template><b data-crm="phone"></b></template></li></template></ol>'
    const out = run(crm({ contact: { whatsapp_number: '', phones: [LANDLINE] } }), tpl)
    expect(out).toBe(
      '<ol data-crm-list="phones"><li data-x="0" data-y="[service-id]"><svg viewBox="0 0 1 1"><path d="M0 0"/></svg>' +
        '<i data-item="label"></i><i data-item="whatsapp">false</i><input data-item-alt="display" alt="02 557 6533"><b data-item-alt="display"></b>' +
        '<span data-crm-attr="title:ui.contact.copy; aria-label:ui.nope; bad name:ui.contact.copy" title="Copy"></span>' +
        '<em data-crm-text="ui.hours.form_note" data-crm-tpl>Open <span>every day</span>, <span>11 AM – 2 AM</span></em><span data-crm="city">Abu Dhabi</span>' +
        '<template><b data-crm="phone"></b></template></li>' +
        tpl.slice(tpl.indexOf('<template>'), tpl.length - '</ol>'.length) +
        '</ol>',
    )
  })
})

describe('the live page order: page texts first (positional ids), then the prefill', () => {
  it('a page-text override after a slot keeps its id; the slot is filled', () => {
    const design = page(
      crm(),
      '<h2>Find us</h2><p data-crm="address"></p><p>Call or WhatsApp</p><footer><span data-crm="city"></span> Hello</footer>',
    )
    const texts = listHtmlDesignTexts(design)
    const call = texts.find((x) => x.text === 'Call or WhatsApp')!
    const doc = htmlDesignDocument(
      design,
      {},
      false,
      [],
      {},
      {
        top: true,
        texts: [{ id: call.id, src: call.src, t: { en: 'Ring us' } }],
      },
    )
    const out = prefillCrmMarkup(doc, { now: NOW })
    expect(out).toContain('<p>Ring us</p>')
    expect(out).toContain('<p data-crm="address">250 Al Meena Street, Al Zahiyah, Abu Dhabi, UAE</p>')
    expect(out).toContain('<span data-crm="city">Abu Dhabi</span> Hello')
    // The stored design's ids don't change (the prefill never touches the file).
    expect(listHtmlDesignTexts(design)).toEqual(texts)
  })
})
