import { crmDataHandlers, type SiteParams } from '@/server/crm-feed-routes'

export const dynamic = 'force-dynamic'

/** R26: the spa's CRM data contract for HTML designs that fetch `crm-data.json` (server/crm-feed-routes.ts). */
export const GET = (req: Request, ctx: SiteParams) => crmDataHandlers.GET(req, ctx)
export const HEAD = (req: Request, ctx: SiteParams) => crmDataHandlers.HEAD(req, ctx)
export const OPTIONS = () => crmDataHandlers.OPTIONS()
