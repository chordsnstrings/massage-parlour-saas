import { expect, type Page, test } from '@playwright/test'
import { auditLog, pageVersions, sitePages } from '@spa/db'
import { ensureSite } from '@spa/services'
import { and, desc, eq } from 'drizzle-orm'
import {
  ADMIN,
  app,
  makeStudio,
  passTwoFactor,
  seedCatalog,
  signInPlatformAdmin,
  signUpOwner,
  testDb,
} from './helpers'

const homePage = {
  root: { props: { title: { en: 'Home', ar: 'الرئيسية' }, description: { en: '' } } },
  content: [
    {
      type: 'Section',
      props: {
        id: 'about-1',
        background: 'surface',
        padding: { base: 'lg' },
        width: 'contained',
        gap: 'md',
        content: [
          {
            type: 'Heading',
            props: {
              id: 'about-heading',
              eyebrow: { en: '' },
              text: { en: 'About our spa' },
              level: 'h2',
              size: 'lg',
              align: { base: 'start' },
            },
          },
        ],
      },
    },
  ],
}

/** Selects the canvas heading showing `from` and types `to` into its Heading field. */
async function editHeading(page: Page, from: string, to: string) {
  const canvas = page.frameLocator('#preview-frame').first()
  await expect(async () => {
    await canvas.getByRole('heading', { name: from }).click()
    await expect(page.getByRole('textbox', { name: 'Heading', exact: true })).toHaveValue(from, {
      timeout: 2_000,
    })
  }).toPass({ timeout: 30_000 })
  await page.getByRole('textbox', { name: 'Heading', exact: true }).fill(to)
  await expect(canvas.getByRole('heading', { name: to })).toBeVisible()
}

/** The platform super-admin signs in on the app host and lands on `path`. */
async function adminOnApp(page: Page, path: string) {
  await signInPlatformAdmin(page)
  const target = `${app}${path}`
  await page.goto(`${app}/login?next=${encodeURIComponent(new URL(target).pathname)}`)
  if (await page.getByLabel('Email').isVisible()) {
    await page.getByLabel('Email').fill(ADMIN.email)
    await page.getByLabel('Password').fill(ADMIN.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.waitForURL(/\/two-factor/)
    await passTwoFactor(page)
  }
  await page.waitForURL(target)
}

// F29: the Studio editor autosaves the draft (never silently over newer work), keeps an unsaved local copy and holds
// a per-page editing lock other super-admins see (view only / take over).
test('studio editor: autosave, local copy after a crash, editing lock + take over', async ({
  page: first,
  browser,
}) => {
  test.setTimeout(240_000)
  let page = first
  const { slug } = await signUpOwner(page, { spa: 'Aspen Spa', name: 'Ahmed Saleh' })
  await makeStudio(slug)
  const seed = await seedCatalog(slug)
  const db = testDb()
  await db.transaction((tx) =>
    ensureSite(tx, seed.tenantId, {
      key: 'nordic',
      name: 'Nordic Clean',
      theme: {},
      pages: [{ slug: '', title: { en: 'Home', ar: 'الرئيسية' }, data: homePage }],
    }),
  )
  const [home] = await db.select().from(sitePages).where(eq(sitePages.tenantId, seed.tenantId))
  const editorUrl = `${app}/${slug}/website/editor/${home!.id}`
  const draft = async () =>
    JSON.stringify(
      (
        await db
          .select({ data: pageVersions.data })
          .from(pageVersions)
          .where(eq(pageVersions.pageId, home!.id))
          .orderBy(desc(pageVersions.createdAt))
          .limit(1)
      )[0]?.data,
    )
  const status = (p: Page) => p.getByTestId('save-status')
  const canvasOf = (p: Page) => p.frameLocator('#preview-frame').first()

  await test.step('autosave: an edit is saved about 2 s later and is there after a reload', async () => {
    await page.goto(editorUrl)
    await expect(canvasOf(page).getByRole('heading', { name: 'About our spa' })).toBeVisible({
      timeout: 30_000,
    })
    await editHeading(page, 'About our spa', 'About our calm spa')
    await expect(status(page)).toHaveText(/Unsaved changes|Saving…|Saved · just now/)
    await expect(status(page)).toHaveText('Saved · just now', { timeout: 15_000 })
    expect(await draft()).toContain('About our calm spa')
    await page.reload()
    await expect(canvasOf(page).getByRole('heading', { name: 'About our calm spa' })).toBeVisible({
      timeout: 30_000,
    })
  })

  // The second super-admin signs in up front: the first editor's lock heartbeat (30 s) must not learn about the
  // take-over before its own save is refused (last step), and a first-time admin sign-in alone can take ~20 s.
  const other = await (await browser.newContext()).newPage()
  await adminOnApp(other, `/${slug}/website`)

  await test.step('offline: changes are kept on the device and offered back after a crash', async () => {
    await page.context().setOffline(true)
    await editHeading(page, 'About our calm spa', 'About our offline spa')
    await expect(status(page)).toHaveText('Offline – changes kept locally', { timeout: 15_000 })
    expect(await draft()).not.toContain('About our offline spa')
    // The tab dies before the network comes back. Its requests are cut at the browser first: closing runs the
    // editor's hide/pagehide flush, and that last save escapes the emulated offline state while the page detaches
    // (it reached the server ~50 ms after close on a production build).
    await page.route('**/*', (r) => r.abort('internetdisconnected'))
    await page.close()
    page = await page.context().newPage()
    await page.context().setOffline(false)
    await page.goto(editorUrl)
    const banner = page.getByRole('region', { name: 'Unsaved changes found' })
    await expect(banner).toContainText('were kept on this device', { timeout: 30_000 })
    await banner.getByRole('button', { name: 'Restore' }).click()
    await expect(canvasOf(page).getByRole('heading', { name: 'About our offline spa' })).toBeVisible()
    await expect(status(page)).toHaveText('Saved · just now', { timeout: 15_000 })
    expect(await draft()).toContain('About our offline spa')
  })

  await test.step('a second super-admin sees who is editing (view only) and takes over', async () => {
    await other.goto(editorUrl)
    const lock = other.getByRole('region', { name: 'Editing lock' })
    await expect(lock).toContainText('Ahmed Saleh is editing this page — view only', { timeout: 30_000 })
    await expect(status(other)).toHaveText('View only')
    await expect(other.getByRole('button', { name: 'Save draft' })).toBeDisabled()
    await expect(other.getByRole('button', { name: 'Publish', exact: true })).toHaveCount(0)
    // Taking over reloads the editor (window.location.reload): an edit typed before that load would be wiped.
    const reloaded = other.waitForEvent('load')
    await lock.getByRole('button', { name: 'Take over' }).click()
    await reloaded
    await expect(other.getByRole('region', { name: 'Editing lock' })).toHaveCount(0, { timeout: 30_000 })
    await expect(other.getByRole('button', { name: 'Save draft' })).toBeEnabled()
    await expect
      .poll(async () =>
        (
          await db
            .select({ data: auditLog.data })
            .from(auditLog)
            .where(
              and(eq(auditLog.tenantId, seed.tenantId), eq(auditLog.action, 'site.page.lock_taken_over')),
            )
        ).map((r) => (r.data as { from?: string }).from),
      )
      .toEqual(['Ahmed Saleh'])
    await editHeading(other, 'About our offline spa', 'About us, by the studio')
    await expect(status(other)).toHaveText('Saved · just now', { timeout: 15_000 })
  })

  await test.step('the first editor loses the lock: its save is refused and it turns view only', async () => {
    await editHeading(page, 'About our offline spa', 'Ahmed was here')
    const lock = page.getByRole('region', { name: 'Editing lock' })
    await expect(lock).toContainText('Platform Admin took over editing this page', { timeout: 15_000 })
    await expect(status(page)).toHaveText('View only')
    const saved = await draft()
    expect(saved).toContain('About us, by the studio')
    expect(saved).not.toContain('Ahmed was here')
  })
})
