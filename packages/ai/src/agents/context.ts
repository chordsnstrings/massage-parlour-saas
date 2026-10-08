import { dubaiParts, type OpeningHours } from '@spa/core'
import {
  aiAgentSettings,
  branches,
  brandProfiles,
  services,
  serviceVariants,
  type Tx,
  tenants,
} from '@spa/db'
import { and, asc, eq } from 'drizzle-orm'

export type SpaContext = Awaited<ReturnType<typeof loadSpaContext>>

/** Facts every agent needs about a spa (read inside withTenant). */
export async function loadSpaContext(tx: Tx, tenantId: string, agentKey: string) {
  const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId))
  const [branch] = await tx.select().from(branches).where(eq(branches.isDefault, true)).limit(1)
  const menu = await tx
    .select({
      serviceId: services.id,
      name: services.name,
      variantId: serviceVariants.id,
      durationMin: serviceVariants.durationMin,
      priceAed: serviceVariants.priceAed,
      showPrice: services.showPrice,
    })
    .from(serviceVariants)
    .innerJoin(services, eq(services.id, serviceVariants.serviceId))
    .where(
      and(eq(services.active, true), eq(services.onlineBookable, true), eq(serviceVariants.active, true)),
    )
    .orderBy(asc(services.sort), asc(serviceVariants.durationMin))
  const [brand] = await tx.select().from(brandProfiles).where(eq(brandProfiles.tenantId, tenantId))
  const [settings] = await tx
    .select()
    .from(aiAgentSettings)
    .where(and(eq(aiAgentSettings.tenantId, tenantId), eq(aiAgentSettings.agentKey, agentKey)))
  return {
    tenantId,
    name: tenant?.name ?? 'the spa',
    branch,
    menu: menu.map((m) => ({
      variantId: m.variantId,
      serviceId: m.serviceId,
      name: m.name.en,
      nameAr: m.name.ar,
      durationMin: m.durationMin,
      // Public agents never quote a hidden or missing price (R4): null = price on request.
      priceAed:
        m.priceAed != null && (m.showPrice ?? !tenant?.settings.hidePrices) ? Number(m.priceAed) : null,
    })),
    voice: brand?.voice ?? 'Warm, calm and welcoming. Short sentences. No medical claims.',
    tone: settings?.tone ?? 'warm, calm and professional',
    rules: settings?.rules ?? '',
    mode: settings?.mode ?? 'approve',
    enabled: settings?.enabled ?? false,
  }
}

export function hoursText(hours: OpeningHours | null | undefined) {
  if (!hours || !Object.keys(hours).length) return 'Daily 10:00–24:00'
  return (['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const)
    .map((d) => `${d}: ${(hours[d] ?? []).map((i) => `${i.open}–${i.close}`).join(', ') || 'closed'}`)
    .join('; ')
}

export function nowLine(now = new Date()) {
  const p = dubaiParts(now)
  return `Current date/time in Dubai: ${p.date} ${String(Math.floor(p.minutes / 60)).padStart(2, '0')}:${String(p.minutes % 60).padStart(2, '0')} (${p.weekday}).`
}

export const SAFETY = `Rules you must always follow:
- Never make medical or therapeutic claims ("cures", "treats", "heals"). Describe relaxation and comfort only.
- If a message is inappropriate, sexual or suggestive: reply with one brief, neutral, polite sentence that you can help with bookings and spa services only, do not repeat or engage with the content, and call flag_conversation.
- Never invent prices, services, times or policies — use only the facts and tool results you have.
- Mirror the customer's language (English or Arabic).`
