import type { Metadata } from 'next'
import Link from 'next/link'
import { LEGAL, LegalPage, Mail } from '@/components/marketing/legal'
import { marketingMetadata } from '@/components/marketing/seo'

// OWNER MUST REVIEW: plain-English draft. This is the "User data deletion instructions URL" given to Meta.
export const metadata: Metadata = marketingMetadata('data-deletion', {
  title: 'Data deletion',
  description: `How to delete your data from ${LEGAL.brand}.`,
})

export default function DataDeletionPage() {
  return (
    <LegalPage
      active="data-deletion"
      title="Delete your data"
      intro="How to remove a connected account, your spa’s data or your own personal data."
    >
      <h2>Disconnect Instagram, Facebook or Google</h2>
      <p>
        A spa owner or manager can disconnect at any time in the dashboard:{' '}
        <strong>Settings → Integrations</strong> → Disconnect. You can also remove access from the other side:
      </p>
      <ul>
        <li>
          Instagram: Settings → Website permissions → Apps and websites → remove {LEGAL.brand}. Facebook:
          Settings → Apps and websites.
        </li>
        <li>Google: myaccount.google.com → Security → Third-party connections → remove {LEGAL.brand}.</li>
      </ul>
      <p>
        When access is removed we stop using it straight away and delete the stored token. Messages, comments
        and insights we copied from that account are deleted within 30 days unless the spa asks us to keep its
        own reply history.
      </p>

      <h2>Ask us to delete data</h2>
      <p>
        Email <Mail /> from the address on your account (or include enough detail for us to find your data)
        and say what you want deleted:
      </p>
      <ul>
        <li>
          <strong>A spa account</strong>: everything for that spa — clients, bookings, sales, staff accounts,
          website and connected accounts. Only the spa owner can ask for this.
        </li>
        <li>
          <strong>A staff member’s account</strong>: their sign-in and personal details. Records the spa must
          keep (such as sales they made) stay, without their personal details where possible.
        </li>
        <li>
          <strong>A spa client</strong>: please ask the spa first, since it controls your data. If you can’t,
          write to us with the spa’s name and your phone number and we will pass the request on and confirm
          when it is done.
        </li>
      </ul>

      <h2>What happens next</h2>
      <ul>
        <li>
          We confirm we received your request within 3 working days and may ask you to prove who you are.
        </li>
        <li>
          We complete the deletion within 30 days and email you when it is done. Copies in encrypted backups
          are removed as those backups expire (within a further 30 days).
        </li>
        <li>
          We keep only what the law requires (for example invoices and accounting records for UAE tax), and
          nothing else.
        </li>
      </ul>
      <p>
        More detail is in our <Link href="/privacy">privacy policy</Link>.
      </p>
    </LegalPage>
  )
}
