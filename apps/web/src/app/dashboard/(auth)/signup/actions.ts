'use server'
import { getAuth } from '@spa/auth'
import { checkSlug, normalizeSlug } from '@spa/core'
import { withTenant } from '@spa/db'
import { DomainError, type ProcessedImage, processLogo, setTenantLogo } from '@spa/services'
import { APIError } from 'better-auth/api'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { type ActionResult, fail, failDomain, formObject, fromZod } from '@/lib/action'
import { appPath } from '@/lib/paths'
import { audit } from '@/server/audit'
import { isSlugAvailable, provisionTenant } from '@/server/provision'
import { getSession } from '@/server/session'

const business = z.object({
  businessName: z.string().trim().min(2, 'Enter your spa’s name').max(80),
  slug: z.string().trim().min(1, 'Choose a web address'),
})
const account = business.extend({
  name: z.string().trim().min(2, 'Enter your name').max(80),
  email: z.email('Enter a valid email').transform((e) => e.toLowerCase()),
  password: z.string().min(10, 'Use at least 10 characters').max(128),
})

export async function checkSlugAction(
  input: string,
): Promise<{ slug: string; ok: boolean; reason?: string }> {
  const slug = normalizeSlug(input)
  const check = checkSlug(slug)
  if (!check.ok) return { slug, ok: false, reason: check.reason }
  return (await isSlugAvailable(slug))
    ? { slug, ok: true }
    : { slug, ok: false, reason: 'That address is taken.' }
}

export async function signupAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const session = await getSession()
  const parsed = (session ? business : account).safeParse(formObject(formData))
  if (!parsed.success) return fromZod(parsed.error)
  const slug = normalizeSlug(parsed.data.slug)
  const slugCheck = await checkSlugAction(slug)
  if (!slugCheck.ok)
    return fail(slugCheck.reason ?? 'Choose another address.', { slug: slugCheck.reason ?? '' })

  // Optional logo: validated before the account exists, stored once the spa is provisioned.
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

  let user: { id: string; email: string } | undefined = session?.user
  if (!user) {
    const data = parsed.data as z.infer<typeof account>
    try {
      const res = await getAuth().api.signUpEmail({
        body: { name: data.name, email: data.email, password: data.password },
        headers: await headers(),
      })
      user = { id: res.user.id, email: res.user.email }
    } catch (e) {
      if (e instanceof APIError) {
        const exists = /exist/i.test(e.message)
        return fail(
          exists ? 'An account with this email already exists. Sign in instead.' : e.message,
          exists ? { email: 'Already registered' } : undefined,
        )
      }
      throw e
    }
  }
  if (!user) return fail('Could not create your account.')

  let tenantId: string
  try {
    const tenant = await provisionTenant({
      userId: user.id,
      email: user.email,
      businessName: parsed.data.businessName,
      slug,
    })
    tenantId = tenant.id
    if (logo) {
      const image = logo
      const createdBy = user.id
      await withTenant(tenant.id, (tx) => setTenantLogo(tx, { tenantId: tenant.id, image, createdBy }))
    }
  } catch (e) {
    if (String((e as { cause?: { code?: string } }).cause?.code) === '23505')
      return fail('That address is taken.', { slug: 'That address is taken.' })
    throw e
  }
  await audit({
    tenantId,
    actorUserId: user.id,
    action: 'tenant.created',
    entity: 'tenant',
    entityId: tenantId,
    data: { slug, logo: Boolean(logo) },
  })
  redirect(appPath(`/${slug}`))
}
