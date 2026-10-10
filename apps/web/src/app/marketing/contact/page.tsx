import { PLATFORM_CONTACT_EMAIL } from '@spa/core'
import { ENQUIRY_MESSAGE_MAX } from '@spa/services'
import { Mail, MessageCircle, Phone } from 'lucide-react'
import type { Metadata } from 'next'
import { EnquiryForm } from '@/components/marketing/enquiry-form'
import { companyContact } from '@/components/marketing/plans'
import { marketingMetadata } from '@/components/marketing/seo'
import { MarketingShell } from '@/components/marketing/shell'
import { appUrl } from '@/server/origin'
import { turnstileSiteKey } from '@/server/turnstile'
import { sendEnquiryAction } from './actions'

export const metadata: Metadata = marketingMetadata('contact', {
  title: 'Contact',
  description: 'Talk to the spamanagement.co team in Dubai.',
})
export const dynamic = 'force-dynamic' // contact details are edited in the super-admin

const digits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '')

export default async function ContactPage() {
  const c = await companyContact()
  const wa = digits(c?.whatsapp) || digits(c?.phone)
  // The console's company email wins when set (PLAN §18.4).
  const email = c?.email || PLATFORM_CONTACT_EMAIL
  const cards = [
    wa && {
      icon: MessageCircle,
      title: 'WhatsApp',
      text: 'The quickest way to reach us.',
      href: `https://wa.me/${wa}?text=${encodeURIComponent('Hi! I’d like to know more about spamanagement.co.')}`,
      label: 'Message us',
    },
    {
      icon: Mail,
      title: 'Email',
      text: 'We reply within one working day.',
      href: `mailto:${email}`,
      label: email,
    },
    c?.phone && {
      icon: Phone,
      title: 'Phone',
      text: 'Sunday to Thursday, 9:00–18:00 Dubai time.',
      href: `tel:+${digits(c.phone)}`,
      label: c.phone,
    },
  ].filter(Boolean) as {
    icon: typeof Mail
    title: string
    text: string
    href: string
    label: string
  }[]

  return (
    <MarketingShell active="contact">
      <section className="mkt-wrap pt-20 pb-24 sm:pt-28">
        <p data-depth="0.03" className="mkt-eyebrow mkt-rise">
          Contact
        </p>
        <h1
          data-depth="0.06"
          className="mkt-h1 mkt-rise mt-6 max-w-3xl"
          style={{ '--d': 1 } as React.CSSProperties}
        >
          Talk to a real person.
        </h1>
        <p data-depth="0.08" className="mkt-hsub mkt-rise" style={{ '--d': 2 } as React.CSSProperties}>
          We set up your spa with you — menu, staff, website and your first import — usually in one visit.
        </p>
        <div className="mt-14 grid items-start gap-[18px] lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <EnquiryForm
            action={sendEnquiryAction}
            maxLength={ENQUIRY_MESSAGE_MAX}
            turnstileSiteKey={await turnstileSiteKey()}
          />
          <div className="grid gap-[18px] sm:grid-cols-2 lg:grid-cols-1">
            {cards.map((k) => (
              <a key={k.title} href={k.href} data-rise="card" className="mkt-card block">
                <span className="mkt-mi">
                  <k.icon strokeWidth={1.7} />
                </span>
                <h2 className="text-[21px]">{k.title}</h2>
                <p className="mt-2">{k.text}</p>
                <p className="mt-5 inline-block text-[15px] font-semibold break-all text-[var(--accent-ink)]">
                  {k.label}
                </p>
              </a>
            ))}
          </div>
        </div>
        {c?.address && <p className="mt-12 text-[14px] text-[var(--mute)]">{c.address}</p>}
        <p className="mt-10 text-[15px] text-[var(--muted)]">
          Already a customer?{' '}
          <a href={await appUrl('/login')} className="mkt-link font-semibold text-[var(--text)]">
            Sign in
          </a>
        </p>
      </section>
    </MarketingShell>
  )
}
