import { FeatureGate } from '@/components/plan/upsell'

/** F16 QR posters + partners: Premium (marketing). Standard spas see "Available on Premium". */
export default function PostersLayout({
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
