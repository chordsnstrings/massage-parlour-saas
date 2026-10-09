'use server'
import {
  aiModelConfig,
  plans,
  platformDb,
  platformInvoices,
  platformPayments,
  platformSettings,
  subscriptions,
  tenants,
} from '@spa/db'
import {
  createPaymentReminder,
  createPlatformInvoice,
  DomainError,
  deleteTenant,
  encryptSecret,
  generateBillingSchedule,
  pauseTenant,
  resumeTenant,
  setInvoicePaid,
} from '@spa/services'
import { eq, sum } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { type ActionResult, fail, formObject, fromZod, ok } from '@/lib/action'
import { todayDubai } from '@/lib/utils'
import { requirePlatformAdmin } from '@/server/access'
import { audit } from '@/server/audit'
import { canonicalUrls } from '@/server/origin'

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
      graceDays: z.coerce.number().int().min(0).max(120),
      notes: text(1000),
    })
    .safeParse(formObject(fd))
  if (!parsed.success) return fromZod(parsed.error)
  const d = parsed.data
  if (d.currentPeriodEnd < d.currentPeriodStart)
    return fail('End must be after start.', { currentPeriodEnd: 'End must be after start' })
  await platformDb()
    .insert(subscriptions)
    .values({ tenantId, ...d })
    .onConflictDoUpdate({ target: subscriptions.tenantId, set: d })
  await platformDb().update(tenants).set({ planId: d.planId }).where(eq(tenants.id, tenantId))
  await audit({ tenantId, actorUserId: user.id, action: 'platform.subscription.updated', data: d })
  revalidatePath(`/platform/tenants/${tenantId}`)
  return ok('Subscription saved')
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
      method: z.enum(['cash', 'bank_transfer', 'other']),
      reference: text(120),
      receivedAt: date,
      invoiceId: z.union([z.uuid(), z.literal('')]).optional(),
      notes: text(500),
    })
    .safeParse(formObject(fd))
  if (!parsed.success) return fromZod(parsed.error)
  const { invoiceId, ...d } = parsed.data
  const db = platformDb()
  await db.transaction(async (tx) => {
    await tx
      .insert(platformPayments)
      .values({ tenantId, invoiceId: invoiceId || null, recordedBy: user.id, ...d })
    if (invoiceId) {
      const [inv] = await tx.select().from(platformInvoices).where(eq(platformInvoices.id, invoiceId))
      const [paid] = await tx
        .select({ total: sum(platformPayments.amountAed) })
        .from(platformPayments)
        .where(eq(platformPayments.invoiceId, invoiceId))
      if (inv && Number(paid?.total ?? 0) >= Number(inv.totalAed)) {
        await tx
          .update(platformInvoices)
          .set({ status: 'paid', paidAt: new Date() })
          .where(eq(platformInvoices.id, invoiceId))
      }
    }
  })
  await audit({ tenantId, actorUserId: user.id, action: 'platform.payment.recorded', data: parsed.data })
  revalidatePath(`/platform/tenants/${tenantId}`)
  return ok('Payment recorded')
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
    })
    .safeParse(formObject(fd))
  if (!parsed.success) return fromZod(parsed.error)
  const { id, ...d } = parsed.data
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
