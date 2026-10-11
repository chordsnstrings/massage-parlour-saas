import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { type Browser, type BrowserContext, expect, type Frame, type Page, test } from '@playwright/test'
import sharp from 'sharp'
import { admin, makeStudio, signInStudioOnAdmin, signUpOwner, site, studioUrl } from './helpers'

/**
 * R24 owner rule (2026-10-11): "it must also keep each and every detail in the HTML including the scrolling and if i
 * have html for this website it should applies as it is without missing anything at all". PROOF: the fixture design
 * (fixtures/fidelity.html, rebuilt by fixtures/make-fidelity.mjs) opened directly as a page is compared pixel by
 * pixel and by computed styles with the same design uploaded through the console and shown on the spa site (the
 * design document itself), in the Studio draft preview and in the console template preview (frames), at 1440×900
 * and 390×844 and several scroll positions. Fails if any visible change sneaks back in; the same file with
 * "Phone fixes" on must differ (negative control).
 */
const FIXTURE = new URL('./fixtures/fidelity.html', import.meta.url)
const RAW = 'http://design.test/'
const OUT = 'test-results/fidelity'
/**
 * R24 review: both sides are the same Chromium drawing the same bytes, so NOTHING may differ (measured: 0 differing
 * pixels for every view, target and scroll position). A pixel counts as different above 24 in a channel; counts are
 * printed, so any noise that ever shows up gets looked into instead of tolerated.
 */
const MAX_BAD_PX = 0

const VIEWS = [
  { name: 'desktop', viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false },
  { name: 'phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
] as const
const POSITIONS = [0, 600, 1500, 'bottom', 'anchor'] as const
type Position = (typeof POSITIONS)[number]

/** Computed styles and geometry of the key elements (the design's own behaviour, not just its pixels). */
// String.raw: the regexes inside keep their backslashes.
const PROBE = String.raw`(() => {
  const $ = (id) => document.getElementById(id)
  const r = (el) => { const b = el.getBoundingClientRect(); return [b.x, b.y, b.width, b.height].map((n) => Math.round(n)) }
  const cs = (el, props) => Object.fromEntries(props.map((p) => [p, getComputedStyle(el)[p]]))
  const ctx = $('cv').getContext('2d')
  let hash = 0
  for (const v of ctx.getImageData(0, 0, 300, 150).data) hash = (hash * 31 + v) >>> 0
  return {
    font: [getComputedStyle($('title')).fontFamily, document.fonts.check('56px Fx')],
    img: [r($('square')), cs($('square'), ['width', 'height', 'maxWidth', 'objectFit', 'objectPosition'])],
    // Which srcset candidate the browser picked (data: candidates are chosen differently from URLs).
    imgCandidate: [...$('square').srcset.matchAll(/(\S+)\s+(\d)x/g)].find((m) => m[1] === $('square').currentSrc)?.[2] ?? 'src',
    svg: [r($('svg')), cs($('svg'), ['width', 'height', 'maxWidth'])],
    strip: r($('strip')),
    html: cs(document.documentElement, ['overflowX', 'overflowY', 'maxWidth']),
    body: cs(document.body, ['overflowX', 'overflowY', 'margin']),
    header: [r($('header')), getComputedStyle($('header')).position],
    headerLink: cs(document.querySelector('header a'), ['color', 'fontSize', 'fontFamily', 'textDecorationLine']),
    fixed: [r(document.querySelector('.fixed-btn')), cs(document.querySelector('.fixed-btn'), ['fontFamily', 'fontSize', 'color', 'backgroundColor'])],
    latin: $('latin').textContent,
    earlyRead: $('early-read').textContent,
    nested: r($('nested')),
    object: r($('obj')),
    fetched: $('fetched').textContent,
    mailForm: $('mail').getAttribute('action'),
    progress: r($('progress')),
    reveal: [$('reveal').className, getComputedStyle($('reveal')).opacity],
    canvas: hash,
    sizes: [document.documentElement.scrollWidth, document.documentElement.scrollHeight, innerWidth, innerHeight],
    scroll: [Math.round(scrollX), Math.round(scrollY)],
    store: $('store').textContent,
    viewportMeta: document.querySelector('meta[name=viewport]')?.getAttribute('content') ?? null,
    hasBaseSheet: Boolean(document.querySelector('style[data-spa-base]')),
  }
})()`

/** The design is fully there: fonts, images, the canvas animation (30 frames, then it stops). */
const READY = `(async () => {
  if (!document.getElementById('cv') || !window.__fxDone || !window.__fetchDone) return false
  await document.fonts.ready
  return document.fonts.check('56px Fx') && [...document.images].every((i) => i.complete && i.naturalWidth > 0)
})()`
const SETTLE = `new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 120))))`

type Target = { name: string; doc: () => Promise<Page | Frame>; shot: () => Promise<Buffer>; page: Page }

async function ready(doc: Page | Frame) {
  await expect.poll(() => doc.evaluate(READY).catch(() => false), { timeout: 30_000 }).toBe(true)
}

async function moveTo(t: Target, at: Position) {
  const doc = await t.doc()
  if (at === 'anchor') {
    await doc.evaluate('scrollTo(0, 0)')
    await doc.evaluate(SETTLE)
    await doc.locator('#to-contact').click()
  } else await doc.evaluate(`scrollTo(0, ${at === 'bottom' ? 'document.documentElement.scrollHeight' : at})`)
  await doc.evaluate(SETTLE)
}

/** Pixels that differ by more than 24 in any channel; writes both shots + a diff image when over the limit. */
async function compare(raw: Buffer, other: Buffer, name: string) {
  const [a, b] = await Promise.all(
    [raw, other].map((x) => sharp(x).ensureAlpha().raw().toBuffer({ resolveWithObject: true })),
  )
  expect([b!.info.width, b!.info.height], `${name}: size`).toEqual([a!.info.width, a!.info.height])
  const diff = Buffer.alloc(a!.data.length)
  let bad = 0
  for (let i = 0; i < a!.data.length; i += 4) {
    const d = Math.max(
      Math.abs(a!.data[i]! - b!.data[i]!),
      Math.abs(a!.data[i + 1]! - b!.data[i + 1]!),
      Math.abs(a!.data[i + 2]! - b!.data[i + 2]!),
    )
    if (d > 24) {
      bad++
      diff.set([255, 0, 0, 255], i)
    } else diff.set([a!.data[i]! / 3, a!.data[i + 1]! / 3, a!.data[i + 2]! / 3, 255], i)
  }
  if (bad) console.log(`[fidelity] ${name}: ${bad} differing pixels`)
  if (bad > MAX_BAD_PX) {
    await mkdir(OUT, { recursive: true })
    await writeFile(`${OUT}/${name}-raw.png`, raw)
    await writeFile(`${OUT}/${name}-shown.png`, other)
    await sharp(diff, { raw: { width: a!.info.width, height: a!.info.height, channels: 4 } })
      .png()
      .toFile(`${OUT}/${name}-diff.png`)
  }
  return bad
}

async function rawPage(ctx: BrowserContext, html: Buffer) {
  const page = await ctx.newPage()
  // The file's own bytes, no charset in the header: the browser reads its <meta charset> (windows-1252), as when opened.
  await page.route(`${RAW}**`, (r) => r.fulfill({ contentType: 'text/html', body: html }))
  await page.goto(RAW)
  await ready(page)
  return page
}

/** A design frame on a platform page (preview): its document, and screenshots of exactly the frame. */
async function frameTarget(page: Page, name: string): Promise<Target> {
  const el = page.locator('iframe.site-html-design')
  const frame = async () => (await (await el.elementHandle())!.contentFrame())!
  await ready(await frame())
  return { name, page, doc: frame, shot: () => el.screenshot() }
}

async function openContexts(browser: Browser, state: Awaited<ReturnType<BrowserContext['storageState']>>) {
  return Promise.all(
    VIEWS.map(async (v) => ({
      view: v,
      ctx: await browser.newContext({
        viewport: v.viewport,
        isMobile: v.isMobile,
        hasTouch: v.hasTouch,
        deviceScaleFactor: 1,
        storageState: state,
      }),
    })),
  )
}

async function upload(page: Page, name: string, html: Buffer, phoneFixes: boolean) {
  await page.goto(`${admin}/templates`)
  await page.getByRole('button', { name: 'Upload HTML' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Template name').fill(name)
  await dialog
    .getByLabel('HTML file')
    .setInputFiles({ name: 'fidelity.html', mimeType: 'text/html', buffer: html })
  if (phoneFixes) await dialog.getByRole('checkbox', { name: /^Phone fixes/ }).check()
  await dialog.getByRole('checkbox', { name: /Spas can pick it right away/ }).check()
  await dialog.getByRole('button', { name: 'Upload' }).click()
  await expect(
    page.getByText(new RegExp(`${name} uploaded\\. Stored exactly as the file \\(read as windows-1252\\)`)),
  ).toBeVisible({ timeout: 60_000 })
  const href = await page.getByRole('link', { name: `Preview ${name}` }).getAttribute('href')
  return new URL(href!, page.url()).href
}

test('R24 fidelity: an uploaded HTML design looks and behaves exactly like the file opened directly', async ({
  page,
  browser,
}) => {
  test.setTimeout(600_000)
  const html = await readFile(FIXTURE)
  const owner = await signUpOwner(page, { spa: 'Fidelity Spa' })
  const { slug } = owner
  await makeStudio(slug)
  await signInStudioOnAdmin(page, owner.email)

  const exactPreview = await upload(page, 'Fidelity Exact', html, false)
  const fixedPreview = await upload(page, 'Fidelity Fixes', html, true)
  await test.step('apply the exact design to the spa and publish', async () => {
    await page.goto(studioUrl(slug))
    await page.getByRole('button', { name: 'Use Fidelity Exact' }).click()
    await expect(page.getByTestId('current-template')).toHaveText('Fidelity Exact', { timeout: 30_000 })
    await page.getByRole('button', { name: 'Publish site' }).click()
    await page.getByRole('button', { name: 'Publish now' }).click()
    await expect(page.getByText('Published 1 page')).toBeVisible({ timeout: 30_000 })
  })

  const contexts = await openContexts(browser, await page.context().storageState())
  try {
    for (const { view, ctx } of contexts) {
      await test.step(`${view.name}: spa site, Studio preview and template preview = the raw file`, async () => {
        const raw = await rawPage(ctx, html)

        const live = await ctx.newPage()
        const res = await live.goto(site(slug))
        // The live page IS the design document: sandboxed (opaque origin), never allow-same-origin.
        const h = res!.headers()
        expect(h['content-security-policy']).toContain('sandbox allow-scripts')
        expect(h['content-security-policy']).not.toContain('allow-same-origin')
        expect(h['cross-origin-opener-policy']).toBeUndefined()
        expect(h['permissions-policy']).not.toContain('accelerometer')
        // R24 review: nothing narrower than default-src (data:/blob: fetches, <object>, frames, mailto: forms).
        for (const d of ['connect-src', 'object-src', 'frame-src', 'font-src', 'form-action'])
          expect(h['content-security-policy']).not.toContain(d)
        expect(await live.evaluate('self.origin')).toBe('null')
        // No platform frame (the one iframe is the design's own nested frame).
        await expect(live.locator('iframe.site-html-design')).toHaveCount(0)
        await expect(live.locator('iframe')).toHaveCount(1)
        await ready(live)
        const liveTarget: Target = {
          name: 'live',
          page: live,
          doc: async () => live,
          shot: () => live.screenshot(),
        }

        const studio = await ctx.newPage()
        await studio.goto(studioUrl(slug, '/preview'))
        const studioTarget = await frameTarget(studio, 'studio-preview')

        const template = await ctx.newPage()
        await template.goto(exactPreview)
        // The preview's own page switcher floats over the frame: hidden (it is platform chrome, not the design).
        await template.addStyleTag({ content: 'nav[aria-label="Template pages"]{display:none!important}' })
        const templateTarget = await frameTarget(template, 'template-preview')

        // Frames (previews) are compared with the file in a window of the frame's size that doesn't zoom: on a phone the
        // browser zooms out a page wider than the screen (this fixture is), which the live page — the design document
        // itself — does exactly like the file, but a frame inside a platform page never can (CODEMAP "HTML designs").
        const frameCtx = view.isMobile
          ? await browser.newContext({ viewport: view.viewport, hasTouch: true, deviceScaleFactor: 1 })
          : null
        const rawFramed = frameCtx ? await rawPage(frameCtx, html) : raw
        const asTarget = (p: Page, name: string): Target => ({
          name,
          page: p,
          doc: async () => p,
          shot: () => p.screenshot(),
        })
        for (const at of POSITIONS) {
          const want = new Map<Page, { probe: unknown; shot: Buffer }>()
          for (const p of new Set([raw, rawFramed])) {
            await moveTo(asTarget(p, 'raw'), at)
            want.set(p, { probe: await p.evaluate(PROBE), shot: await p.screenshot() })
          }
          for (const [t, base] of [
            [liveTarget, raw],
            [studioTarget, rawFramed],
            [templateTarget, rawFramed],
          ] as const) {
            await moveTo(t, at)
            expect(
              await (await t.doc()).evaluate(PROBE),
              `${view.name} ${t.name} @${at}: computed styles`,
            ).toEqual(want.get(base)!.probe)
            const bad = await compare(want.get(base)!.shot, await t.shot(), `${view.name}-${t.name}-${at}`)
            expect(bad, `${view.name} ${t.name} @${at}: differing pixels`).toBeLessThanOrEqual(MAX_BAD_PX)
          }
        }
        const probe = (await raw.evaluate(PROBE)) as {
          store: string
          hasBaseSheet: boolean
          sizes: number[]
          imgCandidate: string
          latin: string
          earlyRead: string
          fetched: string
        }
        // The storage shim made the sandboxed copies behave like the real origin.
        expect(probe.store).toBe('ls=1 cookie=fx=1')
        // The probe itself works (a real srcset density, the file's own text and script-time reads).
        expect(['1', '2']).toContain(probe.imgCandidate)
        expect(probe.latin).toBe('Café “Relax” – €5 · déjà vu')
        expect(probe.earlyRead).toBe('true 160 80')
        expect(probe.fetched).toBe('fetched-ok')
        // Known residual (CODEMAP "HTML designs"): frames inside a design inherit its sandbox — an opaque origin, where
        // third-party players / widgets that need cookies or storage may stay blank. Same pixels for a static frame.
        // (Playwright names a frame by its id when it has no name.)
        const nested = (p: Page) => p.frames().find((f) => f.name() === 'nested')!
        expect(await nested(raw).evaluate('self.origin')).toBe('http://design.test')
        expect(await nested(live).evaluate('self.origin')).toBe('null')
        expect(probe.hasBaseSheet).toBe(false)
        // The wide elements still overflow, exactly as in the file.
        expect(probe.sizes[0]).toBeGreaterThan(view.viewport.width)
        await Promise.all([raw.close(), live.close(), studio.close(), template.close()])
        await frameCtx?.close()
      })
    }

    await test.step('negative control: the same file with Phone fixes on is visibly changed on a phone', async () => {
      const phone = contexts.find((c) => c.view.name === 'phone')!.ctx
      const plain = await browser.newContext({
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        deviceScaleFactor: 1,
      })
      const raw = await rawPage(plain, html)
      const fixed = await phone.newPage()
      await fixed.goto(fixedPreview)
      await fixed.addStyleTag({ content: 'nav[aria-label="Template pages"]{display:none!important}' })
      const t = await frameTarget(fixed, 'fixes')
      for (const p of [raw, await t.doc()]) {
        await p.evaluate('scrollTo(0, 1000)')
        await p.evaluate(SETTLE)
      }
      const bad = await compare(await raw.screenshot(), await t.shot(), 'phone-fixes-control')
      expect(bad).toBeGreaterThan(MAX_BAD_PX)
      const shown = (await (await t.doc()).evaluate(PROBE)) as { hasBaseSheet: boolean; img: unknown }
      expect(shown.hasBaseSheet).toBe(true)
      expect(shown.img).not.toEqual(((await raw.evaluate(PROBE)) as { img: unknown }).img)
      await plain.close()
    })
  } finally {
    await Promise.all(contexts.map((c) => c.ctx.close()))
  }
})
