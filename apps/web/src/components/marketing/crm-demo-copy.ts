// Labels for the /crm language demo, taken from the spa dashboard's real catalogues (@spa/core/i18n) on the server,
// so the client demo ships only these few strings and never hand-typed Thai. Names (clients, therapists,
// treatments) are typed by the spa and stay untranslated in both languages — the dashboard's rule.
import { createFormat, type Locale, translator } from '@spa/core/i18n'

/** Typed by the spa: shown as-is in every language. */
const BOOKINGS = [
  {
    client: 'Layla',
    service: 'Hot stone ritual',
    min: 90,
    therapist: 'Mei',
    time: '14:30',
    status: 'checked_in',
  },
  {
    client: 'Sara',
    service: 'Swedish massage',
    min: 60,
    therapist: 'Aya',
    time: '16:00',
    status: 'confirmed',
  },
  {
    client: 'Noura',
    service: 'Thai massage',
    min: 90,
    therapist: 'Ravi',
    time: '18:30',
    status: 'pending',
  },
  // A walk-in has no typed name: the dashboard's own "Walk-in" label is translated.
  {
    client: null,
    service: 'Foot reflexology',
    min: 60,
    therapist: 'Noor',
    time: '20:00',
    status: 'confirmed',
  },
] as const
const SALE = [
  { name: 'Hot stone ritual', aed: 480 },
  { name: 'Aromatherapy oil', aed: 95 },
] as const
const TIP = 50

export type CrmDemoCopy = ReturnType<typeof build>

function build(locale: Locale) {
  const t = translator(locale)
  const fmt = createFormat(locale)
  // As on the real till: Total is the sale; tips show on their own line and only the button adds them.
  const total = SALE.reduce((s, l) => s + l.aed, 0)
  return {
    locale,
    language: t('shell.language'),
    title: t('overview.metaTitle'),
    todayCount: t('nav.count.calendar', { count: 14 }),
    groups: [
      {
        label: t('nav.group.workspace'),
        items: [
          { key: 'dashboard', label: t('nav.dashboard'), active: true },
          { key: 'calendar', label: t('nav.calendar'), badge: 14 },
          { key: 'bookings', label: t('nav.bookings') },
          { key: 'sales', label: t('nav.sales') },
          { key: 'inbox', label: t('nav.inbox') },
        ],
      },
      {
        label: t('nav.group.people'),
        items: [
          { key: 'clients', label: t('nav.clients') },
          { key: 'services', label: t('nav.services') },
          { key: 'team', label: t('nav.team') },
        ],
      },
      {
        label: t('nav.group.finance'),
        items: [
          { key: 'accounts', label: t('nav.accounts') },
          { key: 'vatPayroll', label: t('nav.vatPayroll') },
        ],
      },
    ] as { label: string; items: { key: string; label: string; active?: boolean; badge?: number }[] }[],
    upNext: {
      title: t('overview.upNext.title'),
      sub: t('overview.upNext.sub'),
      therapist: t('overview.upNext.therapist'),
      rows: BOOKINGS.map((b) => ({
        key: `${b.therapist}-${b.time}`,
        client: b.client ?? t('overview.upNext.walkIn'),
        typedClient: b.client !== null,
        service: b.service,
        line: t('overview.upNext.serviceLine', { service: b.service, min: b.min }),
        therapist: b.therapist,
        when: t('overview.upNext.today', { time: b.time }),
        status: t(`enums.bookingStatus.${b.status}`),
        tone: b.status,
      })),
    },
    checkout: {
      title: t('sales.checkout.title'),
      lines: SALE.map((l) => ({ name: l.name, amount: fmt.aed(l.aed) })),
      tips: t('sales.checkout.tipsLine'),
      tipAmount: `+${fmt.aed(TIP)}`,
      subtotal: t('sales.checkout.subtotal'),
      subtotalAmount: fmt.aed(total),
      vat: t('sales.checkout.vatIncluded'),
      vatAmount: fmt.aed(Math.round((total - total / 1.05) * 100) / 100),
      total: t('sales.checkout.total'),
      totalAmount: fmt.aed(total),
      methods: [t('enums.paymentMethodKind.cash'), t('enums.paymentMethodKind.card_terminal')],
      complete: t('sales.checkout.complete', { amount: fmt.aed(total + TIP) }),
    },
  }
}

export const crmDemoCopy = (): Record<Locale, CrmDemoCopy> => ({ en: build('en'), th: build('th') })
