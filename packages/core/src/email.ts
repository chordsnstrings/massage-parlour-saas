/** Platform brand + domain (docs/PLAN.md §14.7 B1); the old spamanagement.ae keeps working via EXTRA_ROOT_DOMAINS. */
export const PLATFORM_NAME = 'spamanagement.co'
/**
 * B1 decision (PLAN §14.8): staff emails keep sending from spamanagement.ae until spamanagement.co is verified in
 * Resend; then set EMAIL_FROM (and change this default).
 */
export const EMAIL_DOMAIN = 'spamanagement.ae'
export const DEFAULT_EMAIL_FROM = `${EMAIL_DOMAIN} <no-reply@${EMAIL_DOMAIN}>`

/** Staff/owner email only (invites, password reset) — customers are contacted via WhatsApp. */
export async function sendStaffEmail(msg: { to: string; subject: string; text: string }): Promise<void> {
  const key = process.env.RESEND_API_KEY
  if (!key) {
    // G2/G9: in production a missing key must never put sign-in links in the logs — fail loudly instead.
    if (process.env.NODE_ENV === 'production') {
      console.error(`[email] RESEND_API_KEY is not set; not sent: to=${msg.to} subject="${msg.subject}"`)
      throw new Error('email is not configured (RESEND_API_KEY missing)')
    }
    console.info(`[email:dev] to=${msg.to} subject="${msg.subject}"\n${msg.text}`)
    return
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || DEFAULT_EMAIL_FROM,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
    }),
  })
  if (!res.ok) throw new Error(`email send failed: ${res.status} ${await res.text()}`)
}
