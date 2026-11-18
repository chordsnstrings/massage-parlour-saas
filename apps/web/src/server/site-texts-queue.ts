// R28 P5 (owner D5): Write texts after a template apply / upgrade. The action queues it on `sites.text_run` in the
// switch's own transaction (services `queueSiteTexts`); right after the response, `after()` runs it here (the worker's
// site-texts-queue sweeps what this process doesn't finish). Drafts only, same gate as the console's Write texts.
import { runQueuedSiteTexts } from '@spa/ai'
import { platformDb, siteAiEditorStatus } from '@spa/db'
import { after } from 'next/server'
import { fixtureClient } from '@/server/ai-fixture'
import { aiEditReady } from '@/server/site-ai-gate'

export const SITE_TEXTS_NEEDS_GATE = 'needs SITE_AI_EDITOR_EMAILS + 2FA'
export const SITE_TEXTS_NOT_SET_UP = 'AI writing isn’t set up'

/** Whether this super-admin's apply / roll-out queues Write texts; else why not (console English). */
export async function siteTextsGate(userId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  if ((await siteAiEditorStatus(platformDb(), userId)) !== 'ok')
    return { ok: false, reason: SITE_TEXTS_NEEDS_GATE }
  if (!aiEditReady()) return { ok: false, reason: SITE_TEXTS_NOT_SET_UP }
  return { ok: true }
}

/** Runs the queued Write texts of these spas after the response, one after another (errors logged). */
export function runQueuedTextsAfter(spas: { tenantId: string; slug: string }[]) {
  if (!spas.length) return
  after(async () => {
    for (const s of spas)
      await runQueuedSiteTexts(s.tenantId, { client: fixtureClient(s.slug) }).catch((e) => {
        console.error('[site.ai_texts] queued run', e)
      })
  })
}
