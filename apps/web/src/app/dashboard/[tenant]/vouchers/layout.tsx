import { FeatureGate } from '@/components/plan/upsell'

/** F15 gift vouchers (print / share with QR): Premium (marketing). Standard spas see "Available on Premium". */
export default function VouchersLayout({
  params,
  children,
}: {
  params: Promise<{ tenant: string }>
  children: React.ReactNode
}) {
  return (
    <FeatureGate params={params} feature="marketing">
      {children}
    </FeatureGate>
  )
}
