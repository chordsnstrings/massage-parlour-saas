'use server'
import { membershipPlans, packageDefinitions, promoCodes, withTenant } from '@spa/db'
import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { type ActionResult, fail, formObject, fromZod, ok } from '@/lib/action'
import { guard } from '@/server/access'
import { audit } from '@/server/audit'

const money = z.coerce.number({ message: 'Enter an amount' }).positive('Enter an amount').max(1_000_000)
const optText = z.string().trim().max(400).optional()

/** Up to 4 "service + quantity" rows posted as item{n}Service / item{n}Qty. */
function itemsFrom(raw: Record<string, string | string[]>) {
  const items: { serviceId: string; quantity: number }[] = []
  for (let n = 1; n <= 4; n++) {
    const serviceId = String(raw[`item${n}Service`] ?? '')
    const quantity = Number(raw[`item${n}Qty`] ?? 0)
    if (serviceId && quantity > 0) {
      const existing = items.find((i) => i.serviceId === serviceId)
      if (existing) existing.quantity += Math.min(quantity, 100)
      else items.push({ serviceId, quantity: Math.min(Math.floor(quantity), 100) })
    }
  }
  return items
}

const done = (slug: string, message: string) => {
  revalidatePath(`/dashboard/${slug}/packages`)
  return ok(message)
}

export async function savePackageAction(
  slug: string,
  id: string | null,
  _p: ActionResult,
  fd: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'services.manage')
  if (error) return fail(error)
  const raw = formObject(fd)
  const parsed = z
    .object({
      nameEn: z.string().trim().min(2, 'Give the package a name').max(80),
      nameAr: z.string().trim().max(80).optional(),
      descriptionEn: optText,
      priceAed: money,
      validityDays: z.coerce.number().int().min(7, 'At least 7 days').max(1095),
      active: z.preprocess((v) => v === 'on', z.boolean()),
    })
    .safeParse(raw)
  if (!parsed.success) return fromZod(parsed.error)
  const items = itemsFrom(raw)
  if (items.length === 0) return fail('Add at least one treatment.', { item1Service: 'Pick a treatment' })
  const d = parsed.data
  const values = {
    name: { en: d.nameEn, ar: d.nameAr || undefined },
    description: d.descriptionEn ? { en: d.descriptionEn } : null,
    priceAed: d.priceAed.toFixed(2),
    validityDays: d.validityDays,
    items,
    active: d.active,
  }
  const saved = await withTenant(ctx.tenant.id, async (tx) =>
    id
      ? (await tx.update(packageDefinitions).set(values).where(eq(packageDefinitions.id, id)).returning())[0]
      : (
          await tx
            .insert(packageDefinitions)
            .values({ tenantId: ctx.tenant.id, ...values })
            .returning()
        )[0],
  )
  if (!saved) return fail('Package not found')
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: id ? 'package.updated' : 'package.created',
    entityId: saved.id,
    data: values,
  })
  return done(slug, id ? 'Package updated' : 'Package created')
}

export async function saveMembershipAction(
  slug: string,
  id: string | null,
  _p: ActionResult,
  fd: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'services.manage')
  if (error) return fail(error)
  const raw = formObject(fd)
  const parsed = z
    .object({
      nameEn: z.string().trim().min(2, 'Give the plan a name').max(80),
      nameAr: z.string().trim().max(80).optional(),
      monthlyAed: money,
      discountPct: z.coerce.number().min(0).max(90).optional(),
      active: z.preprocess((v) => v === 'on', z.boolean()),
    })
    .safeParse(raw)
  if (!parsed.success) return fromZod(parsed.error)
  const d = parsed.data
  const values = {
    name: { en: d.nameEn, ar: d.nameAr || undefined },
    monthlyAed: d.monthlyAed.toFixed(2),
    benefits: { includedSessions: itemsFrom(raw), discountPct: d.discountPct || 0 },
    active: d.active,
  }
  const saved = await withTenant(ctx.tenant.id, async (tx) =>
    id
      ? (await tx.update(membershipPlans).set(values).where(eq(membershipPlans.id, id)).returning())[0]
      : (
          await tx
            .insert(membershipPlans)
            .values({ tenantId: ctx.tenant.id, ...values })
            .returning()
        )[0],
  )
  if (!saved) return fail('Plan not found')
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: id ? 'membership_plan.updated' : 'membership_plan.created',
    entityId: saved.id,
    data: values,
  })
  return done(slug, id ? 'Plan updated' : 'Plan created')
}

export async function savePromoAction(slug: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'marketing.campaigns')
  if (error) return fail(error)
  const parsed = z
    .object({
      code: z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z0-9-]{3,20}$/, '3–20 letters, numbers or dashes'),
      kind: z.enum(['percent', 'amount']),
      value: z.coerce.number().positive('Enter a value').max(100_000),
      validFrom: z.string().optional(),
      validTo: z.string().optional(),
      maxUses: z.coerce
        .number()
        .int()
        .positive()
        .optional()
        .or(z.literal('').transform(() => undefined)),
    })
    .refine((d) => d.kind !== 'percent' || d.value <= 100, { path: ['value'], message: 'At most 100%' })
    .safeParse(formObject(fd))
  if (!parsed.success) return fromZod(parsed.error)
  const d = parsed.data
  const inserted = await withTenant(ctx.tenant.id, (tx) =>
    tx
      .insert(promoCodes)
      .values({
        tenantId: ctx.tenant.id,
        code: d.code,
        kind: d.kind,
        value: d.value.toFixed(2),
        validFrom: d.validFrom || null,
        validTo: d.validTo || null,
        maxUses: d.maxUses ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: promoCodes.id }),
  )
  if (inserted.length === 0) return fail('That code already exists.', { code: 'Already in use' })
  await audit({ tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: 'promo.created', data: d })
  return done(slug, 'Promo code created')
}

/** Plain form action (no client JS): flips `active` on a package, plan or promo code. */
export async function toggleActiveAction(
  slug: string,
  kind: 'package' | 'membership' | 'promo',
  id: string,
  active: boolean,
) {
  const { ctx, error } = await guard(slug, kind === 'promo' ? 'marketing.campaigns' : 'services.manage')
  if (error) return
  await withTenant(ctx.tenant.id, async (tx) => {
    if (kind === 'package')
      await tx
        .update(packageDefinitions)
        .set({ active })
        .where(and(eq(packageDefinitions.id, id)))
    else if (kind === 'membership')
      await tx.update(membershipPlans).set({ active }).where(eq(membershipPlans.id, id))
    else await tx.update(promoCodes).set({ active }).where(eq(promoCodes.id, id))
  })
  revalidatePath(`/dashboard/${slug}/packages`)
}
