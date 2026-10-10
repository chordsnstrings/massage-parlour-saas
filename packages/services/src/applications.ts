// Spa applications (PLAN §18.3, owner decision 2026-10-09). A new spa applies (its login is created then, and stays
// locked); the platform owner accepts — the spa is provisioned with an ACTIVE subscription from the agreed start date
// and the setup-fee invoice + the recorded payment (full or deposit) — or rejects (the login is disabled and its
// sessions revoked). Platform role only (`platformDb()`); permission checks and audit stay in the caller.
import {
  BALANCE_DUE_CHOICES,
  type BalanceDue,
  checkSlug,
  DEFAULT_BALANCE_DUE,
  depositRule,
  EMIRATE_NAMES,
  isEmirate,
  type SubscriptionDiscounts,
  SYSTEM_ROLES,
  type SystemRoleKey,
  setupBalanceDueDate,
} from '@spa/core'
import {
  branches,
  type Db,
  type DbOrTx,
  grantListedPlatformAdmins,
  isListedAdminEmail,
  listedAdminEmails,
  members,
  plans,
  platformAdmins,
  platformSettings,
  roles,
  type SetupPaymentSummary,
  session,
  spaApplications,
  subscriptions,
  type Tx,
  tenants,
  user,
} from '@spa/db'
import { and, asc, eq, ne, sql } from 'drizzle-orm'
import { isLegacyPlan } from './entitlements'
import { DomainError } from './errors'
import { setTenantLogo } from './logo'
import {
  addMonths,
  createPlatformInvoice,
  discounted,
  generateBillingScheduleTx,
  invoiceTotals,
  recordPlatformPayment,
} from './platform-billing'

const addDays = (isoDate: string, days: number) => {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export type ProvisionInput = {
  userId: string
  businessName: string
  slug: string
  /** Asia/Dubai business date (subscription start for a trial). */
  today: string
  /**
   * Default: a trial on the first active plan (the old self-serve sign-up). Accepted applications pass an active
   * subscription on the chosen plan that starts on the agreed date and runs one year.
   */
  subscription?: { planId: string; status: 'active'; start: string; discounts?: SubscriptionDiscounts }
  branch?: { address?: string | null; phone?: string | null }
}

/** Creates a tenant with default branch, system roles, owner membership and its subscription (inside `tx`). */
export async function provisionTenantTx(tx: Tx, input: ProvisionInput) {
  const [plan] = input.subscription
    ? await tx.select().from(plans).where(eq(plans.id, input.subscription.planId))
    : await tx
        .select()
        .from(plans)
        .where(eq(plans.active, true))
        .orderBy(asc(plans.sort), asc(plans.createdAt))
        .limit(1)
  if (input.subscription && !plan) throw new DomainError('Plan not found', 'not_found')
  const active = Boolean(input.subscription)
  const [tenant] = await tx
    .insert(tenants)
    .values({
      slug: input.slug,
      name: input.businessName,
      planId: plan?.id,
      status: active ? 'active' : 'trial',
      // G23: owners and managers enrol TOTP 2FA on their first visit (they may turn the policy off).
      settings: { require2fa: true },
    })
    .returning()
  if (!tenant) throw new Error('tenant insert failed')
  await tx.insert(branches).values({
    tenantId: tenant.id,
    name: input.businessName,
    isDefault: true,
    address: input.branch?.address ?? null,
    phone: input.branch?.phone ?? null,
  })
  const roleRows = await tx
    .insert(roles)
    .values(
      (Object.keys(SYSTEM_ROLES) as SystemRoleKey[]).map((key) => ({
        tenantId: tenant.id,
        key,
        name: SYSTEM_ROLES[key].name,
        description: SYSTEM_ROLES[key].description,
        isSystem: true,
        permissions: [...SYSTEM_ROLES[key].permissions],
      })),
    )
    .returning({ id: roles.id, key: roles.key })
  const owner = roleRows.find((r) => r.key === 'owner')!
  await tx.insert(members).values({ tenantId: tenant.id, userId: input.userId, roleId: owner.id })
  if (plan) {
    const start = input.subscription?.start ?? input.today
    await tx.insert(subscriptions).values({
      tenantId: tenant.id,
      planId: plan.id,
      status: active ? 'active' : 'trialing',
      priceAed: plan.priceAed,
      setupFeeAed: plan.setupFeeAed,
      billingInterval: plan.billingInterval,
      discounts: input.subscription?.discounts ?? {},
      currentPeriodStart: start,
      // The subscription price is annual (R3): an accepted spa's period is one year from its start date.
      currentPeriodEnd: active ? addMonths(start, 12) : addDays(start, plan.trialDays),
    })
  }
  // G2: a listed email becomes super-admin only once verified (usually later, on first console visit).
  await grantListedPlatformAdmins(tx, listedAdminEmails(), input.userId)
  return tenant
}

export const provisionTenant = (db: Db, input: ProvisionInput) =>
  db.transaction((tx) => provisionTenantTx(tx, input))

/** Why a web address can't be used: bad format/reserved, an existing spa, or another pending application. */
export async function slugStatus(
  db: DbOrTx,
  slug: string,
  opts: { exceptApplicationId?: string } = {},
): Promise<'free' | 'invalid' | 'tenant' | 'application'> {
  if (!checkSlug(slug).ok) return 'invalid'
  const [tenant] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug)).limit(1)
  if (tenant) return 'tenant'
  const [app] = await db
    .select({ id: spaApplications.id })
    .from(spaApplications)
    .where(
      and(
        eq(spaApplications.slug, slug),
        eq(spaApplications.status, 'pending'),
        opts.exceptApplicationId ? ne(spaApplications.id, opts.exceptApplicationId) : undefined,
      ),
    )
    .limit(1)
  return app ? 'application' : 'free'
}

export type ApplicationInput = {
  userId: string
  applicantName: string
  email: string
  /** E.164 with '+'. */
  phone: string
  spaName: string
  slug: string
  emirate: string
  streetAddress: string
  planId: string | null
  preferredStart: string
  notes?: string | null
  logo?: { bytes: Buffer; contentType: string } | null
}

export const ADMIN_EMAIL_APPLICATION =
  'This is a super-admin email address: create its login on the admin join page instead of applying for a spa.'

const isUniqueViolation = (e: unknown, constraint: string) => {
  const err = (e as { cause?: { code?: string; constraint?: string } }).cause ?? (e as { code?: string })
  return (
    (err as { code?: string }).code === '23505' && (err as { constraint?: string }).constraint === constraint
  )
}

/** Stores a new application (status pending). The caller has created / signed in the login already. */
export async function submitApplication(
  db: Db,
  input: ApplicationInput & { today: string },
  adminEmails = listedAdminEmails(),
) {
  // Owner, 2026-10-09: a PLATFORM_ADMIN_EMAILS address never applies for a spa; it joins on the admin host instead.
  if (isListedAdminEmail(input.email, adminEmails))
    throw new DomainError(ADMIN_EMAIL_APPLICATION, 'invalid', { key: 'auth.signup.errors.adminEmailField' })
  if (!isEmirate(input.emirate)) throw new DomainError('Choose an emirate')
  if (input.preferredStart < input.today) throw new DomainError('Choose a start date from today on')
  if (input.planId) {
    const [plan] = await db
      .select({ id: plans.id, code: plans.code })
      .from(plans)
      .where(and(eq(plans.id, input.planId), eq(plans.active, true)))
    // PLAN §18.8: the legacy yearly plan is never offered to a new spa.
    if (!plan || isLegacyPlan(plan)) throw new DomainError('Plan not found', 'not_found')
  }
  const [open] = await db
    .select({ id: spaApplications.id })
    .from(spaApplications)
    .where(and(eq(spaApplications.userId, input.userId), eq(spaApplications.status, 'pending')))
  if (open) throw new DomainError('You already have an application waiting for approval')
  const status = await slugStatus(db, input.slug)
  if (status === 'invalid') throw new DomainError('Use 3–40 lowercase letters, numbers or hyphens.')
  if (status !== 'free') throw new DomainError('That address is taken.')
  try {
    const [row] = await db
      .insert(spaApplications)
      .values({
        userId: input.userId,
        applicantName: input.applicantName,
        email: input.email.toLowerCase(),
        phone: input.phone,
        spaName: input.spaName,
        slug: input.slug,
        emirate: input.emirate,
        streetAddress: input.streetAddress,
        planId: input.planId,
        preferredStart: input.preferredStart,
        notes: input.notes ?? null,
        logoBytes: input.logo?.bytes ?? null,
        logoContentType: input.logo?.contentType ?? null,
      })
      .returning()
    return row!
  } catch (e) {
    if (isUniqueViolation(e, 'spa_applications_pending_slug')) throw new DomainError('That address is taken.')
    if (isUniqueViolation(e, 'spa_applications_pending_user'))
      throw new DomainError('You already have an application waiting for approval')
    throw e
  }
}

/** Platform payment methods the owner can record for the setup fee ("credit card" = `card`). */
export const SETUP_PAYMENT_METHODS = ['cash', 'bank_transfer', 'card'] as const
export type SetupPaymentMethod = (typeof SETUP_PAYMENT_METHODS)[number]

export type SetupPaymentInput = {
  kind: 'full' | 'deposit'
  /** Deposit only: more than 0 and less than the setup-fee invoice total (incl. VAT only when VAT is charged). */
  amountAed?: string | null
  /** Asia/Dubai date the money was received (≤ today). */
  paidOn: string
  method: SetupPaymentMethod
  reference?: string | null
  note?: string | null
  /** VAT on the setup invoice (owner, 2026-10-09: optional). Default: as every platform invoice (the settings' rate). */
  chargeVat?: boolean
  /** When the balance is due: the start date or 10 days after it (default). */
  balanceDue?: BalanceDue
}

const money = (n: number) => n.toFixed(2)

/**
 * Accepts a pending application in ONE platform transaction: provisions the spa (tenant, default branch with the
 * emirate/address/phone, system roles, owner membership, logo) with an ACTIVE subscription from `startDate` for one
 * year, issues the setup-fee platform invoice (numbering as every platform invoice; VAT optional; due on the start
 * date or 10 days after it), records the setup payment (full → paid; deposit → stays issued with a balance due,
 * settled later with Record payment) and issues the plan's payment schedule from the start date — the same code as
 * console "Generate payment schedule" (12 monthly or one annual invoice), so pressing it later creates nothing.
 * A plan without a setup fee skips the setup invoice and payment.
 */
export async function acceptApplication(
  db: Db,
  r: {
    applicationId: string
    reviewerId: string
    planId: string
    startDate: string
    today: string
    payment: SetupPaymentInput | null
    /** PLAN §18.8 per-spa discounts, stored on the subscription: the setup invoice and the schedule use them. */
    discounts?: SubscriptionDiscounts
  },
) {
  return db.transaction(async (tx) => {
    const [app] = await tx
      .select()
      .from(spaApplications)
      .where(eq(spaApplications.id, r.applicationId))
      .for('update')
    if (!app) throw new DomainError('Application not found', 'not_found')
    if (app.status !== 'pending') throw new DomainError('This application was already reviewed')
    const [plan] = await tx.select().from(plans).where(eq(plans.id, r.planId))
    if (!plan) throw new DomainError('Plan not found', 'not_found')
    // PLAN §18.8: the legacy yearly plan is for existing spas only (until their renewal), never a new spa.
    if (isLegacyPlan(plan)) throw new DomainError('Choose a plan that is offered to spas', 'not_found')
    const [account] = await tx
      .select({ id: user.id, disabledAt: user.disabledAt })
      .from(user)
      .where(eq(user.id, app.userId))
    if (!account || account.disabledAt) throw new DomainError('The applicant’s login is closed')
    const [taken] = await tx
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, app.slug))
      .limit(1)
    if (taken) throw new DomainError('That address is taken.')

    // Validate the setup payment before anything is numbered (invoice numbers come from a sequence: no gaps).
    const setup = discounted(plan.setupFeeAed, r.discounts?.setup)
    // A setup fee discounted to 0 is no setup fee: no invoice, no payment.
    const fee = Number(setup.amountAed)
    let pay: { amount: number; total: number; vat: boolean; input: SetupPaymentInput } | null = null
    if (fee > 0) {
      const p = r.payment
      if (!p) throw new DomainError('Record how the setup fee was paid')
      if (!/^\d{4}-\d{2}-\d{2}$/.test(p.paidOn) || p.paidOn > r.today)
        throw new DomainError('The payment date can’t be in the future')
      if (!(SETUP_PAYMENT_METHODS as readonly string[]).includes(p.method))
        throw new DomainError('Choose how it was paid')
      if (p.balanceDue && !(BALANCE_DUE_CHOICES as readonly string[]).includes(p.balanceDue))
        throw new DomainError('Choose when the balance is due')
      const [settings] = await tx.select().from(platformSettings).where(eq(platformSettings.id, 1))
      const vat = p.chargeVat ?? true
      const total = Number(invoiceTotals(Number(setup.amountAed), settings, vat).totalAed)
      const amount = p.kind === 'full' ? total : Number(p.amountAed)
      if (p.kind === 'deposit' && !(Number.isFinite(amount) && amount > 0 && amount < total))
        throw new DomainError(depositRule(total, vat))
      pay = { amount: Math.round(amount * 100) / 100, total, vat, input: p }
    }

    const emirate = isEmirate(app.emirate) ? EMIRATE_NAMES[app.emirate] : app.emirate
    const tenant = await provisionTenantTx(tx, {
      userId: app.userId,
      businessName: app.spaName,
      slug: app.slug,
      today: r.today,
      subscription: { planId: plan.id, status: 'active', start: r.startDate, discounts: r.discounts },
      branch: { address: `${app.streetAddress}, ${emirate}`, phone: app.phone },
    })

    // Before any invoice: numbers come from a sequence, so a step failing after them would leave gaps.
    if (app.logoBytes && app.logoContentType) {
      const logo = await setTenantLogo(tx, {
        tenantId: tenant.id,
        // Stored as processed by `processLogo` (always WebP).
        image: { bytes: app.logoBytes, contentType: app.logoContentType as 'image/webp' },
        createdBy: app.userId,
      })
      tenant.logoFileId = logo.fileId
    }

    let summary: SetupPaymentSummary = {
      kind: 'none',
      feeAed: plan.setupFeeAed,
      // A setup fee discounted to 0 (PLAN §18.8): no invoice, the discount is still on record.
      ...(setup.discount
        ? { discountAed: setup.discount.discountAed, discountLabel: setup.discount.label }
        : {}),
    }
    let invoice: Awaited<ReturnType<typeof createPlatformInvoice>> = null
    let balanceAed = '0.00'
    if (pay) {
      const dueDate = setupBalanceDueDate(r.startDate, pay.input.balanceDue ?? DEFAULT_BALANCE_DUE, r.today)
      invoice = await createPlatformInvoice(tx, tenant.id, {
        description: `One-time setup fee${setup.note}`,
        amountAed: setup.amountAed,
        issueDate: r.today,
        dueDate,
        kind: 'setup',
        vat: pay.vat,
        discount: setup.discount,
      })
      if (!invoice) throw new Error('setup invoice already exists')
      const recorded = await recordPlatformPayment(tx, {
        tenantId: tenant.id,
        invoiceId: invoice.id,
        amountAed: money(pay.amount),
        method: pay.input.method,
        reference: pay.input.reference ?? null,
        receivedAt: pay.input.paidOn,
        recordedBy: r.reviewerId,
        today: r.today,
        notes: pay.input.note || (pay.input.kind === 'full' ? 'Setup fee paid in full' : 'Setup fee deposit'),
      })
      balanceAed = recorded.balanceAed
      invoice = recorded.invoice ?? invoice
      summary = {
        kind: pay.input.kind,
        feeAed: plan.setupFeeAed,
        invoiceTotalAed: invoice.totalAed,
        amountAed: money(pay.amount),
        balanceAed,
        paidOn: pay.input.paidOn,
        method: pay.input.method,
        reference: pay.input.reference ?? null,
        note: pay.input.note ?? null,
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        vat: pay.vat,
        dueDate: invoice.dueDate,
        ...(setup.discount
          ? { discountAed: setup.discount.discountAed, discountLabel: setup.discount.label }
          : {}),
      }
    }

    // Subscription fees start from the start date: the plan's schedule, exactly as the console button issues it.
    const schedule = await generateBillingScheduleTx(tx, tenant.id, r.today)

    const [application] = await tx
      .update(spaApplications)
      .set({
        status: 'approved',
        planId: plan.id,
        preferredStart: r.startDate,
        reviewedBy: r.reviewerId,
        reviewedAt: new Date(),
        createdTenantId: tenant.id,
        setupPayment: summary,
      })
      .where(eq(spaApplications.id, app.id))
      .returning()
    return {
      application: application!,
      tenant,
      plan,
      invoice,
      balanceAed,
      setupPayment: summary,
      planInvoices: schedule.created,
    }
  })
}

/**
 * Rejects a pending application. The login is disabled and its sessions revoked — unless the same login is also an
 * active member of another spa or a super-admin (then only the application closes).
 */
export async function rejectApplication(
  db: Db,
  r: { applicationId: string; reviewerId: string; reason?: string | null; shareReason?: boolean },
) {
  return db.transaction(async (tx) => {
    const [app] = await tx
      .select()
      .from(spaApplications)
      .where(eq(spaApplications.id, r.applicationId))
      .for('update')
    if (!app) throw new DomainError('Application not found', 'not_found')
    if (app.status !== 'pending') throw new DomainError('This application was already reviewed')
    const reason = r.reason?.trim() || null
    const [application] = await tx
      .update(spaApplications)
      .set({
        status: 'rejected',
        rejectionReason: reason,
        shareReason: Boolean(reason && r.shareReason),
        reviewedBy: r.reviewerId,
        reviewedAt: new Date(),
      })
      .where(eq(spaApplications.id, app.id))
      .returning()
    const [member] = await tx
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.userId, app.userId), eq(members.status, 'active')))
      .limit(1)
    const [admin] = await tx
      .select({ id: platformAdmins.userId })
      .from(platformAdmins)
      .where(eq(platformAdmins.userId, app.userId))
    const disabled = !member && !admin
    let sessionsRevoked = 0
    if (disabled) {
      await tx.update(user).set({ disabledAt: new Date() }).where(eq(user.id, app.userId))
      const gone = await tx
        .delete(session)
        .where(eq(session.userId, app.userId))
        .returning({ id: session.id })
      sessionsRevoked = gone.length
    }
    return { application: application!, disabled, sessionsRevoked }
  })
}

/** The newest application of a login (pending first), for the applicant's waiting page and sign-in notice. */
export async function latestApplication(db: DbOrTx, userId: string) {
  const [row] = await db
    .select()
    .from(spaApplications)
    .where(eq(spaApplications.userId, userId))
    .orderBy(sql`${spaApplications.status} = 'pending' desc`, sql`${spaApplications.createdAt} desc`)
    .limit(1)
  return row ?? null
}

export async function pendingApplicationCount(db: DbOrTx) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(spaApplications)
    .where(eq(spaApplications.status, 'pending'))
  return row?.n ?? 0
}
