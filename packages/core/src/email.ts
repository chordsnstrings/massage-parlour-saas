/** Platform brand + domain (docs/PLAN.md §14.7 B1). */
export const PLATFORM_NAME = 'spamanagement.co'
/** Public contact address (marketing Contact page, PLAN §18.4); the console's company email wins when set. */
export const PLATFORM_CONTACT_EMAIL = 'ask@spamanagement.co'
/**
 * Default staff-email sender (owner 2026-10-09: the only spamanagement.co address anywhere is ask@). Resend delivers
 * only once spamanagement.co is verified there; EMAIL_FROM or the console's From address replace it.
 */
export const EMAIL_DOMAIN = 'spamanagement.co'
export const DEFAULT_EMAIL_FROM = `${PLATFORM_NAME} <${PLATFORM_CONTACT_EMAIL}>`

/** Email settings saved in the super-admin console (platform_settings); either field may be unset. */
export type EmailSettings = { apiKey?: string | null; from?: string | null }
export type EmailKeySource = 'console' | 'env' | 'missing'
export type ResolvedEmail = {
  apiKey: string | null
  from: string
  keySource: EmailKeySource
  fromSource: EmailKeySource
}
/** `replyTo`: e.g. a contact enquiry's sender, so the owner can answer from the notification. */
export type StaffEmail = { to: string; subject: string; text: string; replyTo?: string }
/** Sends one resolved message; the default posts to Resend. Overridable for e2e (never set in deploy env). */
export type EmailTransport = (m: StaffEmail & { from: string; apiKey: string }) => Promise<void>

// One registry per process on globalThis: Next bundles instrumentation and routes separately, so module state alone
// would not be shared between the place that registers the source and the code that sends.
type Registry = { source?: () => Promise<EmailSettings | null>; transport?: EmailTransport | null }
const registry = (): Registry => {
  const g = globalThis as { __spaEmail?: Registry }
  g.__spaEmail ??= {}
  return g.__spaEmail
}

/** Registers where console-saved settings come from (web instrumentation + worker start; DB read, cached there). */
export function setEmailSettingsSource(source: (() => Promise<EmailSettings | null>) | undefined) {
  registry().source = source
}
export function setEmailTransport(transport: EmailTransport | null) {
  registry().transport = transport
}

/** Console value first, then env (RESEND_API_KEY / EMAIL_FROM), then the default sender. Never throws. */
export async function resolveEmailConfig(
  env: Record<string, string | undefined> = process.env,
): Promise<ResolvedEmail> {
  let saved: EmailSettings | null = null
  try {
    saved = (await registry().source?.()) ?? null
  } catch (e) {
    console.error(`[email] console email settings unreadable, using env: ${String(e)}`)
  }
  const pick = (db: string | null | undefined, envValue: string | undefined) =>
    db?.trim()
      ? { value: db.trim(), source: 'console' as const }
      : envValue?.trim()
        ? { value: envValue.trim(), source: 'env' as const }
        : { value: null, source: 'missing' as const }
  const key = pick(saved?.apiKey, env.RESEND_API_KEY)
  const from = pick(saved?.from, env.EMAIL_FROM)
  return {
    apiKey: key.value,
    keySource: key.source,
    from: from.value ?? DEFAULT_EMAIL_FROM,
    fromSource: from.source,
  }
}

/** The domain part of a From header (`Name <a@b.co>` or `a@b.co`). */
export function emailDomain(from: string): string | null {
  // Same as /@([^\s>]+)>?\s*$/ but linear (that regex rescans the tail from every "@"): the last token, one ">" off.
  let s = from.trimEnd()
  if (s.endsWith('>')) s = s.slice(0, -1)
  const token = s.split(/[\s>]/).at(-1) ?? ''
  const at = token.indexOf('@')
  return at >= 0 && at < token.length - 1 ? token.slice(at + 1).toLowerCase() : null
}

async function resend(m: StaffEmail & { from: string; apiKey: string }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${m.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: m.from,
      to: m.to,
      subject: m.subject,
      text: m.text,
      ...(m.replyTo ? { reply_to: m.replyTo } : {}),
    }),
  })
  if (!res.ok) throw new Error(`email send failed: ${res.status} ${await res.text()}`)
}

/** Staff/owner email only (invites, password reset) — customers are contacted via WhatsApp. */
export async function sendStaffEmail(msg: StaffEmail): Promise<void> {
  const { apiKey, from } = await resolveEmailConfig()
  if (!apiKey) {
    // G2/G9: in production a missing key must never put sign-in links in the logs — fail loudly instead.
    if (process.env.NODE_ENV === 'production') {
      console.error(`[email] RESEND_API_KEY is not set; not sent: to=${msg.to} subject="${msg.subject}"`)
      throw new Error('email is not configured (RESEND_API_KEY missing)')
    }
    console.info(`[email:dev] to=${msg.to} subject="${msg.subject}"\n${msg.text}`)
    return
  }
  await (registry().transport ?? resend)({ ...msg, from, apiKey })
}
