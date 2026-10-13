import type { Metadata } from 'next'
import Link from 'next/link'
import { LEGAL, LegalPage, Mail } from '@/components/marketing/legal'
import { marketingMetadata } from '@/components/marketing/seo'

// OWNER MUST REVIEW: plain-English draft. Company details live in components/marketing/legal-config.ts.
export const metadata: Metadata = marketingMetadata('privacy', {
  title: 'Privacy policy',
  description: `How ${LEGAL.brand} collects, uses and protects data.`,
})

export default function PrivacyPage() {
  return (
    <LegalPage
      active="privacy"
      title="Privacy policy"
      intro={`How ${LEGAL.brand} handles the data of spas, their teams and their clients.`}
    >
      <h2>Who we are</h2>
      <p>
        {LEGAL.brand} is business software for massage spas in the United Arab Emirates, operated by{' '}
        <strong>{LEGAL.companyName}</strong> ({LEGAL.address}). Questions about this policy: <Mail />.
      </p>

      <h2>Our role</h2>
      <p>
        For the data a spa keeps about its own clients (bookings, visit history, notes, sales), the spa is the
        controller and we act as its <strong>processor</strong>: we store and process that data only to
        provide the service to the spa, on its instructions. For the accounts of spa owners and staff, and for
        visitors to this website, we are the controller.
      </p>

      <h2>What data we process</h2>
      <ul>
        <li>
          <strong>Account data</strong>: name, email, password (stored hashed), role, two-step verification
          settings, sign-in times.
        </li>
        <li>
          <strong>Spa data</strong>: business details, branches, services, prices, staff schedules, inventory,
          sales and accounting records.
        </li>
        <li>
          <strong>Spa clients’ data</strong> entered by the spa or by a client booking online: name, phone,
          email (optional), bookings, preferences and notes, purchases, packages and gift cards.
        </li>
        <li>
          <strong>Website visits</strong> on spa sites and this site: pages viewed and clicks, counted without
          cookies (see below).
        </li>
        <li>
          <strong>Billing</strong>: invoices for the subscription and how they were paid.
        </li>
      </ul>

      {/* R29 Google wording: OWNER MUST APPROVE before release (owner 2026-10-13). */}
      <h2>Instagram, Facebook (Meta) and Google</h2>
      <p>
        A spa can connect its own Instagram professional account, Facebook Page or Google account. When it
        does, we use the access it grants only to:
      </p>
      <ul>
        <li>read messages, comments and reviews so the spa can see them and reply;</li>
        <li>draft replies and posts (with AI) for the spa to review;</li>
        <li>publish replies and posts that the spa has approved;</li>
        <li>show basic insights about the spa’s own account.</li>
      </ul>
      <p>With a Google account, that means:</p>
      <ul>
        <li>
          <strong>Google Business Profile</strong>: we list the locations the account manages so the spa can
          choose its own, read that location’s reviews, post replies the spa approves (or that its autopilot
          setting allows, for 4–5★ reviews only), publish local posts the spa approves, and set the location’s
          “Book” link to the spa’s booking page.
        </li>
        <li>
          <strong>Google Search Console</strong>: we list the properties the account can access, add the spa’s
          website address as a property, and submit and check its sitemap. We do not read search performance
          data.
        </li>
        <li>We receive the account’s email address only to show which Google account is connected.</li>
        <li>
          Review content from Google is kept for at most 30 days unless Google returns it again when we sync;
          a review removed from Google is deleted at the next full sync.
        </li>
      </ul>
      <p>
        We do not sell this data, use it for advertising, or share it with anyone other than the service
        providers listed below. Access tokens are stored encrypted. A spa can disconnect at any time in its
        settings, or revoke access directly in Instagram/Facebook settings or its Google account; we then stop
        using the token and delete it. If the same Google account is connected to more than one spa,
        disconnecting one spa leaves the others connected; to remove our access from that Google account
        completely, revoke it in the Google account’s settings. Our use of data received from Google APIs
        follows the Google API Services User Data Policy, including the Limited Use requirements.
      </p>

      <h2>AI processing</h2>
      <p>
        AI features (drafting replies, posts, website copy and suggestions) send the text needed for that task
        to <strong>BytePlus ModelArk</strong>, our AI provider. We send only what the task needs, and we do
        not allow the data to be used to train models where the provider offers that choice. AI output is a
        draft: the spa decides what is sent or published.
      </p>

      <h2>WhatsApp</h2>
      <p>
        We never send WhatsApp messages automatically. Message buttons open WhatsApp with a pre-filled text on
        the spa’s own phone or computer; a person at the spa chooses to send it. We do not connect to WhatsApp
        accounts.
      </p>

      <h2>Where data is stored and for how long</h2>
      <ul>
        <li>
          Data is stored on servers at DigitalOcean (currently in their Bangalore, India data centre) and
          delivered through Cloudflare. Data may therefore be transferred outside the UAE, with safeguards as
          required by law.
        </li>
        <li>
          We keep spa data while the subscription is active. After it ends, the spa can export its data for 30
          days; we then delete it. Encrypted backups roll off within a further 30 days.
        </li>
        <li>Website visit statistics are kept for 90 days in detail and then only as totals.</li>
        <li>Billing records are kept as long as UAE tax law requires.</li>
      </ul>

      <h2>Backups and security</h2>
      <p>
        Data is encrypted in transit (HTTPS). Each spa’s data is separated in the database so one spa can
        never see another’s. We take regular encrypted backups kept off the main server. Access is limited to
        people who need it to run the service; staff accounts support two-step verification, and sign-ins and
        sensitive actions are logged.
      </p>

      <h2>Service providers</h2>
      <p>
        DigitalOcean (hosting), Cloudflare (network and security), BytePlus ModelArk (AI), an email provider
        for account emails (such as sign-in and password reset), and Stripe if a spa chooses to pay a platform
        invoice by card. Meta and Google receive only what a spa publishes or sets up through them (replies,
        posts, its Google “Book” link and its website’s sitemap).
      </p>

      <h2>Cookies and analytics</h2>
      <p>
        We use only first-party cookies needed to keep you signed in and secure. Visit statistics are counted
        without cookies and without third-party trackers.
      </p>

      <h2>Your rights</h2>
      <p>
        Under the UAE Personal Data Protection Law (Federal Decree-Law No. 45 of 2021) and other laws that
        apply, you can ask to access, correct or delete your personal data, to restrict or object to
        processing, and to receive a copy. If you are a client of a spa, please contact the spa first — it
        controls your data — or write to us and we will pass your request on. See{' '}
        <Link href="/data-deletion">how to request deletion</Link>.
      </p>

      <h2>Changes</h2>
      <p>
        We may update this policy. We will post the new version here and tell spas by email or in the
        dashboard before an important change takes effect.
      </p>

      <h2>Contact</h2>
      <p>
        {LEGAL.companyName}, {LEGAL.address} — <Mail />.
      </p>
    </LegalPage>
  )
}
