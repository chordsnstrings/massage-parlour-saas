import { siteIcon } from '@/server/site-icon'

export const dynamic = 'force-dynamic'

/** A spa host's /apple-touch-icon.png → its logo (server/site-icon.ts); 404 elsewhere. */
export const GET = siteIcon
