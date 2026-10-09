'use server'
import { branches, rooms, serviceCategories, services, serviceVariants, withTenant } from '@spa/db'
import { and, count, eq, inArray, notInArray } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { IMAGE_URL_PATTERN } from '@/components/media/types'
import { type ActionResult, fail, formObject, fromZod, ok } from '@/lib/action'
import { guard } from '@/server/access'
import { audit } from '@/server/audit'
import { ROOM_TYPES } from './constants'

const PERM = 'services.manage' as const
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const asArray = (v: unknown) => (v === undefined || v === '' ? [] : Array.isArray(v) ? v : [v])
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || undefined)
const bool = z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean())
const color = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'services.v.colour')
  .optional()
  .transform((v) => v ?? null)

async function record(
  ctx: Awaited<ReturnType<typeof guard>>['ctx'],
  action: string,
  entity: string,
  entityId?: string,
  data?: unknown,
) {
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    impersonatorUserId: ctx.impersonating ? ctx.user.id : undefined,
    action,
    entity,
    entityId,
    data,
  })
}

const refresh = (slug: string) => {
  revalidatePath(`/dashboard/${slug}/services`)
  revalidatePath(`/dashboard/${slug}/staff`, 'layout')
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

const categorySchema = z.object({
  id: z
    .string()
    .uuid()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  nameEn: z.string().trim().min(2, 'services.v.name').max(60),
  nameAr: optText(60),
})

export async function saveCategoryAction(
  slug: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, PERM)
  if (error) return fail(error)
  const parsed = categorySchema.safeParse(formObject(formData))
  if (!parsed.success) return fromZod(parsed.error)
  const d = parsed.data
  const name = { en: d.nameEn, ...(d.nameAr ? { ar: d.nameAr } : {}) }
  const id = await withTenant(ctx.tenant.id, async (tx) => {
    if (d.id) {
      const [row] = await tx
        .update(serviceCategories)
        .set({ name })
        .where(eq(serviceCategories.id, d.id))
        .returning({ id: serviceCategories.id })
      return row?.id
    }
    const [{ n } = { n: 0 }] = await tx.select({ n: count() }).from(serviceCategories)
    const [row] = await tx
      .insert(serviceCategories)
      .values({ tenantId: ctx.tenant.id, name, sort: n })
      .returning({ id: serviceCategories.id })
    return row?.id
  })
  if (!id) return fail('services.category.notFound')
  await record(ctx, d.id ? 'category.updated' : 'category.created', 'service_category', id, name)
  refresh(slug)
  return ok(d.id ? 'services.category.saved' : 'services.category.added')
}

export async function deleteCategoryAction(slug: string, id: string): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, PERM)
  if (error) return fail(error)
  if (!z.string().uuid().safeParse(id).success) return fail('services.category.notFound')
  // Services in the category fall back to "Uncategorised" (FK on delete set null).
  await withTenant(ctx.tenant.id, (tx) => tx.delete(serviceCategories).where(eq(serviceCategories.id, id)))
  await record(ctx, 'category.deleted', 'service_category', id)
  refresh(slug)
  return ok('services.category.removed')
}

// ---------------------------------------------------------------------------
// Services (+ duration/price variants)
// ---------------------------------------------------------------------------

const serviceSchema = z
  .object({
    id: z
      .string()
      .uuid()
      .optional()
      .or(z.literal('').transform(() => undefined)),
    categoryId: z
      .string()
      .uuid()
      .optional()
      .or(z.literal('').transform(() => undefined)),
    nameEn: z.string().trim().min(2, 'services.v.name').max(80),
    nameAr: optText(80),
    descriptionEn: optText(600),
    descriptionAr: optText(600),
    imageUrl: z
      .string()
      .trim()
      .max(500)
      .regex(IMAGE_URL_PATTERN, 'services.v.image')
      .optional()
      .or(z.literal('').transform(() => undefined)),
    bufferBeforeMin: z.coerce.number().int().min(0, 'services.v.min0').max(120, 'services.v.max120'),
    bufferAfterMin: z.coerce.number().int().min(0, 'services.v.min0').max(120, 'services.v.max120'),
    therapistsRequired: z.coerce.number().int().min(1).max(2),
    roomTypes: z.preprocess(asArray, z.array(z.enum(ROOM_TYPES))),
    equipmentTypes: z.preprocess(asArray, z.array(z.string().trim().min(1).max(40)).max(5)),
    onlineBookable: bool,
    // '' = spa default (settings), 'show' / 'hide' = this service overrides it (R4).
    showPrice: z
      .enum(['', 'show', 'hide'])
      .optional()
      .transform((v) => (v === 'show' ? true : v === 'hide' ? false : null)),
    active: bool,
    color,
    variantId: z.preprocess(asArray, z.array(z.string())),
    variantDuration: z.preprocess(asArray, z.array(z.string())),
    variantPrice: z.preprocess(asArray, z.array(z.string())),
  })
  .transform((d, zctx) => {
    const variants = d.variantDuration.map((dur, i) => ({
      id: UUID.test(d.variantId[i] ?? '') ? d.variantId[i] : undefined,
      durationMin: Number(dur),
      // Blank = price on request: the receptionist types it at checkout (R4).
      priceAed: (d.variantPrice[i] ?? '').trim() === '' ? null : Number(d.variantPrice[i]),
    }))
    variants.forEach((v, i) => {
      if (!Number.isInteger(v.durationMin) || v.durationMin < 10 || v.durationMin > 480)
        zctx.addIssue({ code: 'custom', path: [`variants.${i}`], message: 'services.v.duration' })
      else if (
        v.priceAed !== null &&
        (!Number.isFinite(v.priceAed) || v.priceAed < 0 || v.priceAed > 100_000)
      )
        zctx.addIssue({ code: 'custom', path: [`variants.${i}`], message: 'services.v.price' })
    })
    if (variants.length === 0)
      zctx.addIssue({ code: 'custom', path: ['variants'], message: 'services.v.noDurations' })
    return { ...d, variants }
  })

export async function saveServiceAction(
  slug: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, PERM)
  if (error) return fail(error)
  const parsed = serviceSchema.safeParse(formObject(formData))
  if (!parsed.success) return fromZod(parsed.error)
  const d = parsed.data
  const values = {
    categoryId: d.categoryId ?? null,
    name: { en: d.nameEn, ...(d.nameAr ? { ar: d.nameAr } : {}) },
    description:
      d.descriptionEn || d.descriptionAr ? { en: d.descriptionEn ?? '', ar: d.descriptionAr } : null,
    bufferBeforeMin: d.bufferBeforeMin,
    bufferAfterMin: d.bufferAfterMin,
    therapistsRequired: d.therapistsRequired,
    roomTypes: d.roomTypes,
    equipmentTypes: [...new Set(d.equipmentTypes)],
    onlineBookable: d.onlineBookable,
    showPrice: d.showPrice,
    active: d.active,
    color: d.color,
    // Only forms that post the field change the photo.
    ...(formData.has('imageUrl') ? { imageUrl: d.imageUrl ?? null } : {}),
  }
  const id = await withTenant(ctx.tenant.id, async (tx) => {
    let serviceId = d.id
    if (serviceId) {
      const [row] = await tx
        .update(services)
        .set(values)
        .where(eq(services.id, serviceId))
        .returning({ id: services.id })
      if (!row) return null
    } else {
      const [{ n } = { n: 0 }] = await tx.select({ n: count() }).from(services)
      const [row] = await tx
        .insert(services)
        .values({ tenantId: ctx.tenant.id, ...values, sort: n })
        .returning({ id: services.id })
      serviceId = row!.id
    }
    const keep = d.variants.flatMap((v) => (v.id ? [v.id] : []))
    // Removed durations: past bookings keep their name/price snapshot (FK on delete set null).
    await tx
      .delete(serviceVariants)
      .where(
        keep.length
          ? and(eq(serviceVariants.serviceId, serviceId), notInArray(serviceVariants.id, keep))
          : eq(serviceVariants.serviceId, serviceId),
      )
    for (const [sort, v] of d.variants.entries()) {
      const row = { durationMin: v.durationMin, priceAed: v.priceAed?.toFixed(2) ?? null, sort }
      if (v.id)
        await tx
          .update(serviceVariants)
          .set(row)
          .where(and(eq(serviceVariants.id, v.id), eq(serviceVariants.serviceId, serviceId)))
      else await tx.insert(serviceVariants).values({ tenantId: ctx.tenant.id, serviceId, ...row })
    }
    return serviceId
  })
  if (!id) return fail('services.service.notFound')
  await record(ctx, d.id ? 'service.updated' : 'service.created', 'service', id, {
    ...values,
    variants: d.variants,
  })
  refresh(slug)
  return ok(d.id ? 'services.service.saved' : 'services.service.added')
}

export async function deleteServiceAction(slug: string, id: string): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, PERM)
  if (error) return fail(error)
  if (!z.string().uuid().safeParse(id).success) return fail('services.service.notFound')
  await withTenant(ctx.tenant.id, (tx) => tx.delete(services).where(eq(services.id, id)))
  await record(ctx, 'service.deleted', 'service', id)
  refresh(slug)
  return ok('services.service.deleted')
}

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

const roomSchema = z.object({
  id: z
    .string()
    .uuid()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  branchId: z.string().uuid('services.v.branch'),
  name: z.string().trim().min(1, 'services.v.name').max(40),
  type: z.enum(ROOM_TYPES),
  active: bool,
})

export async function saveRoomAction(
  slug: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, PERM)
  if (error) return fail(error)
  const parsed = roomSchema.safeParse(formObject(formData))
  if (!parsed.success) return fromZod(parsed.error)
  const { id: roomId, ...d } = parsed.data
  const id = await withTenant(ctx.tenant.id, async (tx) => {
    const [branch] = await tx.select({ id: branches.id }).from(branches).where(eq(branches.id, d.branchId))
    if (!branch) return null
    if (roomId) {
      const [row] = await tx.update(rooms).set(d).where(eq(rooms.id, roomId)).returning({ id: rooms.id })
      return row?.id ?? null
    }
    const [{ n } = { n: 0 }] = await tx
      .select({ n: count() })
      .from(rooms)
      .where(eq(rooms.branchId, d.branchId))
    const [row] = await tx
      .insert(rooms)
      .values({ tenantId: ctx.tenant.id, ...d, sort: n })
      .returning({ id: rooms.id })
    return row!.id
  })
  if (!id) return fail('services.room.notFound')
  await record(ctx, roomId ? 'room.updated' : 'room.created', 'room', id, d)
  refresh(slug)
  return ok(roomId ? 'services.room.saved' : 'services.room.added')
}

export async function deleteRoomAction(slug: string, id: string): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, PERM)
  if (error) return fail(error)
  if (!z.string().uuid().safeParse(id).success) return fail('services.room.notFoundShort')
  await withTenant(ctx.tenant.id, (tx) => tx.delete(rooms).where(eq(rooms.id, id)))
  await record(ctx, 'room.deleted', 'room', id)
  refresh(slug)
  return ok('services.room.deleted')
}

// ---------------------------------------------------------------------------
// Sample UAE spa menu
// ---------------------------------------------------------------------------

type Sample = {
  cat: 'massage' | 'feet' | 'bath' | 'couples'
  en: string
  ar: string
  dEn: string
  dAr: string
  variants: [number, number][]
  color: string
  roomTypes?: string[]
  therapists?: number
  bufferAfter?: number
}

const SAMPLE_CATEGORIES = {
  massage: { en: 'Massage', ar: 'مساج' },
  feet: { en: 'Feet', ar: 'القدمين' },
  bath: { en: 'Bath & body', ar: 'الحمام والجسم' },
  couples: { en: 'Couples', ar: 'للأزواج' },
} as const

const SAMPLE_MENU: Sample[] = [
  {
    cat: 'massage',
    en: 'Swedish massage',
    ar: 'مساج سويدي',
    dEn: 'Long, flowing strokes with light to medium pressure to relax body and mind.',
    dAr: 'حركات طويلة وانسيابية بضغط خفيف إلى متوسط لاسترخاء الجسم والعقل.',
    variants: [
      [60, 350],
      [90, 480],
    ],
    color: '#5e7d6b',
  },
  {
    cat: 'massage',
    en: 'Deep tissue massage',
    ar: 'مساج الأنسجة العميقة',
    dEn: 'Firm pressure focused on knots and tension in the back, neck and shoulders.',
    dAr: 'ضغط قوي يركز على العقد والتوتر في الظهر والرقبة والكتفين.',
    variants: [
      [60, 400],
      [90, 550],
    ],
    color: '#3d5a80',
  },
  {
    cat: 'massage',
    en: 'Thai massage',
    ar: 'مساج تايلندي',
    dEn: 'Traditional stretching and acupressure on a floor mat, done in loose clothing.',
    dAr: 'تمدد تقليدي وضغط على نقاط الجسم على فراش أرضي بملابس مريحة.',
    variants: [
      [60, 380],
      [90, 520],
    ],
    color: '#b5838d',
    roomTypes: ['thai', 'single', 'vip'],
  },
  {
    cat: 'massage',
    en: 'Hot stone massage',
    ar: 'مساج بالأحجار الساخنة',
    dEn: 'Warm basalt stones melt away muscle tension.',
    dAr: 'أحجار بازلت دافئة تذيب توتر العضلات.',
    variants: [[75, 495]],
    color: '#a26769',
    bufferAfter: 15,
  },
  {
    cat: 'feet',
    en: 'Foot reflexology',
    ar: 'تدليك القدمين (ريفلكسولوجي)',
    dEn: 'Pressure-point foot massage to restore balance and ease tired legs.',
    dAr: 'تدليك القدمين بالضغط على النقاط لاستعادة التوازن وإراحة الساقين.',
    variants: [
      [30, 150],
      [60, 250],
    ],
    color: '#c9a227',
    roomTypes: ['foot', 'single'],
  },
  {
    cat: 'bath',
    en: 'Moroccan bath',
    ar: 'حمام مغربي',
    dEn: 'Steam, black soap and a full-body scrub with kessa glove.',
    dAr: 'بخار وصابون أسود وتقشير كامل للجسم بقفاز الكيس.',
    variants: [[45, 300]],
    color: '#6d597a',
    roomTypes: ['other'],
    bufferAfter: 20,
  },
  {
    cat: 'couples',
    en: 'Couples Swedish massage',
    ar: 'مساج سويدي للأزواج',
    dEn: 'Side-by-side Swedish massage for two in our couples suite.',
    dAr: 'مساج سويدي لشخصين جنبًا إلى جنب في جناح الأزواج.',
    variants: [[60, 650]],
    color: '#8e7dbe',
    roomTypes: ['couple'],
    therapists: 2,
    bufferAfter: 15,
  },
]

export async function addSampleMenuAction(slug: string): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, PERM)
  if (error) return fail(error)
  const result = await withTenant(ctx.tenant.id, async (tx) => {
    const [{ n } = { n: 0 }] = await tx.select({ n: count() }).from(services)
    if (n > 0) return 'exists' as const
    const [branch] = await tx
      .select({ id: branches.id })
      .from(branches)
      .where(eq(branches.isDefault, true))
      .limit(1)
    const cats = await tx
      .insert(serviceCategories)
      .values(Object.values(SAMPLE_CATEGORIES).map((name, sort) => ({ tenantId: ctx.tenant.id, name, sort })))
      .returning({ id: serviceCategories.id })
    const catId = Object.fromEntries(Object.keys(SAMPLE_CATEGORIES).map((k, i) => [k, cats[i]!.id]))
    for (const [sort, s] of SAMPLE_MENU.entries()) {
      const [row] = await tx
        .insert(services)
        .values({
          tenantId: ctx.tenant.id,
          categoryId: catId[s.cat],
          name: { en: s.en, ar: s.ar },
          description: { en: s.dEn, ar: s.dAr },
          bufferAfterMin: s.bufferAfter ?? 10,
          roomTypes: s.roomTypes ?? [],
          therapistsRequired: s.therapists ?? 1,
          color: s.color,
          sort,
        })
        .returning({ id: services.id })
      await tx.insert(serviceVariants).values(
        s.variants.map(([durationMin, price], i) => ({
          tenantId: ctx.tenant.id,
          serviceId: row!.id,
          durationMin,
          priceAed: price.toFixed(2),
          sort: i,
        })),
      )
    }
    if (branch) {
      const existing = await tx
        .select({ name: rooms.name })
        .from(rooms)
        .where(and(eq(rooms.branchId, branch.id), inArray(rooms.name, ['Room 1', 'Couples suite'])))
      const names = new Set(existing.map((r) => r.name))
      const toAdd = [
        { name: 'Room 1', type: 'single', sort: 0 },
        { name: 'Couples suite', type: 'couple', sort: 1 },
      ].filter((r) => !names.has(r.name))
      if (toAdd.length)
        await tx
          .insert(rooms)
          .values(toAdd.map((r) => ({ tenantId: ctx.tenant.id, branchId: branch.id, ...r })))
    }
    return 'added' as const
  })
  if (result === 'exists') return fail('services.sample.exists')
  await record(ctx, 'service.sample_menu_added', 'service')
  refresh(slug)
  return ok('services.sample.added')
}
