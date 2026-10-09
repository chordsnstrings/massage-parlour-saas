import { emailDomain, resolveEmailConfig, turnstileStatusText } from '@spa/core'
import { platformDb, platformSettings } from '@spa/db'
import { emailSettingsStatus, turnstileSettingsStatus } from '@spa/services'
import { eq } from 'drizzle-orm'
import type { Metadata } from 'next'
import { Badge } from '@/components/ui/badge'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { Checkbox, Input, Textarea } from '@/components/ui/input'
import { PageBody, PageHeader } from '@/components/ui/page'
import { requirePlatformAdmin } from '@/server/access'
import { registerEmailSettings } from '@/server/email-settings'
import { currentTurnstile } from '@/server/turnstile'
import {
  saveCompanyAction,
  saveEmailSettingsAction,
  saveTurnstileSettingsAction,
  sendTestEmailAction,
} from '../actions'
import { SuperAdminsCard } from './super-admins-card'

export const metadata: Metadata = { title: 'Company' }

export default async function CompanyPage() {
  const { user } = await requirePlatformAdmin()
  const s = await platformDb().query.platformSettings.findFirst({ where: eq(platformSettings.id, 1) })
  registerEmailSettings()
  const mail = await emailSettingsStatus(platformDb())
  const eff = await resolveEmailConfig()
  const [bot, botSaved] = await Promise.all([currentTurnstile(), turnstileSettingsStatus(platformDb())])
  const v = (k: keyof NonNullable<typeof s>) => (s?.[k] as string | null | undefined) ?? ''
  const text = (name: keyof NonNullable<typeof s>, label: string, hint?: string, cls?: string) => (
    <Field label={label} name={name} hint={hint} className={cls}>
      <Input id={name} name={name} defaultValue={v(name)} />
    </Field>
  )
  return (
    <>
      <PageHeader
        title="Company"
        description="Your operating company — shown on invoices, the billing page and in Meta/Google applications."
      />
      <PageBody>
        <Card data-testid="email-settings">
          <CardHeader
            title="Email (Resend)"
            description="Staff email: invites, password resets, verification, alerts. Values saved here win over RESEND_API_KEY / EMAIL_FROM in the server env. Without a key, production refuses to send (sign-up verification and password reset fail)."
            action={
              <Badge tone={eff.apiKey ? 'success' : 'danger'}>
                {eff.keySource === 'console'
                  ? 'key from console'
                  : eff.keySource === 'env'
                    ? 'key from env'
                    : 'key missing'}
              </Badge>
            }
          />
          <CardBody className="space-y-5">
            <ActionForm action={saveEmailSettingsAction} className="grid gap-5 sm:grid-cols-2">
              <Field
                label="Resend API key"
                name="apiKey"
                hint={
                  mail.hasKey
                    ? `Set ✓ (…${mail.keyLast4 ?? '????'}). Leave blank to keep it.`
                    : eff.keySource === 'env'
                      ? 'Not set here; the server env key is used.'
                      : 'Not set. Create one in Resend → API Keys (sending access).'
                }
              >
                <Input id="apiKey" name="apiKey" type="password" autoComplete="off" placeholder="re_…" />
              </Field>
              <Field
                label="From address"
                name="emailFrom"
                hint={`Blank = env / default. Sending now as ${eff.from} (domain ${emailDomain(eff.from) ?? '?'}, must be verified in Resend).`}
              >
                <Input
                  id="emailFrom"
                  name="emailFrom"
                  defaultValue={mail.from ?? ''}
                  placeholder="spamanagement.co <ask@spamanagement.co>"
                />
              </Field>
              {mail.hasKey && (
                <label className="flex items-center gap-2.5 text-sm sm:col-span-2">
                  <Checkbox name="clearKey" /> Remove the stored key (fall back to env)
                </label>
              )}
              <div className="sm:col-span-2">
                <SubmitButton>Save email settings</SubmitButton>
              </div>
            </ActionForm>
            <ActionForm action={sendTestEmailAction} className="border-t pt-5">
              <SubmitButton variant="secondary">Send test email to me</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
        <Card data-testid="turnstile-settings">
          <CardHeader
            title="Bot check (Cloudflare Turnstile)"
            description="Protects online booking, the booking widget, Apply and Contact. Values saved here win over TURNSTILE_SITE_KEY / TURNSTILE_SECRET_KEY / TURNSTILE_CUSTOM_DOMAINS in the server env. Both keys come from the same widget (Cloudflare → Turnstile). Without both, the forms have no bot check (honeypot + rate limits only)."
            action={
              <Badge tone={bot.config ? 'success' : 'danger'}>
                {bot.config ? turnstileStatusText(bot).split(' · ')[0] : turnstileStatusText(bot)}
              </Badge>
            }
          />
          <CardBody>
            <ActionForm action={saveTurnstileSettingsAction} className="grid gap-5 sm:grid-cols-2">
              <Field
                label="Site key"
                name="siteKey"
                hint={
                  botSaved.siteKey
                    ? 'Public: it is sent to visitors with the widget. Blank = use env.'
                    : bot.siteKeySource === 'env'
                      ? 'Not set here; the server env key is used.'
                      : 'Not set. Cloudflare → Turnstile → Add widget (Managed).'
                }
              >
                <Input
                  id="siteKey"
                  name="siteKey"
                  autoComplete="off"
                  defaultValue={botSaved.siteKey ?? ''}
                  placeholder="0x4AAAA…"
                />
              </Field>
              <Field
                label="Secret key"
                name="secretKey"
                hint={
                  botSaved.hasSecret
                    ? `Set ✓ (…${botSaved.secretLast4 ?? '????'}). Leave blank to keep it.`
                    : bot.secretKeySource === 'env'
                      ? 'Not set here; the server env key is used.'
                      : 'Not set. Shown once in Cloudflare next to the site key.'
                }
              >
                <Input
                  id="secretKey"
                  name="secretKey"
                  type="password"
                  autoComplete="off"
                  placeholder="0x4AAAA…"
                />
              </Field>
              <label className="flex items-start gap-2.5 text-sm sm:col-span-2">
                <Checkbox name="customDomains" defaultChecked={bot.customDomains} className="mt-0.5" />
                <span>
                  Also check spa custom domains
                  <span className="block text-muted">
                    Add each custom domain to the widget&apos;s hostnames in Cloudflare first, or bookings
                    there are refused. Off = custom domains have no bot check.
                    {bot.customDomainsSource === 'env'
                      ? ' Currently from env (TURNSTILE_CUSTOM_DOMAINS).'
                      : ''}
                  </span>
                </span>
              </label>
              {(botSaved.siteKey || botSaved.hasSecret || botSaved.customDomains !== null) && (
                <label className="flex items-center gap-2.5 text-sm sm:col-span-2">
                  <Checkbox name="clearKeys" /> Remove the stored keys and switch (fall back to env)
                </label>
              )}
              <div className="sm:col-span-2">
                <SubmitButton>Save bot check</SubmitButton>
              </div>
            </ActionForm>
          </CardBody>
        </Card>
        <SuperAdminsCard meId={user.id} />
        <ActionForm action={saveCompanyAction} className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader title="Company" />
            <CardBody className="grid gap-5 sm:grid-cols-2">
              {text('companyName', 'Brand name', undefined, 'sm:col-span-2')}
              {text('legalName', 'Legal name')}
              {text('tradeLicence', 'Trade licence no.')}
              {text('trn', 'TRN', '15-digit VAT number')}
              {text('website', 'Website')}
              <Field label="Address" name="address" className="sm:col-span-2">
                <Textarea id="address" name="address" defaultValue={v('address')} />
              </Field>
            </CardBody>
          </Card>
          <div className="space-y-6">
            <Card>
              <CardHeader title="Contact" />
              <CardBody className="grid gap-5 sm:grid-cols-3">
                {text('email', 'Email')}
                {text('phone', 'Phone')}
                {text('whatsapp', 'WhatsApp', 'Shown to spas for billing questions')}
              </CardBody>
            </Card>
            <Card>
              <CardHeader
                title="Bank & invoicing"
                description="Spas see these details on their subscription page."
              />
              <CardBody className="grid gap-5 sm:grid-cols-2">
                {text('bankName', 'Bank')}
                {text('bankAccountName', 'Account name')}
                {text('iban', 'IBAN')}
                {text('swift', 'SWIFT')}
                {text('invoicePrefix', 'Invoice prefix', 'e.g. SM → SM-2026-0001')}
                <Field label="VAT rate (%)" name="vatRate">
                  <Input id="vatRate" name="vatRate" inputMode="decimal" defaultValue={s?.vatRate ?? '5'} />
                </Field>
                <Field
                  label="Domain markup (USD)"
                  name="domainMarkupUsd"
                  hint="Added once to every domain order on top of the registrar price."
                >
                  <Input
                    id="domainMarkupUsd"
                    name="domainMarkupUsd"
                    inputMode="decimal"
                    defaultValue={s?.domainMarkupUsd ?? '10'}
                  />
                </Field>
                <label className="flex items-center gap-2.5 text-sm sm:col-span-2">
                  <Checkbox name="pricesIncludeVat" defaultChecked={s?.pricesIncludeVat ?? false} /> Plan
                  prices already include VAT
                </label>
              </CardBody>
            </Card>
            <Card>
              <CardHeader
                title="Data retention"
                description="Permanently delete spas some time after they were deleted (G12). Blank = off; purge by hand from the spa's page."
              />
              <CardBody>
                <Field
                  label="Auto-purge deleted spas after (days)"
                  name="autoPurgeDays"
                  hint="At least 30 days, so the spa can still get its data export. Runs daily at 04:30."
                >
                  <Input
                    id="autoPurgeDays"
                    name="autoPurgeDays"
                    inputMode="numeric"
                    placeholder="Off"
                    defaultValue={s?.autoPurgeDays ?? ''}
                  />
                </Field>
              </CardBody>
            </Card>
          </div>
          <div className="flex justify-end xl:col-span-2">
            <SubmitButton size="lg">Save company details</SubmitButton>
          </div>
        </ActionForm>
      </PageBody>
    </>
  )
}
