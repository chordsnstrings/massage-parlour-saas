import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { BookingPage, bookingMetadata } from '@/components/booking/booking-page'
import { resolveSiteTenant } from '@/server/sites'

type Props = {
  params: Promise<{ hostname: string }>
  searchParams: Promise<{ lang?: string | string[]; service?: string | string[] }>
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { hostname } = await params
  const tenant = await resolveSiteTenant({ hostname: decodeURIComponent(hostname) })
  return bookingMetadata(tenant, (await searchParams).lang)
}

export default async function CustomDomainBooking({ params, searchParams }: Props) {
  const hostname = decodeURIComponent((await params).hostname)
  const tenant = await resolveSiteTenant({ hostname })
  if (!tenant) notFound()
  return <BookingPage tenant={tenant} site={{ hostname }} base="" search={await searchParams} />
}
