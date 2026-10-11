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
/** Anti-alias noise only: at most 0.1 % of the pixels may differ by more than 24 in a channel. */
const MAX_BAD = 0.001

const VIEWS = [
  { name: 'desktop', viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false },
  { name: 'phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
] as const
const POSITIONS = [0, 600, 1500, 'bottom', 'anchor'] as const
type Position = (typeof POSITIONS)[number]

/** Computed styles and geometry of the key elements (the design's own behaviour, not just its pixels). */
const PROBE = `(() => {
  const $ = (id) => document.getElementById(id)
  const r = (el) => { const b = el.getBoundingClientRect(); return [b.x, b.y, b.width, b.height].map((n) => Math.round(n)) }
  const cs = (el, props) => Object.fromEntries(props.map((p) => [p, getComputedStyle(el)[p]]))
  const ctx = $('cv').getContext('2d')
  let hash = 0
  for (const v of ctx.getImageData(0, 0, 300, 150).data) hash = (hash * 31 + v) >>> 0
  return {
    font: [getComputedStyle($('title')).fontFamily, document.fonts.check('56px Fx')],
    img: [r($('square')), cs($('square'), ['width', 'height', 'maxWidth', 'objectFit', 'objectPosition'])],
    svg: [r($('svg')), cs($('svg'), ['width', 'height', 'maxWidth'])],
    strip: r($('strip')),
    html: cs(document.documentElement, ['overflowX', 'overflowY', 'maxWidth']),
    body: cs(document.body, ['overflowX', 'overflowY', 'margin']),
    header: [r($('header')), getComputedStyle($('header')).position],
    fixed: r(document.querySelector('.fixed-btn')),
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
  if (!document.getElementById('cv') || !window.__fxDone) return false
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

/** Share of pixels that differ by more than 24 in any channel; writes both shots + a diff image when over the limit. */
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
  const share = bad / (a!.info.width * a!.info.height)
  if (share > MAX_BAD) {
    await mkdir(OUT, { recursive: true })
    await writeFile(`${OUT}/${name}-raw.png`, raw)
    await writeFile(`${OUT}/${name}-shown.png`, other)
    await sharp(diff, { raw: { width: a!.info.width, height: a!.info.height, channels: 4 } })
      .png()
      .toFile(`${OUT}/${name}-diff.png`)
  }
  return share
}

async function rawPage(ctx: BrowserContext, html: string) {
  const page = await ctx.newPage()
  await page.route(`${RAW}**`, (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }))
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

async function upload(page: Page, name: string, html: string, phoneFixes: boolean) {
  await page.goto(`${admin}/templates`)
  await page.getByRole('button', { name: 'Upload HTML' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Template name').fill(name)
  await dialog
    .getByLabel('HTML file')
    .setInputFiles({ name: 'fidelity.html', mimeType: 'text/html', buffer: Buffer.from(html) })
  if (phoneFixes) await dialog.getByRole('checkbox', { name: /^Phone fixes/ }).check()
  await dialog.getByRole('checkbox', { name: /Spas can pick it right away/ }).check()
  await dialog.getByRole('button', { name: 'Upload' }).click()
  await expect(page.getByText(new RegExp(`${name} uploaded\\. Moved 5 embedded`))).toBeVisible({
    timeout: 60_000,
  })
  const href = await page.getByRole('link', { name: `Preview ${name}` }).getAttribute('href')
  return new URL(href!, page.url()).href
}

test('R24 fidelity: an uploaded HTML design looks and behaves exactly like the file opened directly', async ({
  page,
  browser,
}) => {
  test.setTimeout(600_000)
  const html = await readFile(FIXTURE, 'utf8')
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
        expect(await live.evaluate('self.origin')).toBe('null')
        await expect(live.locator('iframe')).toHaveCount(0)
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

        const rawTarget: Target = {
          name: 'raw',
          page: raw,
          doc: async () => raw,
          shot: () => raw.screenshot(),
        }
        for (const at of POSITIONS) {
          await moveTo(rawTarget, at)
          const want = await raw.evaluate(PROBE)
          const wantShot = await raw.screenshot()
          for (const t of [liveTarget, studioTarget, templateTarget]) {
            await moveTo(t, at)
            expect(
              await (await t.doc()).evaluate(PROBE),
              `${view.name} ${t.name} @${at}: computed styles`,
            ).toEqual(want)
            const share = await compare(wantShot, await t.shot(), `${view.name}-${t.name}-${at}`)
            expect(share, `${view.name} ${t.name} @${at}: differing pixels`).toBeLessThanOrEqual(MAX_BAD)
          }
        }
        const probe = (await raw.evaluate(PROBE)) as { store: string; hasBaseSheet: boolean; sizes: number[] }
        // The storage shim made the sandboxed copies behave like the real origin.
        expect(probe.store).toBe('ls=1 cookie=fx=1')
        expect(probe.hasBaseSheet).toBe(false)
        // The wide elements still overflow, exactly as in the file.
        expect(probe.sizes[0]).toBeGreaterThan(view.viewport.width)
        await Promise.all([raw.close(), live.close(), studio.close(), template.close()])
      })
    }

    await test.step('negative control: the same file with Phone fixes on is visibly changed on a phone', async () => {
      const phone = contexts.find((c) => c.view.name === 'phone')!.ctx
      const raw = await rawPage(phone, html)
      const fixed = await phone.newPage()
      await fixed.goto(fixedPreview)
      await fixed.addStyleTag({ content: 'nav[aria-label="Template pages"]{display:none!important}' })
      const t = await frameTarget(fixed, 'fixes')
      for (const p of [raw, await t.doc()]) {
        await p.evaluate('scrollTo(0, 1000)')
        await p.evaluate(SETTLE)
      }
      const share = await compare(await raw.screenshot(), await t.shot(), 'phone-fixes-control')
      expect(share).toBeGreaterThan(MAX_BAD)
      const shown = (await (await t.doc()).evaluate(PROBE)) as { hasBaseSheet: boolean; img: unknown }
      expect(shown.hasBaseSheet).toBe(true)
      expect(shown.img).not.toEqual(((await raw.evaluate(PROBE)) as { img: unknown }).img)
    })
  } finally {
    await Promise.all(contexts.map((c) => c.ctx.close()))
  }
})
