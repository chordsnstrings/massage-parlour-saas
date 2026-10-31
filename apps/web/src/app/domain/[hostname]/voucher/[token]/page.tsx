import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { VoucherCheckPage, voucherMetadata } from '@/components/voucher/voucher-check'
import { resolveSiteTenant } from '@/server/sites'

type Props = {
  params: Promise<{ hostname: string; token: string }>
  searchParams: Promise<{ lang?: string | string[] }>
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const tenant = await resolveSiteTenant({ hostname: decodeURIComponent((await params).hostname) })
  return voucherMetadata(tenant, (await searchParams).lang)
}

/** F15: the gift voucher's QR target on the spa's own domain. */
export default async function CustomDomainVoucher({ params, searchParams }: Props) {
  const { hostname, token } = await params
  const tenant = await resolveSiteTenant({ hostname: decodeURIComponent(hostname) })
  if (!tenant) notFound()
  return <VoucherCheckPage tenant={tenant} token={token} base="" lang={(await searchParams).lang} />
}
