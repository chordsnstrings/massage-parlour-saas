// Typesets the Spa Owner's Manual (Markdown chapters) into an A4 PDF.
// usage: node build.mjs en|th        -> ../out/Spa-Owner-s-Manual-{EN,TH}.pdf
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import MarkdownIt from 'markdown-it'
import { chromium } from 'playwright-core'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MAN = path.resolve(HERE, '..')
const lang = process.argv[2] ?? 'en'
const SRC = path.join(MAN, 'src/spa', lang)
const OUT = path.join(MAN, 'out')
const BUILD = path.join(HERE, 'build')
fs.mkdirSync(OUT, { recursive: true })
fs.mkdirSync(BUILD, { recursive: true })

const T = {
  en: {
    dir: 'ltr',
    title: "Spa Owner's Manual",
    kicker: "Owner's manual",
    subtitle:
      'How to run your spa every day with the spamanagement.co CRM: the calendar, bookings, clients, the till, staff, stock, accounts and your website’s menu.',
    audience: 'For spa owners',
    edition: 'English edition',
    date: 'October 2026',
    contents: 'Contents',
    chapter: 'Chapter',
    figure: 'Fig.',
    purpose: ['What this is for'],
    tip: ['Tip:'],
    important: ['Important:'],
    legend: ['In the screenshot'],
    file: 'Spa-Owner-s-Manual-EN',
  },
  th: {
    dir: 'ltr',
    title: 'คู่มือเจ้าของสปา',
    altTitle: "Spa Owner's Manual",
    kicker: 'คู่มือการใช้งาน',
    subtitle:
      'วิธีบริหารสปาของคุณในแต่ละวันด้วยระบบ CRM ของ spamanagement.co ทั้งปฏิทิน การจอง ลูกค้า แคชเชียร์ พนักงาน สต็อก บัญชี และเมนูบริการบนเว็บไซต์',
    audience: 'สำหรับเจ้าของสปา',
    keep: ['บนเว็บไซต์'],
    edition: 'ฉบับภาษาไทย',
    altEdition: 'Thai edition · screenshots show the English screens',
    date: 'ตุลาคม 2026',
    altDate: 'October 2026',
    contents: 'สารบัญ',
    chapter: 'บทที่',
    figure: 'ภาพที่',
    purpose: ['บทนี้ใช้ทำอะไร', 'ส่วนนี้ใช้ทำอะไร', 'What this is for'],
    tip: ['เคล็ดลับ:', 'Tip:'],
    important: ['สำคัญ:', 'Important:'],
    legend: ['ในภาพหน้าจอ', 'In the screenshot'],
    file: 'Spa-Owner-s-Manual-TH',
    // Loanwords Chrome's Thai line breaker splits mid-word (some mid-syllable): kept whole on one line.
    nobr: (
      'แดชบอร์ด ทรีตเมนต์ คอมมิชชัน อัลมอนด์ โปรไฟล์ แพ็กเกจ พาร์ทเนอร์ คิวอาร์ วอล์กอิน เทมเพลต แคชเชียร์ ' +
      'เว็บไซต์ คอนเซียร์จ สวีดิช โปสเตอร์ ออนไลน์ อีเมล โปรโมชัน สต็อก เช็กอิน แบนเนอร์ อินสตาแกรม อัปโหลด ' +
      'ดาวน์โหลด แคมเปญ ซัพพลายเออร์ บาร์โค้ด เวอร์ชัน สตูดิโอ แท็บเล็ต ไอคอน โซเชียล เบราว์เซอร์ เดสก์ท็อป ' +
      'เครดิต แพลตฟอร์ม ฟีเจอร์ รีเฟรช คอมพิวเตอร์ โปรแกรม อัปเดต คอลัมน์ ซิงก์ แบรนด์ โลโก้ โดเมน อโรมา ผ่อนผัน'
    ).split(' '),
    // Patterns kept whole too: a chapter reference ("บทที่ 7") never splits from its number or mid-word.
    nobrRe: ['บทที่ \\d+'],
    // Headings and table cells: break Thai only at spaces / between a label and its (gloss).
    phrases: true,
  },
}[lang]
if (!T) throw new Error(`unknown edition ${lang}`)

// ---------- Markdown -> HTML ----------
const md = new MarkdownIt({ html: false, linkify: false, typographer: false })
md.disable('autolink') // keep "<ask@spamanagement.co>" visible as written
const renderImage = md.renderer.rules.image
md.renderer.rules.image = (tokens, idx, opts, env, self) => {
  const tok = tokens[idx]
  const src = tok.attrGet('src')
  if (src && !/^[a-z]+:/i.test(src)) tok.attrSet('src', pathToFileURL(path.resolve(env.dir, src)).href)
  return renderImage(tokens, idx, opts, env, self)
}
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const cssStr = (s) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.md')).sort()
const chapters = files.map((f) => {
  const text = fs.readFileSync(path.join(SRC, f), 'utf8')
  const h1 = text.match(/^# (.+)$/m)[1].trim()
  const m = h1.match(/^(\d+)\.\s+(.*)$/)
  const id = `c-${f.replace(/\.md$/, '')}`
  const title = m ? m[2] : h1
  return { id, file: f, num: m ? m[1] : null, title, html: md.render(text, { dir: SRC }) }
})

// ---------- Running header / footer (CSS margin boxes; mirrored for RTL) ----------
const rtl = T.dir === 'rtl'
const start = rtl ? 'right' : 'left'
const end = rtl ? 'left' : 'right'
const hFont = `font: 600 7.4pt/1.2 'Space Grotesk', 'Noto Sans Thai', 'DM Sans', sans-serif; color: #0F6B4B; vertical-align: bottom; padding-bottom: 6.5mm;`
const hFontEnd = `font: 500 7.4pt/1.2 'DM Sans', 'Noto Sans Thai', sans-serif; color: #6B7A72; vertical-align: bottom; padding-bottom: 6.5mm;`
const fFont = `font: 500 7.4pt/1.2 'DM Sans', 'Noto Sans Thai', sans-serif; color: #6B7A72; vertical-align: top; padding-top: 6mm;`
const nFont = `font: 700 8.8pt/1 'Space Grotesk', sans-serif; color: #0F6B4B; vertical-align: top; padding-top: 5.7mm;`
const dirDecl = `direction: ${T.dir};`
let pageCss = `@page {
  @top-${start} { content: ${cssStr(T.title)}; ${hFont} ${dirDecl} text-align: ${start}; }
  @bottom-${start} { content: "spamanagement.co  \\00B7  ask@spamanagement.co"; ${fFont} direction: ltr; text-align: ${start}; }
  @bottom-${end} { content: counter(page); ${nFont} text-align: ${end}; }
}
@page cover { @top-${start} { content: none; } @bottom-${start} { content: none; } @bottom-${end} { content: none; } }
`
for (const c of chapters) {
  const label = c.num ? `${T.chapter} ${c.num}  ·  ${c.title}` : c.title
  pageCss += `@page p-${c.id} { @top-${end} { content: ${cssStr(label)}; ${hFontEnd} ${dirDecl} text-align: ${end}; } }\n`
}

// ---------- Document ----------
const logo = pathToFileURL(path.join(HERE, 'assets/logo.svg')).href
const tocItems = chapters
  .map(
    (c) => `<li class="${c.num ? 'ch' : c.file.startsWith('00') ? 'front' : 'back'}"><a href="#${c.id}">` +
      `<span class="toc-num">${c.num ?? ''}</span><span class="toc-t">${esc(c.title)}</span>` +
      `<span class="toc-dots"></span><span class="toc-pg" data-for="${c.id}">00</span></a></li>`,
  )
  .join('\n')
const html = `<!doctype html>
<html lang="${lang}" dir="${T.dir}">
<head>
<meta charset="utf-8">
<title>${esc(T.title)}${T.altTitle ? ` · ${esc(T.altTitle)}` : ''}</title>
<meta name="author" content="spamanagement.co">
<link rel="stylesheet" href="${pathToFileURL(path.join(HERE, 'style.css')).href}">
<style>${pageCss}</style>
</head>
<body>
<section class="cover">
  <div class="deco a"></div><div class="deco b"></div>
  <img class="logo" src="${logo}" alt="spamanagement.co">
  <div class="titles">
    <span class="kicker">${esc(T.kicker)}</span>
    <div class="cover-title" role="heading" aria-level="1">${esc(T.title)}</div>
    ${T.altTitle ? `<div class="alt-title" dir="ltr">${esc(T.altTitle)}</div>` : ''}
    <p class="subtitle">${(T.keep ?? []).reduce((s, k) => s.replace(k, `<span class="nobr">${k}</span>`), esc(T.subtitle))}</p>
    <div class="audience">${esc(T.audience)}</div>
  </div>
  <div class="panel">
    <div class="ed">${esc(T.edition)}</div>
    ${T.altEdition ? `<div class="alt-ed">${esc(T.altEdition)}</div>` : ''}
    <div class="date">${esc(T.date)}${T.altDate ? ` <span class="alt-date">· ${esc(T.altDate)}</span>` : ''}</div>
    <div class="rule"></div>
    <div class="site" dir="ltr">spamanagement.co</div>
    <div class="mail" dir="ltr">ask@spamanagement.co</div>
    <div class="ring"></div>
  </div>
</section>
<nav class="toc" id="toc">
  <h1>${esc(T.contents)}</h1>
  <div class="toc-rule"></div>
  <ol>${tocItems}</ol>
</nav>
${chapters
  .map(
    (c) => `<section class="chapter${c.file.startsWith('99') ? ' glossary' : ''}" id="${c.id}" style="page: p-${c.id}" ` +
      `data-num="${c.num ?? ''}" data-title="${esc(c.title)}">\n${c.html}</section>`,
  )
  .join('\n')}
</body>
</html>`
const htmlPath = path.join(BUILD, `spa-${lang}.html`)
fs.writeFileSync(htmlPath, html)

// ---------- DOM pass (runs in the page) ----------
function enhance(T) {
  const text = (el) => el.textContent.replace(/\s+/g, ' ').trim()
  const STEP = 8.5
  const BULLET = 6
  let figNo = 0
  const LARGE_TYPE = ['c24-s02-b']

  for (const sec of document.querySelectorAll('section.chapter')) {
    // Chapter header
    const h1 = sec.querySelector('h1')
    const head = document.createElement('div')
    head.className = 'ch-head'
    if (sec.dataset.num) {
      head.innerHTML = `<div class="ch-eyebrow"><span class="ch-label"></span><span class="ch-n"></span></div>`
      head.querySelector('.ch-label').textContent = T.chapter
      head.querySelector('.ch-n').textContent = sec.dataset.num
    }
    const nh = document.createElement('h1')
    nh.textContent = sec.dataset.title
    head.append(nh)
    h1.replaceWith(head)

    // "What this is for" box
    for (const h2 of [...sec.querySelectorAll(':scope > h2')]) {
      if (!T.purpose.includes(text(h2))) continue
      const box = document.createElement('div')
      box.className = 'purpose'
      h2.before(box)
      let n = h2.nextElementSibling
      box.append(h2)
      while (n && n.tagName === 'P') {
        const next = n.nextElementSibling
        box.append(n)
        n = next
      }
    }
  }

  // Screenshots -> figures
  for (const img of [...document.querySelectorAll('section.chapter p > img')]) {
    const p = img.parentElement
    if (p.childNodes.length !== 1) continue
    const fig = document.createElement('figure')
    fig.className = 'shot'
    const ratio = img.naturalHeight / img.naturalWidth
    fig.dataset.ratio = String(ratio)
    fig.dataset.natW = String(img.naturalWidth)
    // Shots of the public website have large type: they may print smaller (down to 55 %) to stay with their legend.
    if (LARGE_TYPE.some((id) => img.src.includes(`/${id}.`))) fig.dataset.minScale = '0.55'
    if (img.naturalWidth < 700 && ratio > 1.6) fig.classList.add('phone')
    else if (ratio > 1.15) fig.classList.add('tall')
    else if (ratio > 0.75) fig.classList.add('square')
    fig.append(img)
    if (img.alt) {
      const cap = document.createElement('figcaption')
      const no = document.createElement('span')
      no.className = 'fig-no'
      no.textContent = `${T.figure} ${++figNo}`
      cap.append(no, document.createTextNode(img.alt))
      fig.append(cap)
    }
    // Full column width: pull the figure out of list indents.
    let indent = 0
    for (let a = p.parentElement; a && a.tagName !== 'SECTION'; a = a.parentElement) {
      if (a.tagName === 'OL') indent += STEP
      else if (a.tagName === 'UL') indent += BULLET
    }
    fig.dataset.indent = String(indent)
    p.replaceWith(fig)
  }

  // Legends ("In the screenshot:" + list)
  for (const p of [...document.querySelectorAll('section.chapter p')]) {
    if (!(p.children.length === 1 && p.firstElementChild.tagName === 'EM' && text(p) === text(p.firstElementChild) && /:$/.test(text(p)) && T.legend.some((l) => text(p).startsWith(l)))) continue
    const box = document.createElement('div')
    box.className = 'legend'
    const list = p.nextElementSibling
    p.before(box)
    p.className = 'legend-title'
    p.textContent = text(p).replace(/:$/, '')
    box.append(p)
    if (list && list.tagName === 'OL') {
      list.classList.add('legend-list')
      const s = Number.parseInt(list.getAttribute('start') ?? '1', 10)
      if (s !== 1) list.style.counterReset = `lg ${s - 1}`
      box.append(list)
    }
  }

  // Screenshot sizing: full column width, but never taller than the page allows and never blown up
  // far past the screen size (small dialogs). Narrow results sit beside their legend.
  const COL = 178
  for (const fig of [...document.querySelectorAll('figure.shot')]) {
    const img = fig.querySelector('img')
    const ratio = Number(fig.dataset.ratio)
    const phone = img.naturalWidth < 700 && ratio > 2
    const strip = ratio > 3
    const maxH = strip ? 196 : phone ? 150 : ratio > 1.15 ? 190 : ratio > 0.75 ? 150 : 125
    let w = Math.min(COL, img.naturalWidth * 0.16, maxH / ratio)
    if (phone && !strip) w = Math.min(w, 70)
    img.style.width = `${w.toFixed(1)}mm`
    fig.classList.toggle('phone', phone)
    img.dataset.wFirst = w.toFixed(1)
    const row = document.createElement('div')
    const legend = fig.nextElementSibling
    const hasLegend = !!(legend && legend.classList.contains('legend'))
    if (hasLegend && ratio > 1.15) w = Math.min(w, 105)
    img.style.width = `${w.toFixed(1)}mm`
    const pair = w <= 112 && hasLegend
    row.className = pair ? 'pair' : 'fig-row'
    fig.before(row)
    row.append(fig)
    if (pair) {
      fig.style.width = `${w.toFixed(1)}mm`
      row.append(legend)
    }
    const indent = Number(fig.dataset.indent || 0)
    if (indent) {
      row.style.marginInlineStart = `-${indent}mm`
      row.style.width = `calc(100% + ${indent}mm)`
    }
  }

  // Bold-only paragraphs ending in ":" introduce the list below them: treat as small headings.
  for (const p of document.querySelectorAll('section.chapter p')) {
    if (p.children.length === 1 && p.firstElementChild.tagName === 'STRONG' && text(p) === text(p.firstElementChild) && /:$/.test(text(p)))
      p.classList.add('lead-in')
  }

  // Step lists (respect start=)
  for (const ol of document.querySelectorAll('section.chapter ol:not(.legend-list)')) {
    ol.classList.add('steps')
    const s = Number.parseInt(ol.getAttribute('start') ?? '1', 10)
    if (s !== 1) ol.style.counterReset = `step ${s - 1}`
  }

  // Tip / Important callouts
  for (const bq of document.querySelectorAll('section.chapter blockquote')) {
    const s = bq.querySelector(':scope > p:first-child > strong:first-child')
    const label = s ? text(s) : ''
    const kind = T.tip.includes(label) ? 'tip' : T.important.includes(label) ? 'important' : null
    if (!kind) {
      bq.classList.add('note')
      continue
    }
    bq.classList.add('callout', kind)
    s.className = 'callout-label'
    s.textContent = label.replace(/[:：]$/, '')
    const after = s.nextSibling
    if (after && after.nodeType === 3) after.textContent = after.textContent.replace(/^\s+/, '')
  }

  // Thai: keep loanwords whole, heading phrases (space to space) whole and short (glosses) in table cells
  // whole, so the line breaker never splits them mid-word.
  if (T.nobr || T.phrases) {
    const TH = /[฀-๿]/
    const words = [...(T.nobr ?? [])].sort((a, b) => b.length - a.length)
    const alts = [...(T.nobrRe ?? []), ...words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))]
    const wordRe = alts.length ? new RegExp(alts.join('|'), 'g') : null
    const wrapText = (node, re, ok = () => true) => {
      const s = node.nodeValue
      re.lastIndex = 0
      let m
      let last = 0
      const frag = document.createDocumentFragment()
      while ((m = re.exec(s))) {
        if (!m[0] || !ok(m[0])) continue
        if (m.index > last) frag.append(s.slice(last, m.index))
        const span = document.createElement('span')
        span.className = 'nobr'
        span.textContent = m[0]
        frag.append(span)
        last = m.index + m[0].length
      }
      if (!last) return
      if (last < s.length) frag.append(s.slice(last))
      node.replaceWith(frag)
    }
    const textNodes = (root) => {
      const out = []
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        if (n.parentElement.closest('.nobr, code, .figmark') || !TH.test(n.nodeValue)) continue
        out.push(n)
      }
      return out
    }
    if (T.phrases) {
      for (const h of document.querySelectorAll('.ch-head h1, section.chapter :is(h2, h3), .toc .toc-t'))
        for (const n of textNodes(h)) wrapText(n, /[^\s]+/g, (t) => TH.test(t) && t.length <= 40)
      for (const c of document.querySelectorAll('section.chapter :is(td, th)'))
        for (const n of textNodes(c)) wrapText(n, /\([^()\s]{1,24}\)/g, (t) => TH.test(t))
    }
    if (wordRe)
      for (const sec of document.querySelectorAll('section.chapter, .toc'))
        for (const n of textNodes(sec)) wrapText(n, wordRe)
  }

  // Keep each h2/h3 with the block that follows it, and a short paragraph ending in ":" with the table or list
  // it introduces ("What the status badge means:").
  const intros = [...document.querySelectorAll('section.chapter > p:not(.lead-in)')].filter(
    (p) => /:$/.test(text(p)) && text(p).length < 140 && /^(TABLE|UL|OL)$/.test(p.nextElementSibling?.tagName ?? ''),
  )
  for (const h of [...document.querySelectorAll('section.chapter :is(h2, h3, h4, p.lead-in)'), ...intros]) {
    if (h.closest('.purpose')) continue
    const next = h.nextElementSibling
    if (!next || !/^(P|TABLE|UL|OL|BLOCKQUOTE)$/.test(next.tagName) || next.offsetHeight > 420) continue
    const keep = document.createElement('div')
    keep.className = 'keep'
    h.before(keep)
    keep.append(h, next)
  }

  const all = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]')]
  return {
    outlineTitles: all.map((h) => text(h)),
    chapterIdx: [...document.querySelectorAll('section.chapter .ch-head h1')].map((h) => all.indexOf(h)),
    headings: [...document.querySelectorAll('section.chapter :is(h2, h3, h4, p.lead-in)')].map((h) => text(h)),
    figures: figNo,
  }
}

// ---------- Print (two passes for the contents page numbers) ----------
const exe = fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined
const browser = await chromium.launch({ executablePath: exe })
const page = await browser.newPage({ viewport: { width: 673, height: 1000 } })
await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' })
await page.evaluate(async () => {
  await document.fonts.ready
  await Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => (i.onload = i.onerror = r)))))
})
await page.emulateMedia({ media: 'print' })
const info = await page.evaluate(enhance, T)
const py = (...args) => JSON.parse(execFileSync('python3', [path.join(HERE, 'pdfinfo.py'), ...args], { encoding: 'utf8' }))
// Downscale screenshots to their print size, then swap them in (layout is fixed by the mm widths).
const shots = await page.evaluate(() =>
  [...document.querySelectorAll('figure.shot img')].map((i) => ({ src: decodeURI(new URL(i.src).pathname), mm: Number.parseFloat(i.style.width) })),
)
const IMG = path.join(BUILD, 'img')
fs.mkdirSync(IMG, { recursive: true })
const jobs = shots.map((s) => ({
  src: s.src,
  out: path.join(IMG, `${path.basename(s.src, path.extname(s.src))}-${Math.round(s.mm)}`),
  px: Math.round((s.mm / 25.4) * 220),
}))
fs.writeFileSync(path.join(BUILD, `resize-${lang}.json`), JSON.stringify(jobs))
const { outs } = py('resize', path.join(BUILD, `resize-${lang}.json`))
await page.evaluate(async (outs) => {
  const imgs = [...document.querySelectorAll('figure.shot img')]
  await Promise.all(
    imgs.map((img, k) => new Promise((r) => { img.onload = img.onerror = r; img.src = outs[k] })),
  )
}, outs.map((o) => pathToFileURL(o).href))
const overflow = await page.evaluate(() => {
  const col = document.querySelector('section.chapter').getBoundingClientRect()
  const out = []
  for (const el of document.querySelectorAll('section.chapter :is(p, li, td, th, figcaption, h1, h2, h3, blockquote, table, img, .pair)')) {
    const r = el.getBoundingClientRect()
    if (el.scrollWidth > el.clientWidth + 2 || r.left < col.left - 2 || r.right > col.right + 2)
      out.push(`${el.tagName} ${el.textContent.trim().slice(0, 60)}`)
  }
  return out
})
const missing = await page.evaluate(() => [...document.images].filter((i) => !i.naturalWidth).map((i) => i.src))
if (missing.length) throw new Error(`images failed to load:\n${missing.join('\n')}`)
fs.writeFileSync(path.join(BUILD, `headings-${lang}.json`), JSON.stringify(info.headings))
fs.writeFileSync(path.join(BUILD, `spa-${lang}.final.html`), await page.content())

const pdfPath = path.join(OUT, `${T.file}.pdf`)
const pass = path.join(BUILD, `pass-${lang}.pdf`)
const printTo = (p) =>
  page.pdf({ path: p, preferCSSPageSize: true, printBackground: true, outline: true, tagged: true })

// Bookmarks come out in document order (one per heading), so chapter h1 #k is outline entry chapterIdx[k].
const pageMap = (pdf) => {
  const { outline } = py('outline', pdf)
  if (outline.length !== info.outlineTitles.length)
    throw new Error(`outline has ${outline.length} entries, page has ${info.outlineTitles.length} headings`)
  return Object.fromEntries(chapters.map((c, k) => [c.id, outline[info.chapterIdx[k]].page]))
}

// A screenshot that does not fit at the foot of a page moves to the next one and leaves a gap. When
// shrinking it by up to a quarter would make it fit, shrink it (one per chapter per round, as every
// change moves what follows).
await page.evaluate(() => {
  document.querySelectorAll('figure.shot').forEach((fig, k) => {
    const m = document.createElement('span')
    m.className = 'figmark'
    m.textContent = `FIGMARK${k}`
    fig.prepend(m)
  })
})
const shrunk = []
const tries = new Map()
const DEBUG_FIT = new Set((process.env.DEBUG_FIT ?? '').split(',').filter(Boolean).map(Number))
async function fitFigures(rounds, onlyBig) {
  for (let round = 0; round < rounds; round++) {
    const geo = await page.evaluate(() => {
      const MM = 25.4 / 96
      return [...document.querySelectorAll('figure.shot')].map((fig, k) => {
        const row = fig.parentElement
        const pair = row.classList.contains('pair')
        const next = row.nextElementSibling
        const legend = !pair && next && next.classList.contains('legend') ? next : null
        const img = fig.querySelector('img')
        const r = row.getBoundingClientRect()
        const bottom = (legend ?? row).getBoundingClientRect().bottom
        return {
          k, pair, chapter: fig.closest('section').id,
          figW: fig.getBoundingClientRect().width * MM,
          imgW: Number.parseFloat(img.style.width), imgW0: Number.parseFloat(img.dataset.w0 || img.style.width), imgH: img.getBoundingClientRect().height * MM,
          block: 3.4 + (bottom - r.top) * MM,
          figBlock: 3.4 + (r.bottom - r.top) * MM,
          hasLegend: Boolean(legend),
          minS: Number(fig.dataset.minScale || 0),
          wFirst: Number.parseFloat(img.dataset.wFirst || img.style.width),
          natW: Number(fig.dataset.natW || 0),
          legendFull: legend ? legend.getBoundingClientRect().height * MM : 0,
          legendH: pair ? row.querySelector('.legend').getBoundingClientRect().height * MM : 0,
        }
      })
    })
    await printTo(pass)
    const widths = path.join(BUILD, `figw-${lang}.json`)
    fs.writeFileSync(widths, JSON.stringify(Object.fromEntries(geo.map((g) => [g.k, g.figW + 2]))))
    const { marks, bottom } = py('marks', pass, widths)
    const pick = new Map()
    const fallback = []
    for (const g of geo) {
      const m = marks[g.k]
      // Every gap in a round (each layout is measured afresh next round); a screenshot gets at most three tries.
      if (!m || m.prev == null || (tries.get(g.k) ?? 0) >= (onlyBig ? 5 : 3)) continue
      // Text above the figure on its page: only a step's first line or two that moved along with it.
      const lead = m.above ? m.top - 21 : 0
      if (DEBUG_FIT.has(g.k)) console.error(JSON.stringify({ pre: g.k, round, onlyBig, m, block: +g.block.toFixed(1), tries: tries.get(g.k) ?? 0 }))
      if (m.above && (m.leadOnly !== true || lead > 22)) continue
      const free = bottom - 1.2 - m.prev
      if (free < 40) continue
      if (g.pair && g.legendH + lead + 3.4 > free) continue
      // At most a quarter smaller than first laid out; wide screenshots up to 30 % while they stay 130 mm wide;
      // and up to 30 % when the gap left behind would be 40 % of the page or more.
      const bigGap = free >= 0.4 * (bottom - 21)
      if (onlyBig && !bigGap) continue
      const fits = (s) => {
        const total = (g.imgW * s) / g.imgW0
        if (s > 0 && g.minS && (g.imgW * s) / g.wFirst >= g.minS && g.imgW * s >= 56) return true
        return s > 0 && !((total < 0.75 && !(total >= 0.7 && (g.imgW * s >= 130 || bigGap))) || g.imgW * s < 56)
      }
      // 2.5 mm of slack: the block estimate leaves out the row margins Chrome keeps at a page foot.
      // Screenshot + legend fit together or move to the next page together (a legend never starts a page alone).
      const over = g.block + lead + (g.pair ? 2 : 0) - free + 2.5
      const loose = false
      if (over <= 0) continue
      const s = 1 - (over + 1) / g.imgH
      if (DEBUG_FIT.has(g.k)) console.error(JSON.stringify({ round, k: g.k, page: m.page, free: +free.toFixed(1), block: +g.block.toFixed(1), figBlock: +g.figBlock.toFixed(1), imgH: +g.imgH.toFixed(1), imgW: g.imgW, w0: g.imgW0, over: +over.toFixed(1), loose, s: +s.toFixed(3), fits: fits(s) }))
      if (!fits(s)) {
        if (g.hasLegend && !g.pair) fallback.push({ g, free, lead, over, fits })
        continue
      }
      pick.set(g.k, { k: g.k, w: g.imgW * s, loose })
      tries.set(g.k, (tries.get(g.k) ?? 0) + 1)
    }
    // Screenshot + legend still too tall for the gap: try a two-column legend (short items), else the
    // screenshot beside its legend while its UI text stays readable (at least 0.1 mm per CSS px; large-type
    // website shots down to their minScale). Measured on hidden clones before anything changes.
    if (fallback.length) {
      const widthsFor = (g) => {
        const min = Math.max(56, g.minS ? g.minS * g.wFirst : g.natW / 15)
        const out = []
        for (let w = Math.min(112, g.imgW); w >= min; w -= 4) out.push(Number(w.toFixed(1)))
        return out
      }
      const meas = await page.evaluate((list) => {
        const MM = 25.4 / 96
        const figs = document.querySelectorAll('figure.shot')
        return list.map(({ k, widths }) => {
          const fig = figs[k]
          const row = fig.parentElement
          const legend = row.nextElementSibling
          const host = document.createElement('div')
          host.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden;'
          row.before(host)
          const rowW = row.getBoundingClientRect().width
          // two columns
          host.style.width = `${legend.getBoundingClientRect().width}px`
          const c2 = legend.cloneNode(true)
          c2.classList.add('cols2')
          host.append(c2)
          const lis = [...c2.querySelectorAll('ol.legend-list > li')]
          const lh = lis.length ? Number.parseFloat(getComputedStyle(lis[0]).lineHeight) : 1
          const ok2 = lis.length >= 3 && lis.every((li) => li.getBoundingClientRect().height <= 2.2 * lh)
          const cols2 = c2.getBoundingClientRect().height * MM
          c2.remove()
          // beside the legend
          const pairs = widths.map((w) => {
            const px = w / MM
            host.style.width = `${px}px`
            const f = fig.cloneNode(true)
            f.style.width = `${px}px`
            f.querySelector('img').style.width = `${px}px`
            host.append(f)
            const fh = f.getBoundingClientRect().height * MM
            f.remove()
            host.style.width = `${rowW - px - 6 / MM}px`
            const l = legend.cloneNode(true)
            l.style.margin = '0'
            host.append(l)
            const lgh = l.getBoundingClientRect().height * MM
            l.remove()
            return { w, h: Math.max(fh, lgh) }
          })
          host.remove()
          return { k, ok2, cols2, pairs }
        })
      }, fallback.map(({ g }) => ({ k: g.k, widths: widthsFor(g) })))
      for (const [i, { g, free, lead, over, fits }] of fallback.entries()) {
        const m = meas[i]
        if (m.ok2 && m.cols2 < g.legendFull - 4) {
          const over2 = over - (g.legendFull - m.cols2)
          const s2 = over2 <= 0 ? 1 : 1 - (over2 + 1) / g.imgH
          if (fits(s2)) {
            pick.set(g.k, { k: g.k, w: g.imgW * s2, cols2: true })
            tries.set(g.k, (tries.get(g.k) ?? 0) + 1)
            continue
          }
        }
        const p = m.pairs.find((c) => 3.4 + c.h + 2 + 2.5 + lead <= free)
        if (p) {
          pick.set(g.k, { k: g.k, w: p.w, pair: true })
          tries.set(g.k, (tries.get(g.k) ?? 0) + 1)
        }
        if (DEBUG_FIT.has(g.k)) console.error(JSON.stringify({ fallback: g.k, free: +free.toFixed(1), legendFull: +g.legendFull.toFixed(1), ...m, chose: pick.get(g.k) ?? null }))
      }
    }
    if (!pick.size) break
    shrunk.push(...[...pick.values()].map((p) => p.k))
    await page.evaluate((list) => {
      const figs = document.querySelectorAll('figure.shot')
      for (const { k, w, loose, cols2, pair } of list) {
        const fig = figs[k]
        const img = fig.querySelector('img')
        if (loose) fig.parentElement.nextElementSibling?.classList.add('loose')
        if (cols2) fig.parentElement.nextElementSibling?.classList.add('cols2')
        if (pair) {
          const row = fig.parentElement
          const legend = row.nextElementSibling
          row.className = 'pair'
          row.append(legend)
          fig.style.width = `${w.toFixed(1)}mm`
        }
        if (!img.dataset.w0) img.dataset.w0 = img.style.width
        img.style.width = `${w.toFixed(1)}mm`
        if (fig.style.width) fig.style.width = `${w.toFixed(1)}mm`
      }
    }, [...pick.values()])
  }
}
await fitFigures(24, false)
// Gaps of 40 % of a page or more that shrinking could not close (tall screenshots): let the notes and
// paragraphs that follow the screenshot, up to the next heading, move up into the gap ahead of it.
const floated = []
for (let round = 0; round < 4; round++) {
  await printTo(pass)
  const widths = path.join(BUILD, `figw-${lang}.json`)
  const figw = await page.evaluate(() =>
    Object.fromEntries([...document.querySelectorAll('figure.shot')].map((f, k) => [k, (f.getBoundingClientRect().width * 25.4) / 96 + 2])),
  )
  fs.writeFileSync(widths, JSON.stringify(figw))
  const { marks, bottom } = py('marks', pass, widths)
  const jobs = []
  for (const [k, m] of Object.entries(marks)) {
    if (m.prev == null || (m.above && !m.leadOnly)) continue
    const lead = m.above ? m.top - 21 : 0
    const free = bottom - 1.2 - m.prev - lead
    if (free >= 0.4 * (bottom - 21)) jobs.push({ k: Number(k), free })
  }
  if (!jobs.length) break
  const moved = await page.evaluate((jobs) => {
    const MM = 25.4 / 96
    const figs = document.querySelectorAll('figure.shot')
    const done = []
    for (const { k, free } of jobs) {
      const fig = figs[k]
      if (!fig || fig.dataset.floated) continue
      const row = fig.parentElement
      const legend = row.nextElementSibling?.classList.contains('legend') ? row.nextElementSibling : null
      const last = legend ?? row
      // The screenshot must close its block: the end of its step list, or a top-level block.
      let anchor = row
      if (row.parentElement.tagName === 'LI') {
        const li = row.parentElement
        if (last.nextElementSibling || li.nextElementSibling || li.parentElement.parentElement.tagName !== 'SECTION') continue
        anchor = li.parentElement
      } else if (row.parentElement.tagName !== 'SECTION') continue
      const anchorEnd = anchor === row ? last : anchor
      const take = []
      let h = 0
      for (let n = anchorEnd.nextElementSibling; n; n = n.nextElementSibling) {
        if (!/^(P|BLOCKQUOTE|UL)$/.test(n.tagName) || n.classList.contains('lead-in') || n.querySelector('figure')) break
        const nh = n.getBoundingClientRect().height * MM + 4
        if (h + nh > free - 6) break
        take.push(n)
        h += nh
      }
      if (!take.length) continue
      const after = take[take.length - 1]
      const moving = legend ? [row, legend] : [row]
      after.after(...moving)
      row.style.marginInlineStart = ''
      row.style.width = ''
      fig.dataset.floated = '1'
      done.push(k)
    }
    return done
  }, jobs)
  if (!moved.length) break
  floated.push(...moved)
}
await printTo(pass)
let map = pageMap(pass)

// A chapter whose last page holds only a few lines gets slightly tighter spacing and screenshots
// (up to two rounds).
const tight = []
// Escalates per chapter: tighter spacing, then 10 % smaller screenshots, then tighter again; then the
// largest screenshot on the page before the spill gives up the space the spill needs.
const level = {}
for (let round = 0; round < 7; round++) {
  const { pages: total } = py('outline', pass)
  const ends = chapters.map((c, k) => ({ id: c.id, first: map[c.id], last: (k + 1 < chapters.length ? map[chapters[k + 1].id] : total + 1) - 1 }))
  const multi = ends.filter((e) => e.last > e.first)
  const counts = py('lines', pass, multi.map((e) => e.last).join(','))
  const sparse = multi.filter((e) => counts[String(e.last)] <= 8 && (level[e.id] ?? 0) < 6).map((e) => e.id)
  const lastOf = Object.fromEntries(multi.map((e) => [e.id, { last: e.last, lines: counts[String(e.last)] }]))
  if (!sparse.length) break
  tight.push(...sparse.filter((id) => !tight.includes(id)))
  for (const id of sparse) level[id] = (level[id] ?? 0) + 1
  await page.evaluate((jobs) => {
    for (const [id, lv] of jobs) {
      const sec = document.getElementById(id)
      if (lv === 1) sec.classList.add('tight')
      if (lv === 3) sec.classList.add('tighter')
      if (lv !== 2 && lv !== 4) continue
      for (const img of sec.querySelectorAll('figure.shot img')) {
        const w = Number.parseFloat(img.style.width) * 0.9
        img.style.width = `${w.toFixed(1)}mm`
        const fig = img.closest('figure')
        if (fig.style.width) fig.style.width = `${w.toFixed(1)}mm`
      }
    }
  }, sparse.map((id) => [id, level[id]]))
  const late = sparse.filter((id) => level[id] >= 5)
  if (late.length) {
    const geo = await page.evaluate(() =>
      [...document.querySelectorAll('figure.shot')].map((fig, k) => {
        const img = fig.querySelector('img')
        return { k, chapter: fig.closest('section').id, w: Number.parseFloat(img.style.width),
          w0: Number.parseFloat(img.dataset.w0 || img.style.width), h: (img.getBoundingClientRect().height * 25.4) / 96 }
      }),
    )
    const widths = path.join(BUILD, `figw-${lang}.json`)
    fs.writeFileSync(widths, JSON.stringify(Object.fromEntries(geo.map((g) => [g.k, 180]))))
    const { marks } = py('marks', pass, widths)
    const jobs = []
    for (const id of late) {
      const { last, lines } = lastOf[id]
      const need = 14 + lines * 6.5
      const cands = geo.filter((g) => g.chapter === id && marks[g.k]?.page === last - 1).sort((a, b) => b.h - a.h)
      for (const g of cands) {
        const w = g.w * (1 - need / g.h)
        if (w / g.w0 >= 0.62 && w >= 56) { jobs.push({ k: g.k, w }); if (!g.w0) g.w0 = g.w; break }
      }
    }
    await page.evaluate((jobs) => {
      const figs = document.querySelectorAll('figure.shot')
      for (const { k, w } of jobs) {
        const img = figs[k].querySelector('img')
        if (!img.dataset.w0) img.dataset.w0 = img.style.width
        img.style.width = `${w.toFixed(1)}mm`
        if (figs[k].style.width) figs[k].style.width = `${w.toFixed(1)}mm`
      }
    }, jobs)
  }
  await printTo(pass)
  map = pageMap(pass)
}
// The spacing changes above can open new gaps (and leave a heading and its intro above a gap): close those once more.
await fitFigures(8, false)
await printTo(pass)
map = pageMap(pass)
await page.evaluate(() => {
  for (const m of document.querySelectorAll('.figmark')) m.remove()
})
// The layout as printed (after the fitting passes), for checks.
fs.writeFileSync(path.join(BUILD, `spa-${lang}.fitted.html`), await page.content())
for (let round = 0; round < 3; round++) {
  await page.evaluate((m) => {
    for (const el of document.querySelectorAll('.toc-pg')) el.textContent = String(m[el.dataset.for])
  }, map)
  await printTo(pdfPath)
  const again = pageMap(pdfPath)
  if (JSON.stringify(again) === JSON.stringify(map)) break
  map = again
}
await browser.close()
const titlesJson = path.join(BUILD, `titles-${lang}.json`)
fs.writeFileSync(titlesJson, JSON.stringify(info.outlineTitles))
const fixedOutline = py('fixoutline', pdfPath, titlesJson)

const check = py('check', pdfPath, path.join(BUILD, `headings-${lang}.json`))
console.log(JSON.stringify({ overflow, tight: level, shrunk: shrunk.length, floated: floated.length, pdf: pdfPath, pages: check.pages, outlineFixed: fixedOutline.fixed, figures: info.figures, orphans: check.orphans, toc: map }, null, 1))
