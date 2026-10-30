const fs = require('fs')
const path = require('path')
const {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, WidthType, AlignmentType,
  BorderStyle, ShadingType, LevelFormat, Footer, PageNumber, TabStopType, PageBreak, VerticalAlign,
} = require('docx')

const DIR = __dirname
const GREEN = '0F6B4B', MUTED = '59645D', INK = '111A15', LINE = 'DDE5DD', LIME = 'EFF9C8', MINT = 'EEF5EE'
const FONT = 'Arial'
const W = 9638 // A4 width minus 2 cm margins each side, in DXA

const t = (text, o = {}) => new TextRun({ text, font: FONT, size: o.size ?? 19, bold: o.bold, color: o.color ?? INK, italics: o.italics, shading: o.bg ? { type: ShadingType.CLEAR, color: 'auto', fill: o.bg } : undefined })
const p = (runs, o = {}) => new Paragraph({ children: Array.isArray(runs) ? runs : [runs], alignment: o.align, spacing: { before: o.before ?? 0, after: o.after ?? 40 }, numbering: o.bullet ? { reference: 'bullets', level: 0 } : undefined })
const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
const noBorders = { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none }
const line = { style: BorderStyle.SINGLE, size: 4, color: LINE }

function cell(children, width, o = {}) {
  return new TableCell({
    children: Array.isArray(children) ? children : [children],
    width: { size: width, type: WidthType.DXA },
    shading: o.fill ? { type: ShadingType.CLEAR, color: 'auto', fill: o.fill } : undefined,
    borders: o.borders ?? { top: none, left: none, right: none, bottom: line },
    margins: { top: 70, bottom: 70, left: 110, right: 110 },
    verticalAlign: o.v ?? VerticalAlign.TOP,
    columnSpan: o.span,
  })
}

function header() {
  const sm = new ImageRun({ type: 'png', data: fs.readFileSync(path.join(DIR, 'sm-logo.png')), transformation: { width: 150, height: 58 } })
  const labs = new ImageRun({ type: 'png', data: fs.readFileSync(path.join(DIR, 'labs-logo.png')), transformation: { width: 102, height: 14 } })
  const left = [p(sm), p([t('Powered by  ', { size: 16, color: MUTED }), labs])]
  const right = [
    p(t('Spa Management', { bold: true }), { align: AlignmentType.RIGHT }),
    p(t('1997labs Tech Solutions', { bold: true }), { align: AlignmentType.RIGHT }),
    p(t('ask@spamanagement.co · 1997labs.com', { size: 17, color: MUTED }), { align: AlignmentType.RIGHT }),
  ]
  return [
    new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: [4819, 4819], borders: noBorders,
      rows: [new TableRow({ children: [cell(left, 4819, { borders: noBorders }), cell(right, 4819, { borders: noBorders, v: VerticalAlign.CENTER })] })] }),
    new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: GREEN, space: 4 } }, spacing: { after: 160 }, children: [] }),
  ]
}

function titleBlock(dueLabel, dueValue) {
  const meta = [['Invoice no.', '[SM-INV-2026-000]'], ['Date', '[DD Mon YYYY]'], [dueLabel, dueValue], ['Currency', 'AED']]
  const rows = meta.map(([k, v]) => new TableRow({ children: [
    cell(p(t(k, { color: MUTED, size: 18 }), { align: AlignmentType.RIGHT, after: 0 }), 1700, { borders: noBorders }),
    cell(p(t(v, { bold: true, size: 18 }), { align: AlignmentType.RIGHT, after: 0 }), 2300, { borders: noBorders }),
  ] }))
  const metaTable = new Table({ width: { size: 4000, type: WidthType.DXA }, columnWidths: [1700, 2300], borders: noBorders, rows, alignment: AlignmentType.RIGHT })
  return new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: [5638, 4000], borders: noBorders, rows: [new TableRow({ children: [
    cell(p(t('Invoice', { bold: true, size: 40, color: GREEN })), 5638, { borders: noBorders, v: VerticalAlign.BOTTOM }),
    cell(metaTable, 4000, { borders: noBorders }),
  ] })] })
}

function boxes(planLines) {
  const box = { top: line, bottom: line, left: line, right: line }
  const h = (s) => p(t(s, { bold: true, color: GREEN, size: 17 }), { after: 60 })
  const bill = [h('BILL TO'), p(t('[Spa legal name]', { bold: true, size: 18 })), p(t('[Area, City], United Arab Emirates', { size: 18 })), p(t('Tel: [phone] · WhatsApp: [WhatsApp]', { size: 18 }))]
  const plan = [h('PLAN'), p([t('[Premium] plan  ', { bold: true, size: 18 }), t(' SPECIAL OFFER ', { bold: true, size: 15, color: '1D2A06', bg: 'D9F26A' })]), ...planLines]
  return [new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: [4769, 100, 4769], borders: noBorders, rows: [new TableRow({ children: [
    cell(bill, 4769, { borders: box }), cell(p(''), 100, { borders: noBorders }), cell(plan, 4769, { borders: box }),
  ] })] }), p('', { after: 120 })]
}

const COLS = [5638, 800, 1600, 1600]
function itemsTable(rows) {
  const head = new TableRow({ tableHeader: true, children: ['Description', 'Qty', 'Unit price', 'Amount'].map((h, i) =>
    cell(p(t(h, { bold: true, color: 'FFFFFF', size: 18 }), { align: i ? AlignmentType.RIGHT : AlignmentType.LEFT, after: 0 }), COLS[i], { fill: GREEN, borders: noBorders })) })
  return new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: COLS, rows: [head, ...rows] })
}
function itemRow(title, detail, qty, unit, amount, o = {}) {
  const desc = [p(t(title, { bold: true, size: 18 }), { after: detail ? 20 : 0 })]
  if (detail) for (const d of [].concat(detail)) desc.push(typeof d === 'string' ? p(t(d, { size: 16, color: MUTED }), { after: 10 }) : d)
  const num = (s) => p(t(s, { size: 18, bold: o.bold }), { align: AlignmentType.RIGHT, after: 0 })
  return new TableRow({ children: [cell(desc, COLS[0], { fill: o.fill }), cell(num(qty), COLS[1], { fill: o.fill }), cell(num(unit), COLS[2], { fill: o.fill }), cell(num(amount), COLS[3], { fill: o.fill })] })
}
function offerRow(text, qty, unit, amount) {
  return new TableRow({ children: [
    cell(p([t(' SPECIAL OFFER ', { bold: true, size: 15, color: 'FFFFFF', bg: GREEN }), t('  ' + text, { bold: true, size: 18, color: '1D2A06' })], { after: 0 }), COLS[0], { fill: LIME }),
    ...[qty, unit, amount].map((s, i) => cell(p(t(s, { bold: true, size: 18, color: '1D2A06' }), { align: AlignmentType.RIGHT, after: 0 }), COLS[i + 1], { fill: LIME })),
  ] })
}
function totalRow(label, amount, o = {}) {
  return new TableRow({ children: [
    cell(p(t(label, { bold: o.bold, size: 18 }), { align: AlignmentType.RIGHT, after: 0 }), COLS[0] + COLS[1] + COLS[2], { span: 3, fill: o.fill }),
    cell(p(t(amount, { bold: o.bold, size: 18 }), { align: AlignmentType.RIGHT, after: 0 }), COLS[3], { fill: o.fill }),
  ] })
}
const h2 = (s) => p(t(s, { bold: true, size: 24, color: GREEN }), { before: 200, after: 80 })
const note = (s) => p(t(s, { size: 17, color: MUTED }), { before: 80, after: 80 })
const bullet = (runs) => p(Array.isArray(runs) ? runs : [t(runs, { size: 18 })], { bullet: true, after: 30 })
const official = () => p(t('This is an official invoice issued by 1997labs Tech Solutions (Spa Management); no stamp or signature is needed.', { size: 14, color: MUTED }), { align: AlignmentType.CENTER, before: 240 })

function footer() {
  return new Footer({ children: [new Paragraph({ tabStops: [{ type: TabStopType.RIGHT, position: W }], children: [
    t('Spa Management · ask@spamanagement.co · Powered by 1997 Labs · 1997labs.com', { size: 14, color: MUTED }),
    new TextRun({ text: '\tPage ', font: FONT, size: 14, color: MUTED }), new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 14, color: MUTED }), new TextRun({ text: ' of ', font: FONT, size: 14, color: MUTED }), new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: 14, color: MUTED }),
  ] })] })
}

function doc(children) {
  return new Document({ styles: { default: { document: { run: { font: FONT, size: 14, color: MUTED } } } },
    creator: '1997labs Tech Solutions',
    numbering: { config: [{ reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 240 } }, run: { size: 19, color: INK } } }] }] },
    sections: [{ properties: { page: { margin: { top: 1000, bottom: 1000, left: 1134, right: 1134 } } }, footers: { default: footer() }, children }],
  })
}

const planLines = [
  p(t('[Spa name] gets every [Premium] feature at the [Standard] plan price, as a special offer from Spa Management.', { size: 18 })),
  p([t('Website: ', { bold: true, size: 18 }), t('2 languages, English + Arabic. ', { size: 18 }), t('CRM system: ', { bold: true, size: 18 }), t('2 languages, English + Thai.', { size: 18 })]),
]

// ---------- Setup invoice ----------
const FEATURES = [
  ['A. Website', ['Website in 2 languages: English + Arabic (Arabic right-to-left); professionally designed and fast on phones', 'Your own website address with free SSL certificate', 'Services and prices, team and opening hours shown live from the system (prices can be hidden)', 'Home, Services, About, Contact and other pages; map link, phones, WhatsApp buttons and social links', 'Online booking with live free times, 24/7', 'Website enquiry and booking-request forms straight into the system (no email needed)', 'SEO basics: page titles and descriptions, sitemap, Google structured data, Search Console, redirects from old links', 'Google Ads / analytics tags and a moving offer bar', 'Website changes by our team ("Request a change" from your dashboard)']],
  ['B. Bookings and calendar', ['Calendar by therapist and room; no double bookings', 'Walk-ins with a fair turn list, waitlist, confirm / check-in / finish flow', 'WhatsApp confirmations, reminders and thank-you messages (ready to send in one tap)', "Dashboard: today's bookings and sales together, website alerts with pop-up and sound"]],
  ['C. Sales and point of sale', ['Sales and checkout; payments recorded by cash, card terminal or bank transfer; tips', 'Daily close and daily sales sheet (PDF)', 'Gift vouchers, packages and memberships', 'Products and stock, purchases, low-stock alerts']],
  ['D. Clients', ['Client records with visit history, notes, UAE and international phone numbers', 'Intake and waiver forms (PDF), duplicate merge, import and export']],
  ['E. Team and payroll', ['Staff profiles, roles and permissions, time clock', 'Commissions, payroll and WPS salary file', 'Staff documents with expiry reminders (visa, licence)']],
  ['F. Finance and reports', ['Reports and KPIs, profit and loss, tax reports, expenses, accounting export']],
  ['G. Marketing and growth', ['Google Business Profile link and reviews']],
  ['H. Included with every plan', ['CRM system in 2 languages: English + Thai; installs as an app on phones and tablets', 'Two-step login, activity log, daily backups, secure hosting in the cloud', 'Updates and new features at no extra cost; support by WhatsApp and email']],
]
function featuresTable() {
  const fc = [8238, 1400]
  const rows = [new TableRow({ tableHeader: true, children: [
    cell(p(t('Feature', { bold: true, color: 'FFFFFF', size: 18 }), { after: 0 }), fc[0], { fill: GREEN, borders: noBorders }),
    cell(p(t('Included', { bold: true, color: 'FFFFFF', size: 18 }), { align: AlignmentType.CENTER, after: 0 }), fc[1], { fill: GREEN, borders: noBorders }),
  ] })]
  for (const [g, items] of FEATURES) {
    rows.push(new TableRow({ children: [cell(p(t(g, { bold: true, color: GREEN, size: 17 }), { after: 0 }), fc[0] + fc[1], { span: 2, fill: MINT })] }))
    for (const it of items) rows.push(new TableRow({ children: [
      cell(p(t(it, { size: 16 }), { after: 0 }), fc[0]),
      cell(p(t('✓', { bold: true, color: GREEN, size: 16 }), { align: AlignmentType.CENTER, after: 0 }), fc[1]),
    ] }))
  }
  return new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: fc, rows })
}

const setup = doc([
  ...header(), titleBlock('Balance due', '[AED 0,000 on receipt]'), p('', { after: 120 }), ...boxes(planLines),
  h2('Invoice details'),
  itemsTable([
    itemRow('[Premium] plan: setup (one time)', 'Website design in 2 languages (English + Arabic); CRM system in 2 languages (English + Thai); onboarding, data import, menu, rooms and team set-up', '1', '[14,000.00]', '[14,000.00]'),
    offerRow('[Premium at the Standard price]', '1', '[−5,000.00]', '[−5,000.00]'),
    totalRow('Total setup (AED)', '[9,000.00]', { bold: true }),
    totalRow('Less: down payment received', '[−0,000.00]'),
    totalRow('Balance due (AED)', '[0,000.00]', { bold: true, fill: 'F6FAEF' }),
  ]),
  note('You save AED [5,000] on setup compared with the [Premium] list price. The monthly subscription (AED [2,000] instead of AED [3,000]) is invoiced separately each month and is due by the 10th of the month.'),
  h2('Payment'),
  bullet('Payment by bank transfer, cash or card payment link.'),
  bullet('Down payment of AED [0,000] already received with thanks. The remaining balance of AED [0,000] is due on receipt of this invoice.'),
  official(),
  new Paragraph({ children: [new PageBreak()] }),
  h2('[Premium] features included'),
  featuresTable(),
])

// ---------- Monthly invoice ----------
const inc = (label, rest) => p([t(label, { bold: true, size: 16 }), t(rest, { size: 16 })], { bullet: true, after: 10 })
const monthly = doc([
  ...header(), titleBlock('Due', '[By 10 Mon YYYY]'), p('', { after: 120 }), ...boxes(planLines),
  h2('Invoice details'),
  itemsTable([
    itemRow('[Premium] plan: monthly subscription', ['[Month YYYY] (1–[30] [Month]). Includes:',
      inc('Website', ' (English + Arabic) and CRM system (English + Thai): secure cloud hosting, SSL certificate'),
      inc('SEO care:', ' page titles and descriptions, Google sitemap and structured data, Google Search Console, redirects from old links, weekly SEO health check'),
      inc('Google Business Profile care:', ' keeping your Google profile up to date (opening hours, phone, services, photos, website link) and maintained'),
      inc('Support 7 days a week', ' by WhatsApp and email; website text and price changes on request'),
      inc('Daily backups and security updates,', ' so your data is safe'),
      inc('New features and system updates', ' at no extra cost'),
    ], '1', '[3,000.00]', '[3,000.00]'),
    offerRow('[Premium at the Standard price]', '1', '[−1,000.00]', '[−1,000.00]'),
    totalRow('Total due (AED)', '[2,000.00]', { bold: true, fill: 'F6FAEF' }),
  ]),
  note('You save AED [1,000] every month compared with the [Premium] list price.'),
  h2('Payment'),
  bullet('Payment by bank transfer, cash or card payment link.'),
  bullet([t('Must be paid by 10 [Month YYYY] at the latest.', { bold: true, size: 18 })]),
  bullet('The monthly subscription of AED [2,000] is invoiced each month and due by the 10th of that month.'),
  official(),
])

;(async () => {
  fs.writeFileSync(path.join(DIR, 'Setup Invoice - Template.docx'), await Packer.toBuffer(setup))
  fs.writeFileSync(path.join(DIR, 'Monthly Invoice - Template.docx'), await Packer.toBuffer(monthly))
  console.log('written')
})()
