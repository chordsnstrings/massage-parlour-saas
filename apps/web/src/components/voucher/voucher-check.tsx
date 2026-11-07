// F15: public gift-voucher check page (`/voucher/{token}` on the spa's site; the voucher's QR opens it). Shows
// validity, balance, expiry and the treatment only — never who bought it or who it is for. Per-IP rate limited.
// Tenant-site copy: EN + AR.
import { tenants, withTenant } from '@spa/db'
import { logoUrl, voucherCheck } from '@spa/services'
import { eq } from 'drizzle-orm'
import { Gift } from 'lucide-react'
import type { Metadata } from 'next'
import { fmtAed, intlLocale, type Locale, localeOf, pick } from '@/components/booking/i18n'
import { Card } from '@/components/ui/card'
import { withinIpLimit } from '@/server/rate-limit'

type Tenant = { id: string; slug: string; name: string; status: string }

const T = {
  title: { en: 'Gift voucher', ar: 'قسيمة هدية' },
  valid: { en: 'Valid', ar: 'صالحة' },
  used: { en: 'Fully used', ar: 'مستخدمة بالكامل' },
  expired: { en: 'Expired', ar: 'منتهية الصلاحية' },
  void: { en: 'No longer valid', ar: 'لم تعد صالحة' },
  balance: { en: 'Balance', ar: 'الرصيد' },
  of: { en: 'of {value}', ar: 'من {value}' },
  treatment: { en: 'Treatment', ar: 'العلاج' },
  expires: { en: 'Valid until', ar: 'صالحة حتى' },
  code: { en: 'Code ending', ar: 'رمز ينتهي بـ' },
  redeem: {
    en: 'Show the voucher (or its code) at reception to use it.',
    ar: 'أظهر القسيمة (أو رمزها) في الاستقبال لاستخدامها.',
  },
  book: { en: 'Book a treatment', ar: 'احجز جلستك' },
  notFound: {
    en: 'We could not find this voucher. Please check the link or ask the spa.',
    ar: 'لم نعثر على هذه القسيمة. يرجى التحقق من الرابط أو التواصل مع السبا.',
  },
  tooMany: {
    en: 'Too many checks from your connection. Please try again later.',
    ar: 'عمليات تحقق كثيرة من اتصالك. يرجى المحاولة لاحقاً.',
  },
  language: { en: 'العربية', ar: 'English' },
} as const
const tr = (k: keyof typeof T, l: Locale) => T[k][l]

/** Per visitor IP (IPv6 /64): 30 checks in 10 minutes, 200 a day (production; off with AUTH_RATE_LIMIT=off). */
const LIMITS = [
  [30, 600],
  [200, 86_400],
] as const

export function voucherMetadata(tenant: Tenant | null, lang: string | string[] | undefined): Metadata {
  const title = tenant ? `${tr('title', localeOf(lang))} · ${tenant.name}` : 'Not found'
  return { title: { absolute: title }, robots: { index: false, follow: false }, referrer: 'no-referrer' }
}

export async function VoucherCheckPage({
  tenant,
  token,
  base,
  lang,
}: {
  tenant: Tenant
  token: string
  /** Site path prefix ('/s/{slug}' on a single host, '' otherwise). */
  base: string
  lang: string | string[] | undefined
}) {
  const locale = localeOf(lang)
  const allowed = await withinIpLimit('voucher-check', LIMITS)
  const data = allowed
    ? await withTenant(tenant.id, async (tx) => {
        const [spa] = await tx
          .select({ logo: tenants.logoFileId })
          .from(tenants)
          .where(eq(tenants.id, tenant.id))
        return { voucher: await voucherCheck(tx, token), logo: logoUrl(spa?.logo) }
      })
    : null
  const v = data?.voucher ?? null
  const date = (d: Date) =>
    new Intl.DateTimeFormat(intlLocale(locale), {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Asia/Dubai',
    }).format(d)
  const tone = v?.status === 'valid' ? 'bg-accent-soft text-accent' : 'bg-danger-soft text-danger'
  const suffix = locale === 'ar' ? '?lang=ar' : ''

  return (
    <main
      dir={locale === 'ar' ? 'rtl' : 'ltr'}
      lang={locale}
      className="grid min-h-dvh place-items-center bg-bg px-4 py-12"
    >
      <Card className="anim-fade-in w-full max-w-md p-6 sm:p-8" data-testid="voucher-check">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {data?.logo ? (
              <>
                {/* biome-ignore lint/performance/noImgElement: the spa's own logo, already small */}
                <img src={data.logo} alt="" className="size-10 rounded-md object-contain" />
              </>
            ) : (
              <Gift aria-hidden className="size-6 text-accent" strokeWidth={1.6} />
            )}
            <div className="min-w-0">
              <p className="truncate font-semibold">{tenant.name}</p>
              <p className="text-sm text-muted">{tr('title', locale)}</p>
            </div>
          </div>
          <a
            href={`${base}/voucher/${encodeURIComponent(token)}${locale === 'ar' ? '' : '?lang=ar'}`}
            className="text-sm text-accent underline-offset-4 hover:underline"
            lang={locale === 'ar' ? 'en' : 'ar'}
          >
            {tr('language', locale)}
          </a>
        </div>

        {!allowed ? (
          <p className="mt-6 text-sm">{tr('tooMany', locale)}</p>
        ) : !v ? (
          <p className="mt-6 text-sm">{tr('notFound', locale)}</p>
        ) : (
          <div className="mt-6 space-y-4">
            <span className={`inline-flex rounded-full px-3 py-1 text-sm font-medium ${tone}`}>
              {tr(v.status, locale)}
            </span>
            {v.treatment && (
              <div>
                <p className="text-sm text-muted">{tr('treatment', locale)}</p>
                <p className="text-lg font-semibold">{pick(v.treatment, locale)}</p>
              </div>
            )}
            <div>
              <p className="text-sm text-muted">{tr('balance', locale)}</p>
              <p className="text-3xl font-semibold tabular-nums" data-testid="voucher-balance">
                {fmtAed(Number(v.balanceAed), locale)}
              </p>
              <p className="text-sm text-muted">
                {tr('of', locale).replace('{value}', fmtAed(Number(v.initialAed), locale))}
              </p>
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              {v.expiresAt && (
                <div>
                  <dt className="text-muted">{tr('expires', locale)}</dt>
                  <dd className="font-medium">{date(v.expiresAt)}</dd>
                </div>
              )}
              <div>
                <dt className="text-muted">{tr('code', locale)}</dt>
                <dd className="font-mono font-medium" dir="ltr">
                  ••••{v.codeHint}
                </dd>
              </div>
            </dl>
            {v.status === 'valid' && <p className="text-sm text-muted">{tr('redeem', locale)}</p>}
          </div>
        )}

        <a
          href={`${base}/book${suffix}`}
          className="mt-6 inline-flex h-10 w-full items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-accent-fg"
        >
          {tr('book', locale)}
        </a>
      </Card>
    </main>
  )
}
