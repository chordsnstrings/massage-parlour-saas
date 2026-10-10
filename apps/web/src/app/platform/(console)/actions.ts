'use server'
import { FEATURE_TIERS, PLAN_CODES, sendStaffEmail, tierLimits } from '@spa/core'
import { aiModelConfig, plans, platformDb, platformSettings, subscriptions, tenants } from '@spa/db'
import {
  billingTransitionEffects,
  createPaymentReminder,
  createPlatformInvoice,
  DomainError,
  deleteTenant,
  encryptSecret,
  generateBillingSchedule,
  isLegacyPlan,
  MIN_AUTO_PURGE_DAYS,
  markListedAdminVerified,
  pauseTenant,
  purgeTenant,
  recordPlatformPayment,
  resumeTenant,
  saveEmailSettings,
  saveTurnstileSettings,
  setFeatureTier,
  setInvoicePaid,
  setSubscriptionDiscounts,
  switchPlan,
} from '@spa/services'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { type ActionResult, fail, formObject, fromZod, ok } from '@/lib/action'
import { adminPath } from '@/lib/paths'
import { todayDubai } from '@/lib/utils'
import { requirePlatformAdmin } from '@/server/access'
import { audit } from '@/server/audit'
import { discountsFromForm } from '@/server/discounts'
import { invalidateEmailSettings, registerEmailSettings } from '@/server/email-settings'
import { canonicalUrls } from '@/server/origin'
import { invalidateTurnstileSettings } from '@/server/turnstile'

const money = z.coerce
  .number({ error: 'Enter an amount' })
  .min(0, 'Must be 0 or more')
  .transform((n) => n.toFixed(2))
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date')
const text = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || null)
const bool = z.preprocess((v) => v === 'on' || v === 'true', z.boolean())

async function admin() {
  return (await requirePlatformAdmin()).user
}

export async function updateSubscriptionAction(
  tenantId: string,
  _p: ActionResult,
  fd: FormData,
): Promise<ActionResult> {
  const user = await admin()
  const parsed = z
    .object({
      planId: z.uuid(),
      status: z.enum(['trialing', 'active', 'past_due', 'cancelled']),
      priceAed: money,
      setupFeeAed: money,
      billingInterval: z.enum(['year', 'month']),
      currentPeriodStart: date,
      currentPeriodEnd: date,
      notes: text(1000),
    })
    .safeParse(formObject(fd))
  if (!parsed.success) return fromZod(parsed.error)
  const d = parsed.data
  if (d.currentPeriodEnd < d.currentPeriodStart)
    return fail('End must be after start.', { currentPeriodEnd: 'End must be after start' })
  // PLAN §18.8: the plan itself changes only through "Switch plan" (legacy yearly kept until renewal); a new
  // subscription can't start on the legacy plan.
  const [current, target] = await Promise.all([
    platformDb().query.subscriptions.findFirst({ where: eq(subscriptions.tenantId, tenantId) }),
    platformDb().query.plans.findFirst({ where: eq(plans.id, d.planId) }),
  ])
  if (current && current.planId !== d.planId)
    return fail('Change the plan with “Switch plan” under Plan & features.', {
      planId: 'Use Switch plan',
    })
  if (!current && isLegacyPlan(target))
    return fail('The legacy yearly plan is kept for existing spas only.', { planId: 'Choose another plan' })
  await platformDb()
    .insert(subscriptions)
    .values({ tenantId, ...d })
    .onConflictDoUpdate({ target: subscriptions.tenantId, set: d })
  await platformDb().update(tenants).set({ planId: d.planId }).where(eq(tenants.id, tenantId))
  await audit({ tenantId, actorUserId: user.id, action: 'platform.subscription.updated', data: d })
  revalidatePath(`/platform/tenants/${tenantId}`)
  return ok('Subscription saved')
}

const revalidateSpa = (tenantId: string) => revalidatePath(`/platform/tenants/${tenantId}`)

/** PLAN §18.8: move the spa to Premium / Standard (legacy yearly: only at its renewal). Audited from → to. */
export async function switchPlanAction(
  tenantId: string,
  _p: ActionResult,
  fd: FormData,
): Promise<ActionResult> {
  const user = await admin()
  const parsed = z.object({ planId: z.uuid('Choose a plan'), reissue: bool }).safeParse(formObject(fd))
  if (!parsed.success) return fromZod(parsed.error)
  let res: Awaited<ReturnType<typeof switchPlan>>
  try {
    res = await switchPlan(platformDb(), { tenantId, ...parsed.data, today: todayDubai() })
  } catch (e) {
    if (e instanceof DomainError) return fail(e.message, { planId: e.message })
    throw e
  }
  await audit({
    tenantId,
    actorUserId: user.id,
    action: 'platform.subscription.plan_switched',
    data: { from: res.from, to: res.to, renewal: res.renewal, reissued: res.reissued },
  })
  revalidateSpa(tenantId)
  return ok(
    `Plan switched to ${res.to.name}${res.renewal ? ` from ${res.to.period.split('..')[0]}` : ''}${
      res.reissued?.voided ? ` · ${res.reissued.voided} unpaid invoice(s) re-issued` : ''
    }.${res.renewal ? ' Use “Generate payment schedule” to issue the new period’s invoices.' : ''}`,
  )
}

/** PLAN §18.8: per-spa discounts on the setup fee and / or the monthly fee. Audited from → to. */
export async function saveDiscountsAction(
  tenantId: string,
  _p: ActionResult,
  fd: FormData,
): Promise<ActionResult> {
  const user = await admin()
  const parsed = discountsFromForm(fd)
  if (!parsed.ok) return fail(parsed.error, parsed.fieldErrors)
  const reissue = fd.get('reissue') === 'on'
  let res: Awaited<ReturnType<typeof setSubscriptionDiscounts>>
  try {
    res = await setSubscriptionDiscounts(platformDb(), {
      tenantId,
      discounts: parsed.discounts,
      today: todayDubai(),
      reissue,
    })
  } catch (e) {
    if (e instanceof DomainError) return fail(e.message)
    throw e
  }
  await audit({
    tenantId,
    actorUserId: user.id,
    action: 'platform.subscription.discounts',
    data: { from: res.from, to: res.to, reissued: res.reissued },
  })
  revalidateSpa(tenantId)
  return ok(
    `Discounts saved${res.reissued?.voided ? ` · ${res.reissued.voided} unpaid invoice(s) re-issued` : ''}`,
  )
}

/** PLAN §18.8: feature-tier override ("Grant Premium features" while billed at Standard). Audited from → to. */
export async function setFeatureTierAction(
  tenantId: string,
  _p: ActionResult,
  fd: FormData,
): Promise<ActionResult> {
  const user = await admin()
  const parsed = z.object({ tier: z.enum(['plan', 'premium', 'standard']) }).safeParse(formObject(fd))
  if (!parsed.success) return fromZod(parsed.error)
  const tier = parsed.data.tier === 'plan' ? null : parsed.data.tier
  let res: Awaited<ReturnType<typeof setFeatureTier>>
  try {
    res = await setFeatureTier(platformDb(), tenantId, tier)
  } catch (e) {
    if (e instanceof DomainError) return fail(e.message)
    throw e
  }
  await audit({ tenantId, actorUserId: user.id, action: 'platform.tenant.feature_tier', data: res })
  revalidateSpa(tenantId)
  return ok(
    tier === null
      ? 'Features follow the plan'
      : tier === 'premium'
        ? 'Premium features granted'
        : 'Standard features only',
  )
}

export async function setTenantStatusAction(
  tenantId: string,
  _p: ActionResult,
  fd: FormData,
): Promise<ActionResult> {
  const user = await admin()
  const parsed = z
    .object({ status: z.enum(['trial', 'active', 'past_due', 'read_only', 'suspended', 'cancelled']) })
    .safeParse(formObject(fd))
  if (!parsed.success) return fromZod(parsed.error)
  await platformDb().update(tenants).set({ status: parsed.data.status }).where(eq(tenants.id, tenantId))
  await audit({ tenantId, actorUserId: user.id, action: 'platform.tenant.status', data: parsed.data })
  revalidatePath(`/platform/tenants/${tenantId}`)
  return ok('Status updated')
}

export async function createInvoiceAction(
  tenantId: string,
  _p: ActionResult,
  fd: FormData,
): Promise<ActionResult> {
  const user = await admin()
  const parsed = z
    .object({
      description: z.string().trim().min(2, 'Describe the invoice').max(200),
      amountAed: money,
      issueDate: date,
      dueDate: date,
    })
    .safeParse(formObject(fd))
  if (!parsed.success) return fromZod(parsed.error)
  const d = parsed.data
  const row = await createPlatformInvoice(platformDb(), tenantId, d)
  const number = row?.number
  await audit({ tenantId, actorUserId: user.id, action: 'platform.invoice.created', data: { number, ...d } })
  revalidatePath(`/platform/tenants/${tenantId}`)
  return ok(`Invoice ${number} created`)
}

export async function recordPaymentAction(
  tenantId: string,
  _p: ActionResult,
  fd: FormData,
): Promise<ActionResult> {
  const user = await admin()
  const parsed = z
    .object({
      amountAed: money.refine((v) => Number(v) > 0, 'Enter an amount'),
      method: z.enum(['cash', 'bank_transfer', 'card', 'other']),
      reference: text(120),
      receivedAt: date,
      invoiceId: z.union([z.uuid(), z.literal('')]).optional(),
      notes: text(500),
    })
    .safeParse(formObject(fd))
  if (!parsed.success) return fromZod(parsed.error)
  const { invoiceId, ...d } = parsed.data
  let res: Awaited<ReturnType<typeof recordPlatformPayment>>
  try {
    res = await platformDb().transaction((tx) =>
      recordPlatformPayment(tx, {
        tenantId,
        invoiceId: invoiceId || null,
        recordedBy: user.id,
        today: todayDubai(),
        ...d,
      }),
    )
  } catch (e) {
    if (e instanceof DomainError) return fail(e.message)
    throw e
  }
  // F22: a payment that clears the last late invoice lifts the automatic overdue / read-only stage.
  if (res.billing) await billingTransitionEffects(platformDb(), res.billing, { actorUserId: user.id })
  await audit({
    tenantId,
    actorUserId: user.id,
    action: 'platform.payment.recorded',
    data: { ...parsed.data, balanceAed: res.invoice ? res.balanceAed : undefined },
  })
  revalidatePath(`/platform/tenants/${tenantId}`)
  return ok(
    res.invoice && Number(res.balanceAed) > 0
      ? `Payment recorded · balance due AED ${res.balanceAed}`
      : 'Payment recorded',
  )
}

export async function savePlanAction(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await admin()
  const parsed = z
    .object({
      id: z.union([z.uuid(), z.literal('')]).optional(),
      code: z
        .string()
        .trim()
        .regex(/^[a-z0-9_-]{2,30}$/, 'Lowercase letters, numbers, - or _'),
      name: z.string().trim().min(2).max(60),
      description: text(300),
      priceAed: money,
      setupFeeAed: money,
      billingInterval: z.enum(['year', 'month']),
      trialDays: z.coerce.number().int().min(0).max(90),
      sort: z.coerce.number().int().min(0).max(999),
      active: bool,
      tier: z.enum(FEATURE_TIERS),
    })
    .safeParse(formObject(fd))
  if (!parsed.success) return fromZod(parsed.error)
  const { id, tier, ...rest } = parsed.data
  const existing = id ? await platformDb().query.plans.findFirst({ where: eq(plans.id, id) }) : undefined
  // PLAN §18.8: plans are found by code (premium / standard / legacy-yearly) — those codes never change; the tier
  // sets the feature switches in `limits` (other limits, e.g. a branch cap, are kept).
  const fixed = existing && (Object.values(PLAN_CODES) as string[]).includes(existing.code)
  const d = {
    ...rest,
    code: fixed ? existing.code : rest.code,
    limits: { ...(existing?.limits ?? {}), ...tierLimits(tier) },
  }
  try {
    if (id) await platformDb().update(plans).set(d).where(eq(plans.id, id))
    else await platformDb().insert(plans).values(d)
  } catch (e) {
    if ((e as { cause?: { code?: string } }).cause?.code === '23505')
      return fail('That code is already used.', { code: 'Already used' })
    throw e
  }
  await audit({
    actorUserId: user.id,
    action: id ? 'platform.plan.updated' : 'platform.plan.created',
    data: d,
  })
  revalidatePath('/platform/plans')
  return ok('Plan saved')
}

export async function saveCompanyAction(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await admin()
  const parsed = z
    .object({
      companyName: z.string().trim().min(2).max(120),
      legalName: text(),
      trn: text(30),
      tradeLicence: text(60),
      address: text(300),
      email: text(),
      phone: text(40),
      whatsapp: text(40),
      website: text(),
      bankName: text(),
      bankAccountName: text(),
      iban: text(40),
      swift: text(20),
      invoicePrefix: z
        .string()
        .trim()
        .regex(/^[A-Z0-9]{1,8}$/, 'Up to 8 capital letters/numbers'),
      vatRate: z.coerce
        .number()
        .min(0)
        .max(100)
        .transform((n) => n.toFixed(2)),
      pricesIncludeVat: bool,
      domainMarkupUsd: z.coerce
        .number({ error: 'Enter an amount' })
        .min(0, 'Must be 0 or more')
        .max(1000)
        .transform((n) => n.toFixed(2)),
      // G12: blank = automatic purge off (default).
      autoPurgeDays: z
        .string()
        .trim()
        .transform((v) => (v === '' ? null : Number(v)))
        .pipe(
          z
            .number({ error: 'Enter a number of days or leave it blank' })
            .int()
            .min(MIN_AUTO_PURGE_DAYS, `At least ${MIN_AUTO_PURGE_DAYS} days`)
            .max(3650)
            .nullable(),
        ),
    })
    .safeParse(formObject(fd))
  if (!parsed.success) return fromZod(parsed.error)
  await platformDb()
    .insert(platformSettings)
    .values({ id: 1, ...parsed.data, updatedBy: user.id })
    .onConflictDoUpdate({ target: platformSettings.id, set: { ...parsed.data, updatedBy: user.id } })
  await audit({ actorUserId: user.id, action: 'platform.company.updated', data: parsed.data })
  revalidatePath('/platform/settings')
  return ok('Company details saved')
}

export async function saveAiModelAction(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await admin()
  const price = z.coerce
    .number()
    .min(0)
    .transform((n) => n.toFixed(4))
  const parsed = z
    .object({
      agentKey: z.string().min(1),
      modelId: z.string().trim().min(3, 'Enter a model ID').max(80),
      supportsStructuredOutput: bool,
      priceInPerM: price,
      priceOutPerM: price,
      priceCachedInPerM: price,
      pricePerImage: price,
      enabled: bool,
    })
    .safeParse(formObject(fd))
  if (!parsed.success) return fromZod(parsed.error)
  const { agentKey, ...d } = parsed.data
  await platformDb().update(aiModelConfig).set(d).where(eq(aiModelConfig.agentKey, agentKey))
  await audit({ actorUserId: user.id, action: 'platform.ai_model.updated', entityId: agentKey, data: d })
  revalidatePath('/platform/ai')
  return ok('Model saved')
}

/**
 * R7: optional external Meta MCP server for the AI agents. The key is stored AES-GCM encrypted (blank = keep);
 * only the listed tool names are ever offered, and WhatsApp send-like tools are dropped regardless (@spa/ai tools.ts).
 */
export async function saveMetaMcpConfigAction(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await admin()
  const parsed = z
    .object({
      enabled: bool,
      url: z
        .string()
        .trim()
        .max(500)
        .refine((v) => !v || /^https:\/\/[^\s]+$/i.test(v), 'Use an https:// URL')
        .transform((v) => v || null),
      key: z.string().trim().max(2000).optional(),
      clearKey: bool,
      tools: z.string().max(4000).optional(),
    })
    .safeParse(formObject(fd))
  if (!parsed.success) return fromZod(parsed.error)
  const d = parsed.data
  if (d.enabled && !d.url) return fail('Enter the server URL first', { url: 'Enter the server URL first' })
  const tools = [
    ...new Set(
      (d.tools ?? '')
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter((s) => /^[A-Za-z0-9_.\-/]{1,128}$/.test(s)),
    ),
  ]
  const set: Partial<typeof platformSettings.$inferInsert> = {
    metaMcpEnabled: d.enabled,
    metaMcpUrl: d.url,
    metaMcpTools: tools,
    updatedBy: user.id,
  }
  if (d.clearKey) set.metaMcpKeyEnc = null
  else if (d.key) set.metaMcpKeyEnc = encryptSecret(d.key)
  await platformDb().insert(platformSettings).values({ id: 1 }).onConflictDoNothing()
  await platformDb().update(platformSettings).set(set).where(eq(platformSettings.id, 1))
  await audit({
    actorUserId: user.id,
    action: 'platform.meta_mcp.updated',
    data: {
      enabled: d.enabled,
      url: d.url,
      tools,
      key: d.clearKey ? 'cleared' : d.key ? 'replaced' : 'kept',
    },
  })
  revalidatePath('/platform/ai')
  return ok('Meta MCP server saved')
}

/**
 * Staff email (Resend) from the console: wins over RESEND_API_KEY / EMAIL_FROM env. The key is write-only (blank =
 * keep), stored encrypted when an encryption key exists, and never logged or audited (only "replaced/kept/cleared").
 */
export async function saveEmailSettingsAction(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await admin()
  const parsed = z
    .object({
      apiKey: z
        .string()
        .trim()
        .max(200)
        .refine((v) => !v || /^re_[A-Za-z0-9_-]{8,}$/.test(v), 'A Resend API key starts with re_')
        .optional(),
      clearKey: bool,
      emailFrom: z
        .string()
        .trim()
        .max(200)
        .refine(
          (v) => !v || /^([^<>@]+<[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>|[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)$/.test(v),
          'Use name <address@domain> or address@domain',
        )
        .transform((v) => v || null),
    })
    .safeParse(formObject(fd))
  if (!parsed.success) return fromZod(parsed.error)
  const d = parsed.data
  const apiKey = d.clearKey ? null : d.apiKey || undefined
  await saveEmailSettings(platformDb(), { apiKey, from: d.emailFrom }, user.id)
  registerEmailSettings()
  invalidateEmailSettings()
  await audit({
    actorUserId: user.id,
    action: 'platform.email.updated',
    data: { key: apiKey === null ? 'cleared' : apiKey ? 'replaced' : 'kept', emailFrom: d.emailFrom },
  })
  revalidatePath('/platform/settings')
  revalidatePath('/platform')
  return ok('Email settings saved')
}

const turnstileKey = (what: string) =>
  z
    .string()
    .trim()
    .max(200)
    .refine((v) => !v || /^[0-3]x[A-Za-z0-9_-]{16,120}$/.test(v), `A Turnstile ${what} looks like 0x4AAAA…`)

/**
 * Bot check (Cloudflare Turnstile, F9) from the console (owner, 2026-10-09): wins over TURNSTILE_* env. The site key
 * is public; the secret is write-only (blank = keep), sealed like the Resend key and never logged or audited.
 */
export async function saveTurnstileSettingsAction(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await admin()
  const parsed = z
    .object({
      siteKey: turnstileKey('site key'),
      secretKey: turnstileKey('secret key').optional(),
      customDomains: bool,
      clearKeys: bool,
    })
    .safeParse(formObject(fd))
  if (!parsed.success) return fromZod(parsed.error)
  const d = parsed.data
  const input = d.clearKeys
    ? { siteKey: null, secretKey: null, customDomains: null }
    : { siteKey: d.siteKey || null, secretKey: d.secretKey || undefined, customDomains: d.customDomains }
  await saveTurnstileSettings(platformDb(), input, user.id)
  invalidateTurnstileSettings()
  await audit({
    actorUserId: user.id,
    action: 'platform.turnstile.updated',
    data: {
      siteKey: input.siteKey,
      secretKey: input.secretKey === null ? 'cleared' : input.secretKey ? 'replaced' : 'kept',
      customDomains: input.customDomains,
    },
  })
  revalidatePath('/platform/settings')
  revalidatePath('/platform')
  return ok('Bot check settings saved')
}

/** Sends a test email to the signed-in super-admin with the effective settings (console first, then env). */
export async function sendTestEmailAction(_p: ActionResult): Promise<ActionResult> {
  const user = await admin()
  registerEmailSettings()
  try {
    await sendStaffEmail({
      to: user.email,
      subject: 'spamanagement test email',
      text: 'This is a test email from the super-admin console. Staff emails (invites, password resets, alerts) are working.',
    })
  } catch (e) {
    // The Resend error text never contains the key.
    return fail(`Test email failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300))
  }
  await audit({ actorUserId: user.id, action: 'platform.email.test_sent', data: { to: user.email } })
  return ok(`Test email sent to ${user.email}`)
}

/**
 * Super-admins card (owner, 2026-10-09): confirm a registered PLATFORM_ADMIN_EMAILS login's email (no working email
 * yet) → promoted at once; it still enrols 2FA before its console opens. Only listed logins; never yourself.
 */
export async function markAdminVerifiedAction(userId: string, _p: ActionResult): Promise<ActionResult> {
  const me = await admin()
  const id = z.string().trim().min(1).max(200).safeParse(userId)
  if (!id.success) return fail('Unknown login.')
  let result: Awaited<ReturnType<typeof markListedAdminVerified>>
  try {
    result = await markListedAdminVerified(platformDb(), { actorUserId: me.id, userId: id.data })
  } catch (e) {
    if (e instanceof DomainError) return fail(e.message)
    throw e
  }
  await audit({
    actorUserId: me.id,
    action: 'platform.admin.email_verified',
    entity: 'user',
    entityId: id.data,
    data: result,
  })
  revalidatePath('/platform/settings')
  return ok(
    result.promoted
      ? `${result.email} is a super-admin now (two-step verification is set up on its first console visit).`
      : `${result.email} is confirmed.`,
  )
}

/** Revalidates the console pages and the spa's dashboard (red bar + Billing page). */
function refresh(tenantId: string) {
  revalidatePath(`/platform/tenants/${tenantId}`)
  revalidatePath('/platform')
  revalidatePath('/dashboard', 'layout')
}

const domainFail = (e: unknown) => {
  if (e instanceof DomainError) return fail(e.message)
  throw e
}

/** R3: issue the plan invoices for the current period (12 monthly or one-time) + the setup fee. */
export async function generateScheduleAction(tenantId: string, _p: ActionResult): Promise<ActionResult> {
  const user = await admin()
  try {
    const r = await generateBillingSchedule(platformDb(), tenantId, todayDubai())
    await audit({ tenantId, actorUserId: user.id, action: 'platform.invoice.schedule', data: r })
    refresh(tenantId)
    return ok(
      r.created
        ? `${r.created} invoice${r.created === 1 ? '' : 's'} created${r.voided ? `, ${r.voided} voided` : ''}`
        : 'Schedule is already up to date',
    )
  } catch (e) {
    return domainFail(e)
  }
}

/** R11: the super-admin alone sets an invoice Paid / Must pay. */
export async function setInvoicePaidAction(
  tenantId: string,
  invoiceId: string,
  paid: boolean,
  _p: ActionResult,
): Promise<ActionResult> {
  const user = await admin()
  if (!z.uuid().safeParse(invoiceId).success) return fail('Invoice not found')
  try {
    const row = await setInvoicePaid(platformDb(), {
      tenantId,
      invoiceId,
      paid,
      userId: user.id,
      today: todayDubai(),
    })
    await audit({
      tenantId,
      actorUserId: user.id,
      action: paid ? 'platform.invoice.marked_paid' : 'platform.invoice.marked_unpaid',
      entity: 'platform_invoice',
      entityId: invoiceId,
      data: { number: row.number },
    })
    refresh(tenantId)
    return ok(paid ? `${row.number} marked paid` : `${row.number} marked unpaid`)
  } catch (e) {
    return domainFail(e)
  }
}

/** R12: pause (dashboard read-only; site + booking stay on) or resume a spa. */
export async function pauseTenantAction(
  tenantId: string,
  pause: boolean,
  _p: ActionResult,
): Promise<ActionResult> {
  const user = await admin()
  try {
    const row = pause ? await pauseTenant(platformDb(), tenantId) : await resumeTenant(platformDb(), tenantId)
    await audit({
      tenantId,
      actorUserId: user.id,
      action: pause ? 'platform.tenant.paused' : 'platform.tenant.resumed',
      data: { status: row.status },
    })
    refresh(tenantId)
    return ok(pause ? `${row.name} paused` : `${row.name} resumed`)
  } catch (e) {
    return domainFail(e)
  }
}

/** R12: soft-delete a spa; the admin types its address to confirm. */
export async function deleteTenantAction(
  tenantId: string,
  _p: ActionResult,
  fd: FormData,
): Promise<ActionResult> {
  const user = await admin()
  const confirm = String(fd.get('confirm') ?? '')
  try {
    const row = await deleteTenant(platformDb(), tenantId, confirm)
    await audit({
      tenantId,
      actorUserId: user.id,
      action: 'platform.tenant.deleted',
      data: { slug: row.slug },
    })
    refresh(tenantId)
    revalidatePath('/platform/tenants')
    return ok(`${row.name} deleted (data kept — Resume restores it)`)
  } catch (e) {
    if (e instanceof DomainError) return fail(e.message, { confirm: e.message })
    throw e
  }
}

/**
 * G12: permanently delete an already-deleted spa (every row, files, domains, jobs). The admin types its address.
 * The tenant's own audit rows go with it; the `tenant_purges` row + a tenant-less audit entry are the record.
 */
export async function purgeTenantAction(
  tenantId: string,
  _p: ActionResult,
  fd: FormData,
): Promise<ActionResult> {
  const user = await admin()
  const confirm = String(fd.get('confirm') ?? '')
  try {
    const rec = await purgeTenant(platformDb(), tenantId, confirm, { actorUserId: user.id })
    await audit({
      actorUserId: user.id,
      action: 'platform.tenant.purged',
      entity: 'tenant',
      entityId: tenantId,
      data: { slug: rec.slug, name: rec.name, purgeId: rec.id, counts: rec.counts, errors: rec.errors },
    })
  } catch (e) {
    if (e instanceof DomainError) return fail(e.message, { confirm: e.message })
    throw e
  }
  revalidatePath('/platform/tenants')
  revalidatePath('/platform')
  redirect(adminPath('/tenants'))
}

/** R12: a reminder the spa sees in its dashboard + the message text for a click-to-send WhatsApp link. */
export async function paymentReminderAction(tenantId: string, _p: ActionResult): Promise<ActionResult> {
  const user = await admin()
  const tenant = await platformDb().query.tenants.findFirst({ where: eq(tenants.id, tenantId) })
  if (!tenant) return fail('Spa not found')
  try {
    const { reminder, message } = await createPaymentReminder(platformDb(), {
      tenantId,
      userId: user.id,
      today: todayDubai(),
      billingUrl: canonicalUrls().app(`/${tenant.slug}/billing`),
    })
    await audit({
      tenantId,
      actorUserId: user.id,
      action: 'platform.reminder.created',
      entity: 'platform_reminder',
      entityId: reminder.id,
      data: { amountAed: reminder.amountAed },
    })
    refresh(tenantId)
    return ok('Reminder created — the spa sees it now. Send the message below.', { message })
  } catch (e) {
    return domainFail(e)
  }
}
