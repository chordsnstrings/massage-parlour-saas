// F15 site blocks: Map, Video, Google reviews, Instagram feed, Blog list + post pages, Enquiry form → dashboard.
import { expect, test } from '@playwright/test'
import { branches, reviews, sitePages, socialAccounts, socialPosts, tenants } from '@spa/db'
import { ensureSite, putFile } from '@spa/services'
import { applySiteEditOps } from '@spa/services/site-kit'
import { eq } from 'drizzle-orm'
import { siteEditSchema } from '../src/components/site/ai-schema'
import { app, makeStudio, PNG, PORT, seedCatalog, signUpOwner, site, testDb } from './helpers'

const ADDRESS = 'Shop 4, Marina Walk, Dubai'
const YT = 'dQw4w9WgXcQ'

const band = { background: 'none', padding: { base: 'lg' } }
const homePage = {
  root: {
    props: { title: { en: 'Home', ar: 'الرئيسية' }, description: { en: 'Cedar Spa in Dubai Marina' } },
  },
  content: [
    {
      type: 'Heading',
      props: {
        id: 'h-1',
        eyebrow: { en: '' },
        text: { en: 'Cedar Spa', ar: 'سيدار سبا' },
        level: 'h1',
        size: 'xl',
        align: { base: 'start' },
      },
    },
    {
      type: 'Map',
      props: {
        id: 'map-1',
        title: { en: 'Find us', ar: 'موقعنا' },
        intro: { en: '' },
        layout: 'split',
        height: 'md',
        ...band,
      },
    },
    {
      type: 'Video',
      props: {
        id: 'video-1',
        title: { en: 'Step inside', ar: 'ادخل إلى عالمنا' },
        intro: { en: '' },
        url: `https://youtu.be/${YT}`,
        poster: '/icon.svg',
        caption: { en: '' },
        aspect: '16:9',
        size: 'contained',
        ...band,
      },
    },
    {
      type: 'Reviews',
      props: {
        id: 'reviews-1',
        title: { en: 'What our guests say', ar: 'ماذا يقول ضيوفنا' },
        intro: { en: '' },
        count: '3',
        minRating: '4',
        showSummary: true,
        ...band,
      },
    },
    {
      type: 'InstagramFeed',
      props: {
        id: 'ig-1',
        title: { en: 'On Instagram' },
        intro: { en: '' },
        count: '6',
        showFollow: true,
        ...band,
      },
    },
    {
      type: 'BlogList',
      props: {
        id: 'blog-1',
        title: { en: 'From our journal', ar: 'من مدونتنا' },
        intro: { en: '' },
        count: '3',
        layout: 'grid',
        ...band,
      },
    },
  ],
}

test('F15 blocks are in the palette schema the AI editor + Claude MCP use, and validate their options', () => {
  const schema = siteEditSchema()
  for (const type of ['Map', 'Video', 'Reviews', 'InstagramFeed', 'BlogList', 'EnquiryForm'])
    expect(Object.keys(schema.blocks), type).toContain(type)
  // The post article is rendered by the post page only.
  expect(Object.keys(schema.blocks)).not.toContain('BlogPost')
  expect(schema.blocks.Video?.props.url).toEqual({ kind: 'text' })
  const add = (type: string, props: Record<string, unknown>) =>
    applySiteEditOps(
      { data: { root: {}, content: [] }, theme: {}, ops: [{ op: 'add', type, props }] },
      schema,
    )
  expect(add('Video', { url: `https://youtu.be/${YT}`, aspect: '9:16' }).ok).toBe(true)
  expect(add('Map', { layout: 'map' }).ok).toBe(true)
  expect(add('EnquiryForm', { title: { en: 'Write to us', ar: 'راسلنا' } }).ok).toBe(true)
  expect(add('Reviews', { minRating: '5', count: '6' }).ok).toBe(true)
  expect(add('Map', { layout: 'bogus' }).ok).toBe(false)
  expect(add('BlogPost', {}).ok).toBe(false)
})

test('Website Studio: F15 blocks publish to the live site (EN/AR, 360 px), blog posts, enquiry → dashboard', async ({
  page,
}) => {
  test.setTimeout(240_000)
  const { slug } = await signUpOwner(page, { spa: 'Cedar Spa' })
  await makeStudio(slug)
  const seed = await seedCatalog(slug)
  const db = testDb()
  await db.update(branches).set({ address: ADDRESS }).where(eq(branches.tenantId, seed.tenantId))
  await db.transaction((tx) =>
    ensureSite(tx, seed.tenantId, {
      key: 'nordic',
      name: 'Nordic Clean',
      theme: {},
      pages: [{ slug: '', title: { en: 'Home', ar: 'الرئيسية' }, data: homePage }],
    }),
  )
  // Synced Google reviews + an Instagram post published from the dashboard (Premium data).
  await db.insert(reviews).values([
    {
      tenantId: seed.tenantId,
      externalId: 'g1',
      author: 'Layla Mansour',
      rating: 5,
      text: 'Calm and spotless.',
    },
    { tenantId: seed.tenantId, externalId: 'g2', author: 'Omar', rating: 4, text: 'Great deep tissue.' },
    { tenantId: seed.tenantId, externalId: 'g3', author: 'Grumpy', rating: 2, text: 'Too quiet.' },
  ])
  const igImage = await db.transaction((tx) =>
    putFile(tx, {
      tenantId: seed.tenantId,
      bytes: PNG,
      contentType: 'image/png',
      isPublic: true,
      filename: 'ig.png',
    }),
  )
  await db
    .insert(socialAccounts)
    .values({ tenantId: seed.tenantId, platform: 'instagram', externalId: 'ig-cedar', username: 'cedarspa' })
  await db.insert(socialPosts).values({
    tenantId: seed.tenantId,
    platform: 'instagram',
    caption: 'Hot stone season',
    media: [{ url: `/files/${igImage.id}` }],
    status: 'published',
    publishedAt: new Date(),
  })
  const [home] = await db.select().from(sitePages).where(eq(sitePages.tenantId, seed.tenantId))
  const canvas = page.frameLocator('#preview-frame').first()

  await test.step('studio adds the Enquiry form from the library and publishes', async () => {
    await page.goto(`${app}/${slug}/website/editor/${home!.id}`)
    await expect(canvas.getByRole('heading', { name: 'Cedar Spa' })).toBeVisible({ timeout: 30_000 })
    // Data blocks render in the editor; the Map embed is a placeholder there (no Google iframe in the canvas).
    await expect(canvas.getByText('Calm and spotless.')).toBeVisible()
    await expect(canvas.locator('[data-map-embed]')).toHaveCount(0)
    await page.locator('[class*="NavItem-link"]', { hasText: 'Library' }).click()
    await page.getByRole('button', { name: 'Insert Enquiry form' }).click()
    await expect(canvas.getByRole('heading', { name: 'Send us a message' })).toBeVisible()
    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    await page.getByRole('button', { name: 'Publish now' }).click()
    await expect(page.getByText('Published — your page is live')).toBeVisible()
  })

  await test.step('studio writes and publishes a blog post (EN + AR)', async () => {
    await page.goto(`${app}/${slug}/website`)
    await page.getByRole('link', { name: 'New post' }).click()
    await page.waitForURL(/\/website\/blog\/new$/)
    await page.locator('[name="title.en"]').fill('Why hot stones work')
    await page.locator('[name="title.ar"]').fill('لماذا تنجح الأحجار الساخنة')
    await page.getByLabel('Web address').fill('Bad Address')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('Use lowercase letters, numbers and dashes').first()).toBeVisible()
    await page.getByLabel('Web address').fill('hot-stones')
    await page.locator('[name="excerpt.en"]').fill('Warmth, pressure and calm.')
    await page
      .locator('[name="body.en"]')
      .fill('Basalt stones hold heat.\n\n## Benefits\n- Deeper relaxation\n- Easier muscles')
    await page.locator('[name="body.ar"]').fill('تحتفظ أحجار البازلت بالحرارة.')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page.waitForURL(/\/website\/blog\/[0-9a-f-]{36}$/)
    await expect(page.getByText('Draft', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Publish' }).click()
    await expect(page.getByText('Post published')).toBeVisible()
    await expect(page.getByText('Published', { exact: true })).toBeVisible()
  })

  const thirdParty: string[] = []
  page.on('request', (r) => {
    const host = new URL(r.url()).hostname
    if (/youtube|vimeo/.test(host)) thirdParty.push(host)
  })

  await test.step('live site: map card + embed, click-to-load video, reviews, Instagram, blog list', async () => {
    const res = await page.goto(site(slug))
    const csp = res?.headers()['content-security-policy'] ?? ''
    expect(csp).toMatch(/frame-src [^;]*https:\/\/www\.google\.com/)
    expect(csp).toMatch(/frame-src [^;]*https:\/\/www\.youtube-nocookie\.com/)
    // Map: the static "Open in Google Maps" link keeps the address search; the embed is lazy and from google.com only.
    const open = page.locator('a[data-maps-link]', { hasText: 'Open in Google Maps' })
    await expect(open).toHaveAttribute(
      'href',
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ADDRESS)}`,
    )
    const embed = page.locator('iframe[data-map-embed]')
    await expect(embed).toHaveAttribute('src', /^https:\/\/www\.google\.com\/maps\?q=Shop%204/)
    await expect(embed).toHaveAttribute('loading', 'lazy')
    // Video: a poster button only — nothing from YouTube until play.
    const poster = page.getByRole('button', { name: 'Play video: Step inside' })
    await expect(poster).toBeVisible()
    await expect(page.locator('iframe[src*="youtube"]')).toHaveCount(0)
    expect(thirdParty).toEqual([])
    // Reviews: good ones with text, average over all synced reviews, first name + initial.
    await expect(page.getByText('Calm and spotless.')).toBeVisible()
    await expect(page.getByText('Layla M.')).toBeVisible()
    await expect(page.getByText('Too quiet.')).toHaveCount(0)
    await expect(page.locator('[data-reviews-summary]')).toContainText('3.7')
    // Instagram: the published post's picture, linked to the profile.
    await expect(page.getByRole('img', { name: 'Hot stone season' })).toBeVisible()
    await expect(page.getByRole('link', { name: /Follow us on Instagram/ })).toHaveAttribute(
      'href',
      'https://www.instagram.com/cedarspa/',
    )
    // Blog list → the post page.
    await expect(page.locator('[data-blog-post="hot-stones"]')).toBeVisible()
    await poster.click()
    await expect(
      page.locator('iframe[src^="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1"]'),
    ).toBeAttached()
  })

  await test.step('blog post page: article, SEO meta, BlogPosting JSON-LD, sitemap entry', async () => {
    await page.goto(site(slug))
    await page
      .locator('[data-blog-post="hot-stones"]')
      .getByRole('link', { name: 'Why hot stones work', exact: true })
      .click()
    await page.waitForURL(/\/blog\/hot-stones$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Why hot stones work' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'Benefits' })).toBeVisible()
    await expect(page.getByRole('listitem').filter({ hasText: 'Deeper relaxation' })).toBeVisible()
    await expect(page).toHaveTitle('Why hot stones work · Cedar Spa')
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/blog\/hot-stones$/)
    await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content', 'article')
    const ld = JSON.parse(
      (await page.locator('script[type="application/ld+json"]').first().textContent()) ?? '{}',
    )
    const post = (ld['@graph'] as { '@type': string; headline?: string }[]).find(
      (n) => n['@type'] === 'BlogPosting',
    )
    expect(post?.headline).toBe('Why hot stones work')
    const u = new URL(site(slug))
    const sitemap = await page.request.get(
      `http://127.0.0.1:${PORT}${u.pathname.replace(/\/$/, '')}/sitemap.xml`,
      {
        headers: { host: u.host },
      },
    )
    expect(await sitemap.text()).toContain('/blog/hot-stones</loc>')
    // Unknown posts 404.
    expect((await page.goto(`${site(slug)}/blog/nope`))?.status()).toBe(404)
  })

  await test.step('Arabic: right-to-left site, Arabic form labels and post', async () => {
    await page.goto(`${site(slug)}?lang=ar`)
    await expect(page.locator('.site-root')).toHaveAttribute('dir', 'rtl')
    await expect(page.getByRole('heading', { name: 'أرسل لنا رسالة' })).toBeVisible()
    await expect(page.getByLabel('الاسم')).toBeVisible()
    await expect(page.getByRole('link', { name: 'افتح في خرائط Google' }).first()).toBeVisible()
    await page.goto(`${site(slug)}/blog/hot-stones?lang=ar`)
    await expect(page.locator('.site-root')).toHaveAttribute('dir', 'rtl')
    await expect(page.getByRole('heading', { level: 1, name: 'لماذا تنجح الأحجار الساخنة' })).toBeVisible()
  })

  await test.step('360 px: no horizontal scroll on the home and post pages', async () => {
    await page.setViewportSize({ width: 360, height: 780 })
    for (const path of ['', '?lang=ar', '/blog/hot-stones']) {
      await page.goto(`${site(slug)}${path}`)
      await expect(page.getByRole('heading').first()).toBeVisible()
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      expect(overflow, path || 'home').toBeLessThanOrEqual(0)
    }
    await page.setViewportSize({ width: 1280, height: 800 })
  })

  await test.step('enquiry form: server validation, then sent (Turnstile) → stored for this spa', async () => {
    await page.goto(site(slug))
    const form = page.locator('form[data-site-enquiry]')
    await form.getByRole('button', { name: 'Send message' }).click()
    await expect(form.getByText('Enter your name')).toBeVisible()
    await expect(form.getByText('Enter your phone number')).toBeVisible()
    await form.getByLabel('Your name').fill('Layla Mansour')
    await form.getByLabel('Phone (WhatsApp)').fill('050 123 4567')
    await form.getByLabel('Message').fill('Do you have a couples slot on Friday?')
    await form.getByRole('button', { name: 'Send message' }).click()
    await expect(page.getByTestId('site-enquiry-sent')).toContainText('we’ll reply on WhatsApp soon', {
      timeout: 40_000,
    })
  })

  await test.step('dashboard: Inbox → Enquiries lists it with a WhatsApp click-to-send reply (EN + TH)', async () => {
    await page.goto(`${app}/${slug}/enquiries`)
    await expect(page.getByRole('heading', { name: 'Website enquiries' })).toBeVisible()
    const row = page.locator('tr', { hasText: 'Do you have a couples slot on Friday?' })
    await expect(row.getByText('Layla Mansour')).toBeVisible()
    await expect(row.getByText('+971501234567')).toBeVisible()
    await expect(row.getByRole('link', { name: 'Reply to Layla Mansour on WhatsApp' })).toHaveAttribute(
      'href',
      /^https:\/\/wa\.me\/971501234567\?text=Hi%20Layla%2C%20thank%20you%20for%20your%20message%20to%20Cedar%20Spa/,
    )
    await row.getByRole('button', { name: 'Mark replied' }).click()
    await expect(page.getByText('Enquiry updated')).toBeVisible()
    await page.goto(`${app}/${slug}/enquiries?status=replied`)
    await expect(page.locator('tr', { hasText: 'Layla Mansour' }).getByText('Replied')).toBeVisible()
    await page.getByRole('button', { name: 'ไทย' }).click()
    await expect(page.getByRole('heading', { name: 'ข้อความจากเว็บไซต์' })).toBeVisible()
    await page.getByRole('button', { name: 'EN' }).click()
    await expect(page.getByRole('heading', { name: 'Website enquiries' })).toBeVisible()
  })

  await test.step('uploaded video: MP4 by magic bytes, served with byte ranges', async () => {
    await page.goto(`${app}/${slug}/website`)
    const result = await page.evaluate(async (tenant) => {
      const head = new Uint8Array([
        0,
        0,
        0,
        0x18,
        ...new TextEncoder().encode('ftypisom'),
        0,
        0,
        2,
        0,
        ...new TextEncoder().encode('isomiso2mp41'),
      ])
      const bytes = new Uint8Array(4096)
      bytes.set(head)
      const body = new FormData()
      body.set('file', new File([bytes], 'tour.mp4', { type: 'video/mp4' }))
      const up = await fetch(`/files/upload?tenant=${tenant}&kind=video`, { method: 'POST', body })
      const json = (await up.json()) as { ok: boolean; asset?: { url: string } }
      const bad = new FormData()
      bad.set('file', new File([new Uint8Array(64)], 'x.mp4', { type: 'video/mp4' }))
      const refused = await fetch(`/files/upload?tenant=${tenant}&kind=video`, { method: 'POST', body: bad })
      const range = json.asset ? await fetch(json.asset.url, { headers: { range: 'bytes=0-15' } }) : null
      return {
        ok: json.ok,
        refused: refused.status,
        status: range?.status,
        contentRange: range?.headers.get('content-range'),
        type: range?.headers.get('content-type'),
        length: range ? (await range.arrayBuffer()).byteLength : 0,
      }
    }, slug)
    expect(result).toEqual({
      ok: true,
      refused: 422,
      status: 206,
      contentRange: 'bytes 0-15/4096',
      type: 'video/mp4',
      length: 16,
    })
  })

  await test.step('Standard plan: reviews + Instagram render nothing on the live site', async () => {
    await db.update(tenants).set({ featureTier: 'standard' }).where(eq(tenants.id, seed.tenantId))
    await page.goto(site(slug))
    await expect(page.getByRole('heading', { name: 'Cedar Spa' })).toBeVisible()
    await expect(page.getByText('Calm and spotless.')).toHaveCount(0)
    await expect(page.getByRole('img', { name: 'Hot stone season' })).toHaveCount(0)
    await expect(page.locator('[data-editor-note]')).toHaveCount(0)
    // Free blocks stay.
    await expect(page.locator('form[data-site-enquiry]')).toBeVisible()
    await expect(page.locator('[data-blog-post="hot-stones"]')).toBeVisible()
  })
})
