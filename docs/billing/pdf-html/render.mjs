import { chromium } from 'playwright'
const [,, html, pdf, png] = process.argv
const b = await chromium.launch()
const p = await b.newPage()
await p.goto('file://' + html, { waitUntil: 'networkidle' })
await p.pdf({ path: pdf, format: 'A4', printBackground: true, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: '<div style="width:100%;font-size:8px;color:#59645d;font-family:Arial;padding:0 14mm;display:flex;justify-content:space-between"><span>Spa Management · ask@spamanagement.co · Powered by 1997 Labs · 1997labs.com</span><span>Page <span class=pageNumber></span> of <span class=totalPages></span></span></div>', margin: { top: '14mm', bottom: '16mm', left: '14mm', right: '14mm' } })
await p.setViewportSize({ width: 820, height: 1160 }); await p.screenshot({ path: png, fullPage: false })
await b.close()
