import { crmEnquiryHandlers, type SiteParams } from '@/server/crm-feed-routes'

export const dynamic = 'force-dynamic'

/** R26: an HTML design's booking form → a website enquiry in the CRM inbox (server/crm-feed-routes.ts). */
export const POST = (req: Request, ctx: SiteParams) => crmEnquiryHandlers.POST(req, ctx)
export const OPTIONS = () => crmEnquiryHandlers.OPTIONS()
