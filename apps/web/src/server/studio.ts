import { revalidatePath } from 'next/cache'
import { forgetHtmlDesignRoutes } from '@/server/html-design-route'
import { adminUrl } from '@/server/origin'
import { forgetSiteRedirects } from '@/server/site-redirect'

// R23 Website Studio in the console (admin host): every spa's website is built and published at
// /websites/{slug}; its pages open full screen at /websites/{slug}/editor/{pageId}. Paths: lib/paths.ts `studioPath`.

/**
 * Absolute console URL of a spa's website page on the visitor's platform domain (old CRM studio links forward here).
 * Built from the DB slug and validated ids only, so it can't become an open redirect.
 */
export const studioUrl = (slug: string, rest = '') => adminUrl(`/websites/${slug}${rest}`)

/**
 * After a studio write: the console Websites list + spa page and the spa's own Website page. R24: also the proxy's
 * "is this page an exact HTML design" answers (a publish, unpublish, restore or rename may change them); R33: and its
 * redirect rules (a page published at an old address wins; the redirect actions themselves).
 */
export function revalidateStudio(slug: string) {
  forgetHtmlDesignRoutes()
  forgetSiteRedirects()
  revalidatePath(`/platform/websites/${slug}`, 'layout')
  revalidatePath('/platform/websites')
  revalidatePath(`/dashboard/${slug}/website`, 'layout')
}
