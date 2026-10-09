import { expect, type Page, test } from '@playwright/test'
import { en, th } from '@spa/core/i18n'
import { app, base } from './helpers'

// Marketing: the Spa CRM page (docs/PLAN.md §18.5) — EN/TH demo uses the dashboard's real catalogue strings.
test('the Spa CRM page sells the dashboard in English and Thai', async ({ page }) => {
  await page.goto(`${base}/crm`)
  await expect(page).toHaveTitle(/Spa CRM/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('The dashboard your whole team uses.')

  await test.step('CTAs point at the application and pricing', async () => {
    const hero = page.locator('.mkt-hero')
    await expect(hero.getByRole('link', { name: 'Apply for your spa' })).toHaveAttribute(
      'href',
      `${app}/signup`,
    )
    await hero.getByRole('link', { name: 'See pricing' }).click()
    await expect(page).toHaveURL(`${base}/pricing`)
    await page.goBack()
  })

  await test.step('the language toggle switches labels to the Thai catalogue; typed names stay', async () => {
    const demo = page.getByTestId('crm-demo')
    await expect(demo).toHaveAttribute('lang', 'en')
    await expect(demo.getByText(en.nav.calendar, { exact: true })).toBeVisible()
    await expect(demo.getByText(en.sales.checkout.total, { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true')

    await page.getByRole('button', { name: 'ภาษาไทย' }).click()
    await expect(page.getByRole('button', { name: 'ภาษาไทย' })).toHaveAttribute('aria-pressed', 'true')
    await expect(demo).toHaveAttribute('lang', 'th')
    await expect(demo.getByText(th.nav.calendar, { exact: true })).toBeVisible()
    await expect(demo.getByText(th.overview.upNext.title, { exact: true })).toBeVisible()
    await expect(demo.getByText(th.sales.checkout.total, { exact: true })).toBeVisible()
    await expect(demo.getByText(en.nav.calendar, { exact: true })).toHaveCount(0)
    await expect(demo.getByText('Layla', { exact: true })).toBeVisible()
    await expect(demo.getByText(th.overview.upNext.walkIn, { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'English' }).click()
    await expect(demo.getByText(en.nav.calendar, { exact: true })).toBeVisible()
  })

  await test.step('home and features link to the CRM page', async () => {
    for (const path of ['/', '/features']) {
      await page.goto(`${base}${path}`)
      const link = page.locator('main a[href="/crm"]').first()
      await expect(link).toBeVisible()
    }
    await page.locator('main a[href="/crm"]').first().click()
    await expect(page).toHaveURL(`${base}/crm`)
  })
})

// Home: the Spa CRM showcase (PLAN §18.8) — 3D dashboard + floating feature cards, flat under reduced motion.
const dashTransform = (page: Page) =>
  page.locator('[data-show="dash"]').evaluate((el) => getComputedStyle(el).transform)
const flat = (tf: string) => tf === 'none' || tf === 'matrix(1, 0, 0, 1, 0, 0)'
/** Scroll so the dashboard's cover progress (as `view()`) is `p`; instant, the page scrolls smoothly otherwise. */
const scrollToCover = (page: Page, p: number) =>
  page.locator('.mkt-show-dwrap').evaluate((el: HTMLElement, p) => {
    let top = 0
    for (let n: HTMLElement | null = el; n; n = n.offsetParent as HTMLElement | null) top += n.offsetTop
    window.scrollTo({ top: top - innerHeight + p * (innerHeight + el.offsetHeight), behavior: 'instant' })
    return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  }, p)

test('home: the Spa CRM showcase straightens in 3D and links to /crm and the application', async ({
  page,
}) => {
  await page.goto(`${base}/`)
  const show = page.getByTestId('crm-showcase')
  await expect(show.getByRole('heading', { level: 2 })).toHaveText('Run the whole spa from one dashboard.')

  await test.step('the dashboard mock and four feature cards use the real catalogue strings', async () => {
    const demo = show.getByTestId('crm-demo')
    await expect(demo).toHaveAttribute('lang', 'en')
    await expect(demo.getByText(en.overview.kpi.revenue, { exact: true })).toBeVisible()
    await expect(show.getByTestId('crm-showcase-card')).toHaveCount(4)
    for (const text of [
      en.errors.domain.timeClashes,
      en.sales.invoice.title,
      en.messages.card.open,
      en.overview.therapist.earnings.title,
    ])
      await expect(show.getByText(text, { exact: true })).toBeVisible()
    await show.getByRole('button', { name: 'ภาษาไทย' }).click()
    await expect(demo).toHaveAttribute('lang', 'th')
    await expect(show.getByText(th.overview.therapist.earnings.title, { exact: true })).toBeVisible()
    await expect(show.getByText(th.messages.card.open, { exact: true })).toBeVisible()
    await expect(demo.getByText('Layla', { exact: true })).toBeVisible()
    await show.getByRole('button', { name: 'English' }).click()
  })

  await test.step('tilted while it scrolls in, flat once in view', async () => {
    await scrollToCover(page, 0.1)
    expect(flat(await dashTransform(page))).toBe(false)
    await scrollToCover(page, 0.55)
    expect(flat(await dashTransform(page))).toBe(true)
  })

  await test.step('CTAs: the Spa CRM page and the application', async () => {
    await expect(show.getByRole('link', { name: 'Apply for your spa' })).toHaveAttribute(
      'href',
      `${app}/signup`,
    )
    await show.getByRole('link', { name: 'See the Spa CRM' }).click()
    await expect(page).toHaveURL(`${base}/crm`)
  })
})

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })
  test('home: the Spa CRM showcase is static and flat', async ({ page }) => {
    await page.goto(`${base}/`)
    await expect(page.getByTestId('crm-showcase')).toBeVisible()
    await scrollToCover(page, 0.1)
    expect(flat(await dashTransform(page))).toBe(true)
    const cards = page.getByTestId('crm-showcase-card')
    for (const i of [0, 1, 2, 3]) {
      const { transform, opacity } = await cards.nth(i).evaluate((el) => ({
        transform: getComputedStyle(el).transform,
        opacity: getComputedStyle(el).opacity,
      }))
      expect(flat(transform)).toBe(true)
      expect(opacity).toBe('1')
    }
  })
})
