import type { Metadata } from 'next'
import Link from 'next/link'
import { LEGAL, LegalPage, Mail } from '@/components/marketing/legal'

// OWNER MUST REVIEW: plain-English draft. Company details live in components/marketing/legal-config.ts.
export const metadata: Metadata = {
  title: 'Terms of service',
  description: `The terms for using ${LEGAL.brand}.`,
}

export default function TermsPage() {
  return (
    <LegalPage
      active="terms"
      title="Terms of service"
      intro={`The agreement between your spa and ${LEGAL.companyName} for using ${LEGAL.brand}.`}
    >
      <h2>The service</h2>
      <p>
        {LEGAL.brand} gives a spa a dashboard (bookings, clients, point of sale, staff, accounts), a website
        and optional AI and social media tools. By creating an account you accept these terms on behalf of
        your business. Our <Link href="/privacy">privacy policy</Link> explains how data is handled.
      </p>

      <h2>Subscription and billing</h2>
      <ul>
        <li>
          Subscription fees and any setup fee are the ones shown for your plan on our{' '}
          <Link href="/pricing">pricing page</Link>, or as agreed with you in writing. They are invoiced in advance.
        </li>
        <li>
          Invoices are paid by bank transfer or cash, or by card through a secure payment page where offered.
          If an invoice stays unpaid after a reminder, we may limit or suspend the account.
        </li>
        <li>Fees are non-refundable except where the law requires otherwise.</li>
      </ul>

      <h2>Payments from your clients</h2>
      <p>
        {LEGAL.brand} <strong>records</strong> payments; it does not process them. Your clients pay you
        directly in cash, on your own card terminal or by bank transfer. You are responsible for your takings,
        refunds and tax filings.
      </p>

      <h2>Your responsibilities</h2>
      <ul>
        <li>
          Getting your clients’ consent where needed before you store their details or message them, and
          answering their requests about their data.
        </li>
        <li>
          Everything you publish or send through the service: website content, prices, posts, replies and
          WhatsApp messages (which you always send yourself).
        </li>
        <li>Keeping sign-in details safe and giving staff only the access they need.</li>
        <li>Holding the licences your business needs and following UAE law.</li>
      </ul>

      <h2>Acceptable use</h2>
      <p>You must not use the service to:</p>
      <ul>
        <li>offer or advertise illegal services, or publish unlawful, misleading or offensive content;</li>
        <li>send spam or messages people have not agreed to receive;</li>
        <li>break the rules of Instagram, Facebook, Google or WhatsApp;</li>
        <li>
          access other spas’ data, probe or overload the system, or resell the service without our agreement.
        </li>
      </ul>
      <p>We may suspend an account that breaks these rules, and will tell you why.</p>

      <h2>AI features</h2>
      <p>
        AI suggestions and drafts can be wrong. Check them before you send or publish; you stay responsible
        for what goes out.
      </p>

      <h2>Availability</h2>
      <p>
        We work to keep the service running and backed up, but we do not promise it will be uninterrupted or
        error-free. We may change features as the product improves and will tell you before removing anything
        important.
      </p>

      <h2>Liability</h2>
      <p>
        To the extent the law allows, we are not liable for indirect losses such as lost profit, lost bookings
        or lost data, and our total liability in any year is limited to the fees you paid us in the twelve
        months before the claim. Nothing in these terms limits liability that cannot be limited by law.
      </p>

      <h2>Ending the agreement and your data</h2>
      <ul>
        <li>You can stop at the end of any paid year by telling us in writing.</li>
        <li>We can end the agreement if you seriously break these terms or do not pay.</li>
        <li>
          Your data stays yours. You can export it from the dashboard while the account is active and for 30
          days after it ends; after that we delete it as described in the privacy policy.
        </li>
      </ul>

      <h2>Law</h2>
      <p>
        These terms are governed by the laws of the United Arab Emirates as applied in the Emirate of Dubai,
        whose courts will hear any dispute.
      </p>

      <h2>Changes and contact</h2>
      <p>
        We may update these terms and will give at least 30 days’ notice of important changes. Questions:{' '}
        <Mail />.
      </p>
    </LegalPage>
  )
}
