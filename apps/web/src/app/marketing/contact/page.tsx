import { Mail, MessageCircle, Phone } from 'lucide-react'
import type { Metadata } from 'next'
import { companyContact } from '@/components/marketing/plans'
import { MarketingShell } from '@/components/marketing/shell'
import { appUrl } from '@/lib/paths'

export const metadata: Metadata = {
  title: 'Contact',
  description: 'Talk to the Spa Management team in Dubai.',
}
export const dynamic = 'force-dynamic' // contact details are edited in the super-admin

const digits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '')

export default async function ContactPage() {
  const c = await companyContact()
  const wa = digits(c?.whatsapp) || digits(c?.phone)
  const email = c?.email || 'hello@spamanagement.ae'
  const cards = [
    wa && {
      icon: MessageCircle,
      title: 'WhatsApp',
      text: 'The quickest way to reach us.',
      href: `https://wa.me/${wa}?text=${encodeURIComponent('Hi! I’d like to know more about Spa Management.')}`,
      label: 'Message us',
      tint: 'tint-sage',
    },
    {
      icon: Mail,
      title: 'Email',
      text: 'We reply within one working day.',
      href: `mailto:${email}`,
      label: email,
      tint: 'tint-mist',
    },
    c?.phone && {
      icon: Phone,
      title: 'Phone',
      text: 'Sunday to Thursday, 9:00–18:00 Dubai time.',
      href: `tel:+${digits(c.phone)}`,
      label: c.phone,
      tint: 'tint-clay',
    },
  ].filter(Boolean) as {
    icon: typeof Mail
    title: string
    text: string
    href: string
    label: string
    tint: string
  }[]

  return (
    <MarketingShell active="contact">
      <section className="mkt-wrap pt-20 pb-24 sm:pt-28">
        <p className="mkt-eyebrow mkt-rise">Contact</p>
        <h1 className="mkt-rise mt-4 max-w-2xl text-[38px] leading-[1.06] font-semibold tracking-tight sm:text-[56px]">
          Talk to a real person.
        </h1>
        <p className="mkt-rise mt-5 max-w-lg text-[17px] text-[var(--ink-2)]">
          We set up your spa with you — menu, staff, website and your first import — usually in one visit.
        </p>
        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((k) => (
            <a key={k.title} href={k.href} className={`mkt-card group block p-7 ${k.tint}`}>
              <k.icon className="size-5 text-[var(--ink-2)]" strokeWidth={1.5} />
              <h2 className="mt-6 font-medium">{k.title}</h2>
              <p className="mt-1.5 text-[14px] text-[var(--ink-2)]">{k.text}</p>
              <p className="mkt-link mt-6 inline-block text-[15px] font-medium break-all">{k.label}</p>
            </a>
          ))}
        </div>
        {c?.address && <p className="mt-12 text-[14px] text-[var(--mute)]">{c.address}</p>}
        <p className="mt-10 text-[15px] text-[var(--ink-2)]">
          Already a customer?{' '}
          <a href={appUrl('/login')} className="mkt-link font-medium text-[var(--ink)]">
            Sign in
          </a>
        </p>
      </section>
    </MarketingShell>
  )
}
