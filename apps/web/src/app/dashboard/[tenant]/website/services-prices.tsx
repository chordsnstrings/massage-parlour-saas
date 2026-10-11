import { serviceCategories, services, serviceVariants, withTenant } from '@spa/db'
import { asc } from 'drizzle-orm'
import { ArrowRight, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { Card, ListRow, Pill } from '@/components/crm'
import { EmptyState } from '@/components/ui/page'
import { getI18n } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { can, type MemberContext } from '@/server/access'
import { toServiceInput } from '../services/constants'
import { ServiceSheet } from '../services/services-client'

/**
 * Spa's Website page (PLAN §18.1, R23): the studio (super-admin, console) designs and publishes the site; the spa keeps
 * its services and prices current here. The site's service/price blocks read these rows live (no publish).
 */
export async function ServicesPricesCard({ ctx }: { ctx: MemberContext }) {
  const { t, fmt } = await getI18n()
  const slug = ctx.tenant.slug
  const canEdit = can(ctx, 'services.manage')
  const data = await withTenant(ctx.tenant.id, async (tx) => ({
    categories: await tx
      .select({ id: serviceCategories.id, name: serviceCategories.name })
      .from(serviceCategories)
      .orderBy(asc(serviceCategories.sort), asc(serviceCategories.createdAt)),
    services: await tx.select().from(services).orderBy(asc(services.sort), asc(services.createdAt)),
    variants: await tx
      .select({
        id: serviceVariants.id,
        serviceId: serviceVariants.serviceId,
        durationMin: serviceVariants.durationMin,
        priceAed: serviceVariants.priceAed,
      })
      .from(serviceVariants)
      .orderBy(asc(serviceVariants.sort), asc(serviceVariants.durationMin)),
  }))
  const categoryOptions = data.categories.map((c) => ({ id: c.id, name: c.name.en }))
  const list = data.services.map((s) =>
    toServiceInput(
      s,
      data.variants.filter((v) => v.serviceId === s.id),
    ),
  )
  const groups = [
    ...data.categories.map((c) => ({
      id: c.id,
      name: c.name.en,
      items: list.filter((s) => s.categoryId === c.id),
    })),
    {
      id: 'none',
      name: t('services.uncategorised'),
      items: list.filter((s) => !s.categoryId || !data.categories.some((c) => c.id === s.categoryId)),
    },
  ].filter((g) => g.items.length > 0)

  return (
    <Card
      title={t('website.menu.title')}
      sub={canEdit ? t('website.menu.sub') : t('website.menu.readOnly')}
      actions={
        canEdit && (
          <Link
            href={appPath(`/${slug}/services`)}
            className="crm-muted inline-flex items-center gap-1 text-sm hover:text-fg"
          >
            {t('website.menu.allServices')} <ArrowRight className="size-3.5 rtl:rotate-180" />
          </Link>
        )
      }
    >
      {groups.length === 0 ? (
        <EmptyState
          icon={<Sparkles className="size-5" />}
          title={t('website.menu.emptyTitle')}
          description={t('website.menu.emptyBody')}
        />
      ) : (
        groups.map((g) => (
          <section key={g.id} aria-label={g.name}>
            {groups.length > 1 && <p className="crm-ey mt-3">{g.name}</p>}
            {g.items.map((s) => {
              const onSite = s.active && s.onlineBookable && s.variants.length > 0
              return (
                <ListRow
                  key={s.id}
                  title={s.name.en}
                  body={
                    <span className="crm-num">
                      {s.variants
                        .map((v) =>
                          t('services.variant', {
                            min: v.durationMin,
                            price: v.priceAed == null ? t('common.priceOnRequest') : fmt.aed(v.priceAed),
                          }),
                        )
                        .join(', ')}
                    </span>
                  }
                  end={
                    <span className="flex items-center gap-2">
                      <Pill tone={onSite ? 'ok' : 'neutral'} dot>
                        {onSite ? t('website.menu.onSite') : t('website.menu.notOnSite')}
                      </Pill>
                      {canEdit && (
                        <ServiceSheet slug={slug} categories={categoryOptions} service={s} menuOnly />
                      )}
                    </span>
                  }
                />
              )
            })}
          </section>
        ))
      )}
    </Card>
  )
}
