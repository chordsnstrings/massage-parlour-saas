import { branchMapsHref, whatsappLink } from '@spa/core'
import { MapPin, MessageCircle, Phone } from 'lucide-react'
import { Reveal } from '@/components/ui/motion'
import type { siteData } from '@/server/sites'

/** Interim public site until the site builder (P1) publishes real pages. */
export function PlaceholderSite({ data }: { data: Awaited<ReturnType<typeof siteData>> }) {
  const { tenant, branch } = data
  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden px-6 py-16">
      <div className="pointer-events-none absolute -top-40 left-1/2 size-[36rem] -translate-x-1/2 rounded-full bg-accent-soft blur-3xl" />
      <Reveal className="relative mx-auto max-w-xl text-center">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted">Massage & wellness</p>
        <h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-6xl">{tenant.name}</h1>
        <p className="mx-auto mt-5 max-w-md text-[17px] text-muted">
          Our new website is on its way. Message us on WhatsApp to book your next treatment.
        </p>
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          {branch?.whatsappE164 && (
            <a
              href={whatsappLink(branch.whatsappE164, `Hi ${tenant.name}, I'd like to book a massage.`)}
              className="inline-flex h-12 items-center gap-2 rounded-full bg-accent px-6 text-[15px] font-medium text-accent-fg transition-transform duration-150 hover:-translate-y-0.5 active:scale-[0.98]"
            >
              <MessageCircle className="size-4" /> Book on WhatsApp
            </a>
          )}
          {branch?.phone && (
            <a
              href={`tel:${branch.phone}`}
              className="inline-flex h-12 items-center gap-2 rounded-full border bg-surface px-6 text-[15px] font-medium transition-colors hover:bg-subtle"
            >
              <Phone className="size-4" /> Call us
            </a>
          )}
        </div>
        {branch?.address && (
          <p className="mt-10 inline-flex items-center gap-2 text-sm text-muted">
            <MapPin className="size-4" strokeWidth={1.5} />{' '}
            <a
              href={branchMapsHref(branch) ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${branch.address} (Open in Google Maps)`}
              title="Open in Google Maps"
              data-maps-link=""
              className="text-inherit hover:underline"
            >
              {branch.address}
            </a>
          </p>
        )}
      </Reveal>
    </div>
  )
}
