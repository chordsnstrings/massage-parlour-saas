import { revalidatePath } from 'next/cache'
import { adminUrl } from '@/server/origin'

// R23 Website Studio in the console (admin host): every spa's website is built and published at
// /websites/{slug}; its pages open full screen at /websites/{slug}/editor/{pageId}. Paths: lib/paths.ts `studioPath`.

/**
 * Absolute console URL of a spa's website page on the visitor's platform domain (old CRM studio links forward here).
 * Built from the DB slug and validated ids only, so it can't become an open redirect.
 */
export const studioUrl = (slug: string, rest = '') => adminUrl(`/websites/${slug}${rest}`)

/** After a studio write: the console Websites list + spa page and the spa's own Website page. */
export function revalidateStudio(slug: string) {
  revalidatePath(`/platform/websites/${slug}`, 'layout')
  revalidatePath('/platform/websites')
  revalidatePath(`/dashboard/${slug}/website`, 'layout')
}
