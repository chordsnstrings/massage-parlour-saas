import { aiModelConfig, brandProfiles, platformDb, withTenant } from '@spa/db'
import type { SiteCopy } from '@spa/services'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

/** AI site writer (PLAN §11.6 P3): hero, about, USPs, FAQs and CTA in EN + AR from the spa's own facts. */
const AGENT = 'site_generator'

const bi = (max: number) =>
  z.object({ en: z.string().trim().min(1).max(max), ar: z.string().trim().min(1).max(max) })

export const SiteCopySchema = z.object({
  hero: z.object({ headline: bi(90), sub: bi(240) }),
  about: bi(900),
  usps: z.array(z.object({ title: bi(60), text: bi(200) })).length(3),
  faqs: z.array(z.object({ q: bi(140), a: bi(400) })).length(4),
  cta: z.object({ title: bi(90), text: bi(200) }),
}) satisfies z.ZodType<SiteCopy>

/** The writer needs the ModelArk key and an enabled `site_generator` model (super-admin → AI models). */
export async function siteWriterReady() {
  if (!process.env.ARK_API_KEY) return false
  const cfg = await platformDb().query.aiModelConfig.findFirst({ where: eq(aiModelConfig.agentKey, AGENT) })
  return Boolean(cfg?.enabled && cfg.kind === 'chat')
}

/** Readable message for a failed run (never the provider's raw error). */
export function writerError(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e)
  if (/ARK_API_KEY|disabled/i.test(msg))
    return 'AI writing is not set up yet. Ask your account manager to switch it on.'
  if (/budget/i.test(msg)) return 'Your monthly AI budget is used up. Ask your account manager to raise it.'
  return 'The AI service is busy — please try again in a moment.'
}

export async function writeSiteCopy(opts: {
  tenantId: string
  template: { name: string; feel: string }
  notes?: string
}): Promise<SiteCopy> {
  // Loaded on use so the website page doesn't pull the AI client into its bundle.
  const { hoursText, loadSpaContext, runChat } = await import('@spa/ai')
  const { ctx, brand } = await withTenant(opts.tenantId, async (tx) => ({
    ctx: await loadSpaContext(tx, opts.tenantId, AGENT),
    brand: (await tx.select().from(brandProfiles).where(eq(brandProfiles.tenantId, opts.tenantId)))[0],
  }))
  const menu = new Map<string, string[]>()
  for (const m of ctx.menu) {
    const label = m.nameAr ? `${m.name} / ${m.nameAr}` : m.name
    menu.set(label, [...(menu.get(label) ?? []), `${m.durationMin} min AED ${m.priceAed}`])
  }
  const services =
    [...menu].map(([name, v]) => `- ${name}: ${v.join(', ')}`).join('\n') || '- (menu not set up yet)'
  const branch = ctx.branch
  const res = await runChat({
    tenantId: opts.tenantId,
    agentKey: AGENT,
    schema: SiteCopySchema,
    temperature: 0.7,
    maxTokens: 3000,
    messages: [
      {
        role: 'system',
        content: `You write the website for ${ctx.name}, a massage spa in the UAE. Write every text in English (en) and natural Modern Standard Arabic (ar) — adapt, don't translate word for word; Latin digits are fine in Arabic.
Brand voice: ${brand?.voice ?? ctx.voice}
${brand?.dos.length ? `Always: ${brand.dos.join('; ')}\n` : ''}${brand?.donts.length ? `Never: ${brand.donts.join('; ')}\n` : ''}The site uses the "${opts.template.name}" template (${opts.template.feel}); match its mood.
Rules:
- Use only the facts given (services, prices, hours, location). Never invent awards, years, ratings, numbers of guests, offers or prices.
- No medical or therapeutic claims ("cures", "treats", "heals", "therapy for"). Talk about relaxation and comfort.
- Family-friendly and respectful; nothing suggestive. No "best in Dubai" superlatives.
- Payments are made at the spa by cash or card; prices are in AED and include VAT. Booking is online or on WhatsApp.
- Lengths: hero headline ≤ 8 words; hero sub ≤ 25 words; about = 2 short paragraphs separated by a blank line (≤ 110 words); each USP title ≤ 4 words and text ≤ 18 words; 4 practical FAQs (booking, payment, arrival, therapist preference or hours) with answers ≤ 40 words; CTA title ≤ 7 words and text ≤ 15 words.`,
      },
      {
        role: 'user',
        content: `Spa: ${ctx.name}
Location: ${branch?.address ?? 'UAE'}
Opening hours: ${hoursText(branch?.openingHours)}
WhatsApp booking: ${branch?.whatsappE164 ? 'yes' : 'no'}
Services and prices:
${services}
${opts.notes ? `Owner's notes: ${opts.notes}` : ''}`,
      },
    ],
  })
  return res.output
}
