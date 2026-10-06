import { Card, CardBody, CardHeader } from '@/components/ui/card'
import type { MemberContext } from '@/server/access'

/** Placeholder — replaced by the Instagram integration module. */
export async function InstagramCard({
  ctx: _ctx,
  searchParams: _sp,
}: {
  ctx: MemberContext
  searchParams: Record<string, string | string[] | undefined>
}) {
  return (
    <Card>
      <CardHeader title="Instagram" description="Coming soon." />
      <CardBody />
    </Card>
  )
}
