'use server'
// "Apply for your spa" (PLAN §18.3): the login is created now; the spa only once the platform owner accepts.
import { getAuth } from '@spa/auth'
import { checkSlug, isEmirate, normalizeSlug, toUaeE164 } from '@spa/core'
import { plans, platformDb } from '@spa/db'
import { DomainError, type ProcessedImage, processLogo, submitApplication } from '@spa/services'
import { APIError } from 'better-auth/api'
import { and, eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getT } from '@/i18n/server'
import { type ActionResult, fail, failDomain, formObject, fromZod } from '@/lib/action'
import { appPath } from '@/lib/paths'
import { todayDubai } from '@/lib/utils'
import { applicantState, emailNewApplication, isSlugAvailable } from '@/server/applications'
import { audit } from '@/server/audit'
import { getSession } from '@/server/session'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'auth.signup.errors.start')
const business = z.object({
  businessName: z.string().trim().min(2, 'auth.signup.errors.businessName').max(80),
  slug: z.string().trim().min(1, 'auth.signup.errors.slug'),
  phone: z
    .string()
    .trim()
    .transform((v) => toUaeE164(v))
    .refine((v): v is string => v !== null, 'auth.signup.errors.phone'),
  emirate: z.string().refine(isEmirate, 'auth.signup.errors.emirate'),
  street: z.string().trim().min(3, 'auth.signup.errors.street').max(200),
  planId: z.string().optional(),
  start: date,
  notes: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .transform((v) => v || null),
})
const account = business.extend({
  name: z.string().trim().min(2, 'auth.signup.errors.name').max(80),
  email: z.email('validation.email').transform((e) => e.toLowerCase()),
  password: z.string().min(10, 'auth.signup.errors.password').max(128),
})

/** `checkSlug` (packages/core) reasons → auth keys. */
const SLUG_REASON: Record<string, 'auth.signup.errors.slugFormat' | 'auth.signup.errors.reserved'> = {
  'Use 3–40 lowercase letters, numbers or hyphens.': 'auth.signup.errors.slugFormat',
  'This name is reserved.': 'auth.signup.errors.reserved',
}

/** Live availability: format/reserved, an existing spa, or a web address held by another pending application. */
export async function checkSlugAction(
  input: string,
): Promise<{ slug: string; ok: boolean; reason?: string }> {
  const slug = normalizeSlug(input)
  const t = await getT()
  const check = checkSlug(slug)
  if (!check.ok) {
    const key = SLUG_REASON[check.reason]
    return { slug, ok: false, reason: key ? t(key) : check.reason }
  }
  return (await isSlugAvailable(slug))
    ? { slug, ok: true }
    : { slug, ok: false, reason: t('auth.signup.errors.taken') }
}

export async function signupAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const session = await getSession()
  if (session && (await applicantState(session.user.id)).application?.status === 'pending')
    redirect(appPath('/application'))
  const parsed = (session ? business : account).safeParse(formObject(formData))
  if (!parsed.success) return fromZod(parsed.error)
  const d = parsed.data
  const slug = normalizeSlug(d.slug)
  const slugCheck = await checkSlugAction(slug)
  if (!slugCheck.ok)
    return fail(slugCheck.reason ?? 'auth.signup.errors.chooseAnother', { slug: slugCheck.reason ?? '' })
  const today = todayDubai()
  if (d.start < today) return fail('auth.signup.errors.start', { start: 'auth.signup.errors.start' })
  // A plan is chosen from the active ones (none configured yet → the owner picks one when accepting).
  const active = await platformDb().select({ id: plans.id }).from(plans).where(eq(plans.active, true))
  let planId: string | null = null
  if (active.length) {
    const chosen = z.uuid().safeParse(d.planId).data
    const [plan] = chosen
      ? await platformDb()
          .select({ id: plans.id })
          .from(plans)
          .where(and(eq(plans.id, chosen), eq(plans.active, true)))
      : []
    if (!plan) return fail('auth.signup.errors.plan', { planId: 'auth.signup.errors.plan' })
    planId = plan.id
  }

  // Optional logo: validated before the account exists, stored as the spa's logo once accepted.
  let logo: ProcessedImage | undefined
  const logoFile = formData.get('logo')
  if (logoFile instanceof File && logoFile.size > 0) {
    try {
      logo = await processLogo(Buffer.from(await logoFile.arrayBuffer()))
    } catch (e) {
      if (e instanceof DomainError) return failDomain(e, { logo: e.i18n?.key ?? e.message })
      throw e
    }
  }

  let user: { id: string; email: string; name: string } | undefined = session?.user
  if (!user) {
    const data = d as z.infer<typeof account>
    try {
      const res = await getAuth().api.signUpEmail({
        body: { name: data.name, email: data.email, password: data.password },
        headers: await headers(),
      })
      user = { id: res.user.id, email: res.user.email, name: res.user.name }
    } catch (e) {
      if (e instanceof APIError) {
        const exists = /exist/i.test(e.message)
        if (exists) return fail('auth.signup.errors.exists', { email: 'auth.signup.errors.registered' })
        const code = (e.body as { code?: string } | undefined)?.code
        const t = await getT()
        return fail((code && t.maybe(`auth.errors.${code}`)) || e.message)
      }
      throw e
    }
  }
  if (!user) return fail('auth.signup.errors.failed')

  let application: Awaited<ReturnType<typeof submitApplication>>
  try {
    application = await submitApplication(platformDb(), {
      userId: user.id,
      applicantName: user.name,
      email: user.email,
      phone: `+${d.phone}`,
      spaName: d.businessName,
      slug,
      emirate: d.emirate,
      streetAddress: d.street,
      planId,
      preferredStart: d.start,
      notes: d.notes,
      logo: logo ? { bytes: logo.bytes, contentType: logo.contentType } : null,
      today,
    })
  } catch (e) {
    if (e instanceof DomainError) return failDomain(e)
    throw e
  }
  await audit({
    actorUserId: user.id,
    action: 'platform.application.submitted',
    entity: 'spa_application',
    entityId: application.id,
    data: { slug, spaName: d.businessName, planId, preferredStart: d.start, logo: Boolean(logo) },
  })
  await emailNewApplication(application)
  redirect(appPath('/application'))
}
