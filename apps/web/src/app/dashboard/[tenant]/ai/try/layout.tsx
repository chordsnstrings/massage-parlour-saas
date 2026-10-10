import { FeatureGate } from '@/components/plan/upsell'

/** PLAN §18.8: needs the `ai` plan feature (Premium); otherwise the "Available on Premium" page. */
export default function Layout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ tenant: string }>
}) {
  return (
    <FeatureGate params={params} feature="ai">
      {children}
    </FeatureGate>
  )
}
