// R24 fidelity fixture: a demanding one-page HTML design for e2e/html-fidelity.spec.ts. Rebuild with
// `node apps/web/e2e/fixtures/make-fidelity.mjs` (deterministic: seeded images, an OFL @fontsource woff2).
// Everything a design may rely on: data-URI images (src, srcset, CSS + style-attribute backgrounds) and a data-URI
// web font, <img width height> without CSS height, an <svg> with an explicit size, a wide fixed-px element
// (horizontal overflow), a sticky header, a position:fixed button, a 100vh hero, a scroll-driven animation, an
// IntersectionObserver reveal, a requestAnimationFrame canvas animation that stops (window.__fxDone), localStorage +
// document.cookie, an in-page anchor.
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(path.join(here, '../../package.json'))
const sharp = require('sharp')

let seed = 24
const rand = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed / 0x7fffffff
}

/** Seeded blocky noise over a two-colour gradient (compresses a little, never to nothing). */
async function image(w, h, block, [a, b], format) {
  const px = Buffer.alloc(w * h * 3)
  const cells = new Map()
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const key = `${Math.floor(x / block)},${Math.floor(y / block)}`
      if (!cells.has(key)) cells.set(key, rand() * 60 - 30)
      const t = (x + y) / (w + h)
      const n = cells.get(key)
      for (let c = 0; c < 3; c++)
        px[(y * w + x) * 3 + c] = Math.max(0, Math.min(255, Math.round(a[c] * (1 - t) + b[c] * t + n)))
    }
  const img = sharp(px, { raw: { width: w, height: h, channels: 3 } })
  const buf = format === 'webp' ? await img.webp({ quality: 80 }).toBuffer() : await img.png().toBuffer()
  return `data:image/${format};base64,${buf.toString('base64')}`
}

const font = readFileSync(require.resolve('@fontsource/marcellus/files/marcellus-latin-400-normal.woff2'))
const fontUri = `data:font/woff2;base64,${font.toString('base64')}`
const square = await image(
  300,
  300,
  12,
  [
    [201, 153, 102],
    [51, 102, 153],
  ],
  'png',
)
const square2x = await image(
  600,
  600,
  24,
  [
    [201, 153, 102],
    [51, 102, 153],
  ],
  'png',
)
const hero = await image(
  800,
  500,
  20,
  [
    [29, 59, 52],
    [217, 242, 106],
  ],
  'webp',
)
const tile = await image(
  160,
  80,
  8,
  [
    [233, 216, 180],
    [15, 107, 75],
  ],
  'png',
)

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fidelity fixture</title>
<style>
@font-face { font-family: Fx; src: url(${fontUri}) format("woff2"); font-display: block; }
html { scroll-behavior: auto; }
body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #222; background: #fafaf7; }
h1, h2 { font-family: Fx, serif; font-weight: 400; margin: 0; }
h1 { font-size: 56px; color: #fff; text-shadow: 0 2px 8px rgba(0,0,0,.4); }
h2 { font-size: 36px; }
header { position: sticky; top: 0; z-index: 5; height: 56px; background: #1d3b34; color: #fff; display: flex; align-items: center; gap: 24px; padding: 0 16px; }
header a { color: #d9f26a; font-size: 18px; }
.progress { position: fixed; top: 0; left: 0; z-index: 10; height: 6px; width: 100%; background: #d9f26a; transform-origin: 0 50%; animation: grow linear both; animation-timeline: scroll(); }
@keyframes grow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
.hero { height: 100vh; display: grid; place-items: center; background: url("${hero}") center / cover no-repeat; }
section { padding: 24px 16px; }
.strip { width: 1800px; height: 80px; background-repeat: repeat-x; }
.tall { min-height: 700px; }
.reveal { opacity: 0; }
.reveal.in { opacity: 1; }
#contact { scroll-margin-top: 56px; background: #e9d8b4; }
.fixed-btn { position: fixed; right: 16px; bottom: 16px; z-index: 6; width: 120px; height: 44px; border: 0; border-radius: 22px; background: #0f6b4b; color: #fff; font: 16px Fx, serif; }
</style>
</head>
<body>
<div class="progress" id="progress"></div>
<header id="header"><strong>Fidelity</strong><a id="to-contact" href="#contact">Contact</a></header>
<div class="hero"><h1 id="title">Exactly as built</h1></div>
<section><img id="square" src="${square}" srcset="${square} 1x, ${square2x} 2x" width="600" height="200" alt="Square"></section>
<section><svg id="svg" width="1600" height="200" viewBox="0 0 1600 200"><title>Circle on sand</title><rect width="1600" height="200" fill="#e9d8b4"/><circle cx="800" cy="100" r="90" fill="#1d3b34"/></svg></section>
<section><div id="strip" class="strip" style="background-image: url('${tile}')"></div></section>
<section class="tall"><h2>Canvas and storage</h2><canvas id="cv" width="300" height="150"></canvas><p id="store">…</p></section>
<section id="reveal" class="reveal tall"><h2>Revealed on scroll</h2><p>An IntersectionObserver adds a class.</p></section>
<section id="contact" class="tall"><h2>Contact</h2><p>Reached through an in-page anchor.</p></section>
<button class="fixed-btn" type="button">Book</button>
<script>
(function () {
  var out
  try {
    localStorage.setItem('fx', '1')
    document.cookie = 'fx=1; path=/'
    out = 'ls=' + localStorage.getItem('fx') + ' cookie=' + document.cookie
  } catch (e) {
    out = 'error ' + e.name
  }
  document.getElementById('store').textContent = out
  new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { if (e.isIntersecting) e.target.classList.add('in') })
  }, { threshold: 0.1 }).observe(document.getElementById('reveal'))
  var cv = document.getElementById('cv'), ctx = cv.getContext('2d'), f = 0
  function draw() {
    ctx.fillStyle = 'hsl(' + f * 12 + ', 60%, 50%)'
    ctx.fillRect(f * 10, 0, 10, 150)
    f++
    if (f < 30) requestAnimationFrame(draw)
    else window.__fxDone = true
  }
  requestAnimationFrame(draw)
})()
</script>
</body>
</html>
`
writeFileSync(path.join(here, 'fidelity.html'), html)
console.log(`fidelity.html: ${(html.length / 1024).toFixed(0)} KB`)
