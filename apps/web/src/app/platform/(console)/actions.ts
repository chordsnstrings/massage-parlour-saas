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
import { eq, sql, sum } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { type ActionResult, fail, formObject, fromZod, ok } from '@/lib/action'
import { requirePlatformAdmin } from '@/server/access'
import { audit } from '@/server/audit'

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
  const db = platformDb()
  const settings = await db.query.platformSettings.findFirst({ where: eq(platformSettings.id, 1) })
  const rate = Number(settings?.vatRate ?? 5)
  const amount = Number(d.amountAed)
  const vat = settings?.pricesIncludeVat ? (amount * rate) / (100 + rate) : (amount * rate) / 100
  const subtotal = settings?.pricesIncludeVat ? amount - vat : amount
  const [{ n }] = (await db.execute<{ n: string }>(sql`select nextval('platform_invoice_seq') as n`))
    .rows as [{ n: string }]
  const number = `${settings?.invoicePrefix ?? 'SM'}-${d.issueDate.slice(0, 4)}-${String(n).padStart(4, '0')}`
  await db.insert(platformInvoices).values({
    tenantId,
    number,
    issueDate: d.issueDate,
    dueDate: d.dueDate,
    description: d.description,
    subtotalAed: subtotal.toFixed(2),
    vatAed: vat.toFixed(2),
    totalAed: (subtotal + vat).toFixed(2),
  })
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
