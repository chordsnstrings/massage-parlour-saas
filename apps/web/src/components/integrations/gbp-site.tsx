import type { GbpBookView, GbpSearchConsoleView, GoogleErrorCode } from '@spa/services'
import { CalendarCheck2, Search } from 'lucide-react'
import { Pill } from '@/components/crm'
import { getI18n } from '@/i18n/server'
import { ConnectGoogleButton } from './gbp-card-actions'
import { BookButtonActions, SubmitSitemapButton } from './gbp-site-actions'

/**
 * F17 on the Google Business Profile card: the "Book" button on the Google listing (Place Actions) and Search Console
 * sitemap submission. Premium ('marketing'); a Standard spa sees the Premium label instead of the buttons.
 */
export async function GbpSiteSection({
  slug,
  book,
  sc,
  manage,
  premium,
  bookingUrl,
  sitemapUrl,
}: {
  slug: string
  book: GbpBookView | null
  sc: GbpSearchConsoleView | null
  manage: boolean
  premium: boolean
  bookingUrl: string
  sitemapUrl: string
}) {
  const { t, fmt } = await getI18n()
  const reason = (code: GoogleErrorCode | null) =>
    code
      ? t('settings.integrations.google.error', { reason: t(`settings.integrations.google.errors.${code}`) })
      : ''
  const premiumPill = !premium && <Pill tone="info">{t('plan.premiumBadge')}</Pill>
  return (
    <div className="space-y-4 border-t pt-4" data-testid="gbp-site">
      {book && (
        <section className="space-y-2" data-testid="gbp-book">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <CalendarCheck2 className="size-4 text-muted" strokeWidth={1.5} />
            {t('settings.integrations.google.book.title')}
            {book.enabled && !book.error && (
              <Pill tone="ok">{t('settings.integrations.google.book.live')}</Pill>
            )}
            {book.enabled && book.error && (
              <Pill tone="bad">{t('settings.integrations.google.book.failed')}</Pill>
            )}
            {premiumPill}
          </h3>
          {!book.enabled ? (
            <p className="text-[13px] text-muted">{t('settings.integrations.google.book.off')}</p>
          ) : (
            <p className="break-all text-[13px] text-muted">
              {t('settings.integrations.google.book.points', { url: book.uri ?? bookingUrl })}
              {book.syncedAt &&
                ` · ${t('settings.integrations.google.book.synced', { when: fmt.dateTime(book.syncedAt) })}`}
            </p>
          )}
          {book.error && (
            <p className="text-[13px] text-danger" role="alert" title={book.detail ?? undefined}>
              {reason(book.error)}
            </p>
          )}
          {manage && premium && <BookButtonActions slug={slug} enabled={book.enabled} />}
        </section>
      )}
      {sc && (
        <section className="space-y-2" data-testid="gbp-search-console">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <Search className="size-4 text-muted" strokeWidth={1.5} />
            {t('settings.integrations.google.sc.title')}
            {sc.state === 'submitted' && (
              <Pill tone="ok">{t('settings.integrations.google.sc.submittedPill')}</Pill>
            )}
            {premiumPill}
          </h3>
          <p className="text-[13px] text-muted">{t('settings.integrations.google.sc.sub')}</p>
          {!sc.hasScope ? (
            <p className="text-[13px] text-warning">{t('settings.integrations.google.sc.needsScope')}</p>
          ) : (
            <>
              {sc.state === 'submitted' && sc.submittedAt && (
                <p className="break-all text-[13px]">
                  {t('settings.integrations.google.sc.lastSubmitted', {
                    when: fmt.dateTime(sc.submittedAt),
                    site: sc.siteUrl ?? '',
                  })}
                  {sc.pending && ` · ${t('settings.integrations.google.sc.pending')}`}
                </p>
              )}
              {sc.state && sc.state !== 'submitted' && sc.state !== 'error' && (
                <p className="break-all text-[13px] text-warning">
                  {t(`settings.integrations.google.sc.state.${sc.state}`)}
                  {sc.siteUrl && ` (${sc.siteUrl})`}
                </p>
              )}
              {sc.state === 'error' && sc.error && (
                <p className="text-[13px] text-danger" role="alert" title={sc.detail ?? undefined}>
                  {reason(sc.error)}
                </p>
              )}
              {sc.due && (
                <p className="text-[13px] text-muted">{t('settings.integrations.google.sc.queued')}</p>
              )}
              <p className="break-all text-xs text-muted">
                {t('settings.integrations.google.sc.sitemap', { url: sc.sitemapUrl ?? sitemapUrl })}
              </p>
            </>
          )}
          {manage && premium && (
            <div className="flex flex-wrap gap-2">
              {sc.hasScope ? (
                <SubmitSitemapButton slug={slug} />
              ) : (
                <ConnectGoogleButton slug={slug} label={t('settings.integrations.gbp.reconnect')} />
              )}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
