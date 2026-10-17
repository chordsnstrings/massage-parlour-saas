import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { BookingPage, bookingMetadata } from '@/components/booking/booking-page'
import { PATH_ROUTING } from '@/lib/paths'
import { resolveSiteTenant } from '@/server/sites'

type Props = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ lang?: string | string[]; service?: string | string[] }>
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug } = await params
  return bookingMetadata(await resolveSiteTenant({ slug }), (await searchParams).lang)
}

export default async function SubdomainBooking({ params, searchParams }: Props) {
  const { slug } = await params
  const tenant = await resolveSiteTenant({ slug })
  if (!tenant) notFound()
  return (
    <BookingPage
      tenant={tenant}
      site={{ slug: tenant.slug }}
      base={PATH_ROUTING ? `/s/${tenant.slug}` : ''}
      search={await searchParams}
    />
  )
}
