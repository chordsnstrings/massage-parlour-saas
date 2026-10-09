import { expect, type FrameLocator, type Page, test } from '@playwright/test'
import { sitePages } from '@spa/db'
import { ensureSite } from '@spa/services'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { app, makeStudio, seedCatalog, signUpOwner, site, testDb } from './helpers'

const HERO = 'Find your calm'
const SHOTS = process.env.IMG_SHOTS_DIR

/** A wide photo whose subject (a "face") sits at the far left: a centred portrait crop cuts it off. */
const photo = async () => ({
  name: 'left-subject.png',
  mimeType: 'image/png',
  buffer: await sharp({ create: { width: 1600, height: 900, channels: 3, background: '#d9cbb8' } })
    .composite([
      {
        input: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><circle cx="230" cy="360" r="170" fill="#b0563c"/><rect x="150" y="560" width="160" height="300" fill="#6d3a2a"/></svg>',
        ),
      },
    ])
    .png()
    .toBuffer(),
})

const heroPage = {
  root: { props: { title: { en: 'Home' }, description: { en: '' } } },
  content: [
    {
      type: 'Hero',
      props: {
        id: 'hero-1',
        variant: 'split',
        eyebrow: { en: 'Wellness' },
        title: { en: HERO },
        subtitle: { en: 'Unhurried treatments.' },
        buttons: [],
        image: '',
        imageAlt: { en: 'Therapist at work' },
        background: 'none',
      },
    },
  ],
}

const frameOf = (root: FrameLocator | Page) =>
  root.getByRole('img', { name: 'Therapist at work' }).evaluate((el) => {
    const s = getComputedStyle(el)
    return { fit: s.objectFit, position: s.objectPosition, origin: s.transformOrigin, transform: s.transform }
  })

test('site builder photos: focal point, fit and zoom from the editor reach the public page', async ({
  page,
}) => {
  const { slug } = await signUpOwner(page, { spa: 'Focal Spa' })
  await makeStudio(slug)
  const seed = await seedCatalog(slug)
  const db = testDb()
  await db.transaction((tx) =>
    ensureSite(tx, seed.tenantId, {
      key: 'nordic',
      name: 'Nordic Clean',
      theme: {},
      pages: [{ slug: '', title: { en: 'Home' }, data: heroPage }],
    }),
  )
  const [home] = await db.select().from(sitePages).where(eq(sitePages.tenantId, seed.tenantId))
  const canvas = page.frameLocator('#preview-frame').first()
  // Puck keeps a hidden copy of the fields panel mounted; act on the visible one.
  const frameUi = () => page.getByTestId('image-frame').filter({ visible: true })
  const publish = async () => {
    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Publish now' }).click()
    await expect(page.getByText('Published — your page is live')).toBeVisible()
  }
  const shoot = async (name: string) => {
    if (!SHOTS) return
    const pub = await page.context().newPage()
    for (const width of [360, 1280]) {
      await pub.setViewportSize({ width, height: width < 768 ? 780 : 900 })
      await pub.goto(site(slug))
      await expect(pub.getByRole('img', { name: 'Therapist at work' })).toBeVisible()
      await pub.waitForTimeout(500)
      await pub.screenshot({ path: `${SHOTS}/hero-${name}-${width}.png` })
    }
    await pub.close()
  }

  await test.step('pick an uploaded photo into the hero: unframed = centred cover', async () => {
    await page.goto(`${app}/${slug}/website/editor/${home!.id}`)
    await expect(canvas.getByRole('heading', { name: HERO })).toBeVisible({ timeout: 30_000 })
    await canvas.getByRole('heading', { name: HERO }).click()
    await page.getByRole('button', { name: 'Choose from library' }).first().click()
    const picker = page.getByRole('dialog', { name: 'Choose an image' })
    await picker.getByLabel('Upload images to the library', { exact: true }).setInputFiles([await photo()])
    await picker.getByRole('button', { name: /^Use / }).first().click()
    await expect(picker).toBeHidden()
    await expect(frameUi()).toBeVisible()
    expect(await frameOf(canvas)).toMatchObject({ fit: 'cover', position: '50% 50%' })
    await publish()
    await shoot('before')
  })

  await test.step('click the focal point onto the subject: canvas follows live', async () => {
    const pad = frameUi().locator('img')
    const box = (await pad.boundingBox())!
    await page.mouse.click(box.x + box.width * 0.15, box.y + box.height * 0.4)
    await expect.poll(async () => (await frameOf(canvas)).position).toBe('15% 40%')
    // Keyboard: arrows nudge 1 %, Shift+arrow 10 %.
    await frameUi().getByTestId('focal-dot').focus()
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('Shift+ArrowDown')
    await expect.poll(async () => (await frameOf(canvas)).position).toBe('14% 50%')
    await expect(frameUi().getByTestId('focal-dot')).toHaveAttribute('aria-valuetext', '14% 50%')
    await publish()
    const pub = await page.context().newPage()
    await pub.goto(site(slug))
    expect(await frameOf(pub)).toMatchObject({
      fit: 'cover',
      position: '14% 50%',
      origin: expect.any(String),
    })
    await pub.close()
    await shoot('after')
  })

  await test.step('Fit + zoom reach the public page; RTL keeps the focal point', async () => {
    await frameUi().getByRole('button', { name: 'Fit', exact: true }).click()
    await page.getByRole('slider', { name: /^Zoom/ }).fill('1.5')
    await expect.poll(async () => (await frameOf(canvas)).fit).toBe('contain')
    await publish()
    for (const path of ['', '?lang=ar']) {
      const pub = await page.context().newPage()
      await pub.goto(`${site(slug)}${path}`)
      if (path) await expect(pub.locator('.site-root')).toHaveAttribute('dir', 'rtl')
      const f = await frameOf(pub)
      expect(f.fit).toBe('contain')
      expect(f.position).toBe('14% 50%')
      expect(f.transform).toBe('matrix(1.5, 0, 0, 1.5, 0, 0)')
      await pub.close()
    }
  })

  await test.step('Reset returns to a plain URL', async () => {
    await frameUi().getByRole('button', { name: 'Reset' }).click()
    await expect.poll(async () => (await frameOf(canvas)).position).toBe('50% 50%')
  })
})
