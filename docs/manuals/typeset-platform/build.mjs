// Typesets the Platform Owner's Manual (Markdown chapters) into an A4 PDF.
// usage: node build.mjs en|ar        -> ../out/Platform-Owner-s-Manual-{EN,AR}.pdf
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import MarkdownIt from 'markdown-it'
import { chromium } from 'playwright-core'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MAN = path.resolve(HERE, '..')
const lang = process.argv[2] ?? 'en'
const SRC = path.join(MAN, 'src/platform', lang)
const OUT = path.join(MAN, 'out')
const BUILD = path.join(HERE, 'build')
fs.mkdirSync(OUT, { recursive: true })
fs.mkdirSync(BUILD, { recursive: true })

const T = {
  en: {
    dir: 'ltr',
    title: "Platform Owner's Manual",
    kicker: "Owner's manual",
    subtitle:
      'How to run spamanagement.co from the owner’s side: the platform console, spa websites, billing and the day-to-day running of the server.',
    audience: 'For the platform owner and every super-admin',
    edition: 'English edition',
    date: 'October 2026',
    contents: 'Contents',
    chapter: 'Chapter',
    figure: 'Fig.',
    purpose: ['What this is for'],
    tip: ['Tip:'],
    important: ['Important:'],
    legend: ['In the screenshot:'],
    file: 'Platform-Owner-s-Manual-EN',
  },
  ar: {
    dir: 'rtl',
    title: 'دليل مالك المنصة',
    altTitle: "Platform Owner's Manual",
    kicker: 'دليل المالك',
    subtitle:
      'كيفية تشغيل منصة spamanagement.co من جانب المالك: لوحة إدارة المنصة، وبناء مواقع مراكز السبا، والفوترة، والتشغيل اليومي للخادم.',
    audience: 'لمالك المنصة ولكل مشرف عام',
    edition: 'النسخة العربية',
    date: 'أكتوبر 2026',
    contents: 'المحتويات',
    chapter: 'الفصل',
    figure: 'شكل',
    purpose: ['الغرض من هذا الفصل', 'الغرض من هذا الدليل', 'What this is for'],
    tip: ['نصيحة:', 'Tip:'],
    important: ['مهم:', 'Important:'],
    legend: ['في لقطة الشاشة:', 'In the screenshot:'],
    file: 'Platform-Owner-s-Manual-AR',
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

// In right-to-left text, a Latin word that starts or ends with a neutral character ("ask@") gets the
// character flipped to the wrong side. Wrap such words in LRI ... PDI so they stay as written.
const isolateLatin = (s) =>
  s.replace(/[^\s\u0600-\u06FF()]*[A-Za-z][^\s\u0600-\u06FF()]*/g, (w) =>
    /^[^A-Za-z0-9]|[^A-Za-z0-9.,:;]$/.test(w) ? `\u2066${w}\u2069` : w,
  )
const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.md')).sort()
const chapters = files.map((f) => {
  const text = fs.readFileSync(path.join(SRC, f), 'utf8')
  const h1 = text.match(/^# (.+)$/m)[1].trim()
  const m = h1.match(/^(\d+)\.\s+(.*)$/)
  const id = `c-${f.replace(/\.md$/, '')}`
  const title = m ? m[2] : h1
  return { id, file: f, num: m ? m[1] : null, title: lang === 'ar' ? isolateLatin(title) : title, html: md.render(text, { dir: SRC }) }
})

// ---------- Running header / footer (CSS margin boxes; mirrored for RTL) ----------
const rtl = T.dir === 'rtl'
const start = rtl ? 'right' : 'left'
const end = rtl ? 'left' : 'right'
const hFont = `font: 600 7.4pt/1.2 'Space Grotesk', 'Plex Arabic', 'DM Sans', sans-serif; color: #0F6B4B; vertical-align: bottom; padding-bottom: 6.5mm;`
const hFontEnd = `font: 500 7.4pt/1.2 'Plex Arabic', 'DM Sans', sans-serif; color: #6B7A72; vertical-align: bottom; padding-bottom: 6.5mm;`
const fFont = `font: 500 7.4pt/1.2 'DM Sans', sans-serif; color: #6B7A72; vertical-align: top; padding-top: 6mm;`
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
    <p class="subtitle">${esc(T.subtitle)}</p>
    <div class="audience">${esc(T.audience)}</div>
  </div>
  <div class="panel">
    <div class="ed">${esc(T.edition)}</div>
    <div class="date">${esc(T.date)}</div>
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
const htmlPath = path.join(BUILD, `platform-${lang}.html`)
fs.writeFileSync(htmlPath, html)

// ---------- DOM pass (runs in the page) ----------
function enhance(T) {
  const rtl = T.dir === 'rtl'
  const AR = /[؀-ۿ]/
  const LAT = /[A-Za-z]/
  const text = (el) => el.textContent.replace(/\s+/g, ' ').trim()
  const STEP = 8.5
  const BULLET = 6
  let figNo = 0

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
    const tail = rtl ? /\s(\([^()]{1,24}\))$/.exec(sec.dataset.title) : null
    if (tail) {
      const keep = document.createElement('span')
      keep.className = 'nobr'
      keep.textContent = tail[1]
      nh.append(sec.dataset.title.slice(0, tail.index + 1), keep)
    } else nh.textContent = sec.dataset.title
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
    if (img.naturalWidth < 700 && ratio > 1.6) fig.classList.add('phone')
    else if (ratio > 1.15) fig.classList.add('tall')
    else if (ratio > 0.75) fig.classList.add('square')
    fig.append(img)
    if (img.alt) {
      const cap = document.createElement('figcaption')
      const no = document.createElement('span')
      no.className = 'fig-no'
      no.textContent = `${T.figure} ${++figNo}`
      // The number is isolated (an English alt text would otherwise pull it into its left-to-right run).
      cap.append(no, document.createTextNode(` ${img.alt}`))
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
    if (!(p.children.length === 1 && p.firstElementChild.tagName === 'EM' && T.legend.includes(text(p)))) continue
    const box = document.createElement('div')
    box.className = 'legend'
    const list = p.nextElementSibling
    p.before(box)
    p.className = 'legend-title'
    p.textContent = text(p).replace(/:$/, '')
    box.append(p)
    if (list && list.tagName === 'OL') {
      list.classList.add('legend-list')
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
    const maxH = phone ? 118 : ratio > 1.15 ? 168 : ratio > 0.75 ? 150 : 125
    let w = Math.min(COL, img.naturalWidth * 0.16, maxH / ratio)
    if (phone) w = Math.min(w, 58)
    img.style.width = `${w.toFixed(1)}mm`
    fig.classList.toggle('phone', phone)
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

  // Tables: a short one moves to the next page whole; a long one keeps its header with the first three rows.
  for (const t of document.querySelectorAll('section.chapter table')) {
    const rows = t.querySelectorAll('tbody tr')
    if (rows.length <= 6 || t.offsetHeight <= 300) t.classList.add('whole')
    else for (const r of [...rows].slice(0, 2)) r.classList.add('keep-next')
  }
  // A plain paragraph ending in ":" stays with the list or table it introduces.
  for (const p of document.querySelectorAll('section.chapter p')) {
    const next = p.nextElementSibling
    if (next && /^(TABLE|UL|OL)$/.test(next.tagName) && /:\s*$/.test(text(p))) p.classList.add('keep-next')
  }
  // A list item whose text ends in ":" stays with the first item of its nested list.
  for (const sub of document.querySelectorAll('section.chapter li > :is(ul, ol)')) {
    let lead = ''
    for (let n = sub.previousSibling; n; n = n.previousSibling) lead = n.textContent + lead
    if (/:\s*$/.test(lead)) {
      sub.classList.add('after-colon')
      sub.previousElementSibling?.classList.add('keep-next')
    }
  }

  // Keep each h2/h3 with the block that follows it.
  for (const h of [...document.querySelectorAll('section.chapter :is(h2, h3, h4, p.lead-in)')]) {
    if (h.closest('.purpose')) continue
    const next = h.nextElementSibling
    if (!next || !/^(P|TABLE|UL|OL|BLOCKQUOTE)$/.test(next.tagName) || next.offsetHeight > 420) continue
    const keep = document.createElement('div')
    keep.className = 'keep'
    h.before(keep)
    keep.append(h, next)
  }

  if (rtl) {
    // English UI labels, code, links and quoted English messages stay left-to-right.
    for (const el of document.querySelectorAll('section.chapter :is(strong, em, code, a)')) {
      const t = el.textContent
      if (LAT.test(t) && !AR.test(t)) {
        el.setAttribute('dir', 'ltr')
        if (el.closest('td, th') ? t.length <= 20 : t.length <= 32) el.classList.add('nobr')
      }
    }
    // Menu paths ("Company → Super-admins") read left to right, as on the English screen.
    for (const s of [...document.querySelectorAll('section.chapter strong[dir="ltr"]')]) {
      if (!s.isConnected || s.parentElement.classList.contains('path')) continue
      const chain = [s]
      let n = s.nextSibling
      while (n && n.nodeType === 3 && /^\s*→\s*$/.test(n.textContent) && n.nextSibling?.matches?.('strong[dir="ltr"]')) {
        chain.push(n, n.nextSibling)
        n = n.nextSibling.nextSibling
      }
      if (chain.length < 3) continue
      const span = document.createElement('span')
      span.className = 'path'
      span.setAttribute('dir', 'ltr')
      if (chain.map((x) => x.textContent).join('').length <= 44) span.classList.add('nobr')
      s.before(span)
      span.append(...chain)
    }
    const walker = document.createTreeWalker(document.querySelector('body'), NodeFilter.SHOW_TEXT)
    const targets = []
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.parentElement.closest('[dir="ltr"], .cover, code')) continue
      if (/[A-Za-z]/.test(n.textContent)) targets.push(n)
    }
    // Plain-text Latin (no bold/code around it): a word made of letters and symbols ("/join", "https://", ".html",
    // "SM-2026-0001", "saffron-spa.spamanagement.co") or a short phrase ("Switch plan") is isolated left to right and
    // kept on one line, as are amounts ("AED 3,000"). Plain English words stay as they are.
    const W = '[^\\s\\u0600-\\u06FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF\\u2066-\\u2069()"«»]'
    const TOKEN = `${W}*[A-Za-z]${W}*`
    const RX = new RegExp(
      [
        String.raw`\([^()"؀-ۿ]*[A-Za-z][^()"؀-ۿ]*\)`,
        String.raw`"[^"؀-ۿ]*[A-Za-z0-9][^"؀-ۿ]*"`,
        String.raw`[A-Za-z][A-Za-z0-9._-]*@(?![A-Za-z0-9])`,
        String.raw`[^\s؀-ۿ()]*[{[][^\s؀-ۿ()]*?[}\]][^\s؀-ۿ()]*?(?=[.,،:;]?(?:\s|$|\)))`,
        String.raw`(?<amt>\b(?:AED|USD) [0-9][0-9.,]*[0-9])`,
        `(?<run>${TOKEN}(?: ${TOKEN})*)`,
      ].join('|'),
      'g',
    )
    const inTable = (n) => !!n.parentElement.closest('td, th')
    for (const n of targets) {
      const s = n.textContent
      const frag = document.createDocumentFragment()
      let last = 0
      let changed = false
      for (const m of s.matchAll(RX)) {
        let t = m[0]
        let nobr = t.length <= 32
        if (m.groups.run !== undefined) {
          t = t.replace(/[.,:;!?]+$/, '')
          const words = t.split(' ')
          const symbols = words.some((w) => /[^A-Za-z0-9]/.test(w))
          if (!t || (!symbols && words.length < 2)) continue
          nobr = words.length > 1 ? t.length <= 32 : t.length <= 48
          if (inTable(n) && t.length > 20) nobr = false
        } else if (m.groups.amt !== undefined) nobr = true
        if (m.index > last) frag.append(s.slice(last, m.index))
        const span = document.createElement('span')
        span.setAttribute('dir', 'ltr')
        if (nobr) span.className = 'nobr'
        span.textContent = t
        frag.append(span)
        last = m.index + t.length
        changed = true
      }
      if (!changed) continue
      frag.append(s.slice(last))
      n.replaceWith(frag)
    }
  }

  if (rtl) {
    // An arrow that sits in right-to-left text points the reading way: → becomes ←. Arrows inside
    // left-to-right runs (quoted English messages, "Settings → Domains" between two English words,
    // badges such as "→ Premium") stay as on the screen.
    const AR1 = /[؀-ۿ]/
    const LAT1 = /[A-Za-z]/
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    const nodes = []
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.textContent.includes('→')) nodes.push(n)
    for (const n of nodes) {
      if (n.parentElement.closest('[dir="ltr"], .cover')) continue
      const t = n.textContent
      const badge = /(?<=[؀-ۿ]\s)→\s[A-Za-z][\w-]*(?=\))/.exec(t)
      if (badge) {
        const span = document.createElement('span')
        span.setAttribute('dir', 'ltr')
        span.textContent = badge[0]
        const after = n.splitText(badge.index)
        after.textContent = after.textContent.slice(badge[0].length)
        n.after(span)
        continue
      }
      let out = ''
      for (let i = 0; i < t.length; i++) {
        if (t[i] !== '→') { out += t[i]; continue }
        let b = i - 1
        while (b >= 0 && !AR1.test(t[b]) && !LAT1.test(t[b])) b--
        let f = i + 1
        while (f < t.length && !AR1.test(t[f]) && !LAT1.test(t[f])) f++
        const latinBoth = b >= 0 && f < t.length && LAT1.test(t[b]) && LAT1.test(t[f])
        out += latinBoth ? '→' : '←'
      }
      n.textContent = out
    }
  }
  const all = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]')]
  return {
    outlineTitles: all.map((h) => text(h).replace(/[\u2066-\u2069]/g, '')),
    chapterIdx: [...document.querySelectorAll('section.chapter .ch-head h1')].map((h) => all.indexOf(h)),
    headings: [...document.querySelectorAll('section.chapter :is(h2, h3, h4, p.lead-in)')].map((h) => text(h).replace(/[\u2066-\u2069]/g, '')),
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
fs.writeFileSync(path.join(BUILD, `platform-${lang}.final.html`), await page.content())

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

await printTo(pass)
let map = pageMap(pass)

// A page in the middle of a chapter that is left mostly empty because the next screenshot (with its caption and
// legend) did not fit: shrink that screenshot by up to 15 % when that brings it back onto the page. Kept only
// when the screenshot really moves up; otherwise its size is restored.
const fitted = []
for (let round = 0; round < 3; round++) {
  const pages = py('layout', pass)
  const chapterOf = (pg) => chapters.reduce((id, c) => (map[c.id] <= pg ? c.id : id), null)
  const tries = []
  for (let p = 1; p < pages.length; p++) {
    const here = pages[p - 1]
    const next = pages[p]
    if (next.firstImg === null || chapterOf(p) !== chapterOf(p + 1) || map[chapterOf(p)] === p + 1) continue
    if (here.bottom > 21 + 0.7 * 258) continue
    if (fitted.some((f) => f.k === next.firstImg)) continue
    tries.push({ k: next.firstImg, page: p, free: 279 - here.bottom - 6, half: here.bottom < 21 + 0.5 * 258 })
  }
  if (!tries.length) break
  const applied = await page.evaluate((tries) => {
    const PX = 25.4 / 96
    const imgs = [...document.querySelectorAll('figure.shot img')]
    const out = []
    for (const t of tries) {
      const img = imgs[t.k]
      const fig = img.closest('figure')
      const row = fig.parentElement
      const legend = row.classList.contains('fig-row') && row.nextElementSibling?.classList.contains('legend') ? row.nextElementSibling : null
      const height = (withLegend = true) => {
        const a = row.getBoundingClientRect().top
        const b = ((withLegend && legend) || row).getBoundingClientRect().bottom
        return (b - a) * PX + 8
      }
      const w0 = Number.parseFloat(img.style.width)
      const set = (w) => {
        img.style.width = `${w.toFixed(1)}mm`
        if (fig.style.width) fig.style.width = `${w.toFixed(1)}mm`
      }
      if (height() * 0.99 <= t.free) continue
      let f = 1
      for (; f >= 0.85; f -= 0.01) {
        set(w0 * f)
        if (height() <= t.free) break
      }
      if (f >= 0.85) {
        out.push({ k: t.k, page: t.page, w0, f: Math.round(f * 100) / 100 })
        continue
      }
      // Still too tall and the page would stay less than half full: let the legend (under the screenshot) start
      // the next page, so the screenshot itself stays here.
      if (legend && t.half) {
        for (f = 1; f >= 0.85; f -= 0.01) {
          set(w0 * f)
          if (height(false) <= t.free) break
        }
        if (f >= 0.85) {
          legend.style.breakBefore = 'auto'
          out.push({ k: t.k, page: t.page, w0, f: Math.round(f * 100) / 100, legendSplit: true })
          continue
        }
      }
      set(w0)
    }
    return out
  }, tries)
  if (!applied.length) break
  await printTo(pass)
  map = pageMap(pass)
  const after = py('layout', pass)
  const pageOfImg = (k) => {
    let found = 0
    after.forEach((pg, i) => {
      if (pg.firstImg !== null && pg.firstImg <= k) found = i + 1
    })
    return found
  }
  const undo = applied.filter((a) => pageOfImg(a.k) > a.page)
  fitted.push(...applied.filter((a) => !undo.includes(a)))
  if (undo.length) {
    await page.evaluate((undo) => {
      const imgs = [...document.querySelectorAll('figure.shot img')]
      for (const u of undo) {
        imgs[u.k].style.width = `${u.w0.toFixed(1)}mm`
        const fig = imgs[u.k].closest('figure')
        if (fig.style.width) fig.style.width = `${u.w0.toFixed(1)}mm`
        const legend = fig.parentElement.nextElementSibling
        if (u.legendSplit && legend) legend.style.breakBefore = ''
      }
    }, undo)
    fitted.push(...undo.map((u) => ({ k: u.k, undone: true })))
    await printTo(pass)
    map = pageMap(pass)
  }
}

// A chapter whose last page holds only a few lines gets slightly tighter spacing and screenshots
// (up to two rounds), then a third round with tighter spacing for any chapter that still ends on a sparse page.
const tight = []
const tighter = []
for (let round = 0; round < 3; round++) {
  const { pages: total } = py('outline', pass)
  const ends = chapters.map((c, k) => ({ id: c.id, first: map[c.id], last: (k + 1 < chapters.length ? map[chapters[k + 1].id] : total + 1) - 1 }))
  const multi = ends.filter((e) => e.last > e.first)
  const counts = py('lines', pass, multi.map((e) => e.last).join(','))
  const sparse = multi.filter((e) => counts[String(e.last)] <= 8).map((e) => e.id)
  if (!sparse.length) break
  const last = round === 2
  ;(last ? tighter : tight).push(...sparse.filter((id) => !(last ? tighter : tight).includes(id)))
  await page.evaluate(({ ids, last }) => {
    for (const id of ids) {
      const sec = document.getElementById(id)
      sec.classList.add(last ? 'tighter' : 'tight')
      for (const img of sec.querySelectorAll('figure.shot img')) {
        const w = Number.parseFloat(img.style.width) * (last ? 0.92 : 0.88)
        img.style.width = `${w.toFixed(1)}mm`
        const fig = img.closest('figure')
        if (fig.style.width) fig.style.width = `${w.toFixed(1)}mm`
      }
    }
  }, { ids: sparse, last })
  await printTo(pass)
  map = pageMap(pass)
}
// Last resort for a chapter that still ends with a handful of lines (for example only a closing tip): slightly
// smaller line spacing for that chapter only. Kept only when the chapter really gets shorter.
const tightest = []
const loneDropped = []
{
  const { pages: total } = py('outline', pass)
  const ends = chapters.map((c, k) => ({ id: c.id, first: map[c.id], last: (k + 1 < chapters.length ? map[chapters[k + 1].id] : total + 1) - 1 }))
  const multi = ends.filter((e) => e.last > e.first)
  const counts = py('lines', pass, multi.map((e) => e.last).join(','))
  const few = multi.filter((e) => counts[String(e.last)] <= 4)
  if (few.length) {
    await page.evaluate((ids) => { for (const id of ids) document.getElementById(id).classList.add('tightest') }, few.map((e) => e.id))
    await printTo(pass)
    const before = map
    map = pageMap(pass)
    const total2 = py('outline', pass).pages
    const span = (m, k, t) => (k + 1 < chapters.length ? m[chapters[k + 1].id] : t + 1) - m[chapters[k].id]
    const keep = few.filter((e) => { const k = chapters.findIndex((c) => c.id === e.id); return span(map, k, total2) < span(before, k, total) })
    const drop = few.filter((e) => !keep.includes(e))
    tightest.push(...keep.map((e) => e.id))
    if (drop.length) {
      await page.evaluate((ids) => { for (const id of ids) document.getElementById(id).classList.remove('tightest') }, drop.map((e) => e.id))
      await printTo(pass)
      map = pageMap(pass)
    }
  }
}
// Lone lines at a page break. A 4- or 5-line paragraph cannot keep three lines on each side of a break, and
// Chromium then leaves one line alone at the top or bottom of a page: allow two on each side instead. The last
// item of a list, when it is one line, stays with the item before it. Kept per chapter only when the chapter does
// not get longer (each chapter starts on a new page, so chapters do not affect each other).
{
  const { pages: total } = py('outline', pass)
  const before = map
  await page.evaluate(() => {
    const lineCount = (el) => {
      const lh = Number.parseFloat(getComputedStyle(el).lineHeight)
      return lh ? Math.round(el.getBoundingClientRect().height / lh) : 0
    }
    const skip = (el) => el.closest('.legend, blockquote, .purpose, td, th')
    for (const p of document.querySelectorAll('section.chapter :is(p:not(.legend-title), li:not(:has(> p, > ul, > ol, > div)))')) {
      if (skip(p)) continue
      const n = lineCount(p)
      if (n === 4 || n === 5) {
        p.style.orphans = p.style.widows = '2'
        p.dataset.lone = '1'
      }
    }
    for (const list of document.querySelectorAll('section.chapter :is(ul, ol.steps)')) {
      if (skip(list)) continue
      const items = list.querySelectorAll(':scope > li')
      const last = items[items.length - 1]
      if (items.length < 2 || last.querySelector('figure, .fig-row, .pair, ul, ol') || lineCount(last) !== 1) continue
      last.style.breakBefore = 'avoid'
      last.dataset.lone = '1'
    }
  })
  await printTo(pass)
  map = pageMap(pass)
  const total2 = py('outline', pass).pages
  const span = (m, k, t) => (k + 1 < chapters.length ? m[chapters[k + 1].id] : t + 1) - m[chapters[k].id]
  const drop = chapters.filter((c, k) => span(map, k, total2) > span(before, k, total)).map((c) => c.id)
  if (drop.length) {
    await page.evaluate((ids) => {
      for (const id of ids)
        for (const el of document.querySelectorAll(`#${id} [data-lone]`)) {
          el.style.orphans = el.style.widows = el.style.breakBefore = ''
          delete el.dataset.lone
        }
    }, drop)
    await printTo(pass)
    map = pageMap(pass)
  }
  loneDropped.push(...drop)
}
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
console.log(JSON.stringify({ overflow, fitted, tight, tighter, tightest, loneDropped, pdf: pdfPath, pages: check.pages, outlineFixed: fixedOutline.fixed, figures: info.figures, orphans: check.orphans, toc: map }, null, 1))
