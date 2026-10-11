import type { Permission } from '@spa/core'
import { platformDb, type SiteAiEditorStatus, siteAiEditorStatus } from '@spa/db'
import { studioGuard } from '@/server/access'
import { aiFixturesOn } from '@/server/ai-fixture'

/*
 * Prompt site editing (Studio Ask AI, R23 Write texts; Claude MCP has the same rule in /api/mcp): only
 * SITE_AI_EDITOR_EMAILS super-admins with a verified email and 2FA, re-checked on every action.
 */

export const NOT_ENABLED: Record<Exclude<SiteAiEditorStatus, 'ok'>, string> = {
  not_listed: 'AI site editing isn’t enabled for your account.',
  not_admin: 'AI site editing needs a super-admin account.',
  needs2fa: 'Turn on two-factor authentication to use AI site editing.',
}

/** ModelArk is set up (or the e2e AI fixtures answer). */
export const aiEditReady = () => Boolean(process.env.ARK_API_KEY) || aiFixturesOn()

/** studioGuard + the SITE_AI_EDITOR_EMAILS allow-list (fresh read, so removing an email takes effect at once). */
export async function siteAiGuard(slug: string, perm: Permission = 'site.content') {
  const { ctx, error } = await studioGuard(slug, perm)
  if (error) return { ctx, error }
  const status = await siteAiEditorStatus(platformDb(), ctx.user.id)
  return { ctx, error: status === 'ok' ? null : NOT_ENABLED[status] }
}
