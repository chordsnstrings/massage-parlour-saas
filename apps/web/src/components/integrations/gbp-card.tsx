import { Card, CardBody, CardHeader } from '@/components/ui/card'
import type { MemberContext } from '@/server/access'

/** Placeholder — replaced by the Google Business Profile integration module. */
export async function GbpCard({
  ctx: _ctx,
  searchParams: _sp,
}: {
  ctx: MemberContext
  searchParams: Record<string, string | string[] | undefined>
}) {
  return (
    <Card>
      <CardHeader title="Google Business Profile" description="Coming soon." />
      <CardBody />
    </Card>
  )
}
