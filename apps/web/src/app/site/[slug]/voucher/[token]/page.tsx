import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { VoucherCheckPage, voucherMetadata } from '@/components/voucher/voucher-check'
import { PATH_ROUTING } from '@/lib/paths'
import { resolveSiteTenant } from '@/server/sites'

type Props = {
  params: Promise<{ slug: string; token: string }>
  searchParams: Promise<{ lang?: string | string[] }>
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug } = await params
  return voucherMetadata(await resolveSiteTenant({ slug }), (await searchParams).lang)
}

/** F15: the gift voucher's QR target on the free site address. */
export default async function SubdomainVoucher({ params, searchParams }: Props) {
  const { slug, token } = await params
  const tenant = await resolveSiteTenant({ slug })
  if (!tenant) notFound()
  return (
    <VoucherCheckPage
      tenant={tenant}
      token={token}
      base={PATH_ROUTING ? `/s/${tenant.slug}` : ''}
      lang={(await searchParams).lang}
    />
  )
}
