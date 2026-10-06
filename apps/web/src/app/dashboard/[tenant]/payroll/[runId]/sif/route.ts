import { payrollLines, payrollRuns, staff, tenants, withTenant } from '@spa/db'
import { wpsSif } from '@spa/services'
import { eq, inArray } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import { can, requireMember } from '@/server/access'
import { audit } from '@/server/audit'

const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1

/**
 * WPS salary information file for a payroll run. Only staff with an IBAN and MOHRE person code are
 * included; each pays the run's net (salary first as the fixed part, the rest as variable pay).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ tenant: string; runId: string }> }) {
  const { tenant, runId } = await params
  const ctx = await requireMember(tenant)
  if (!can(ctx, 'staff.manage')) notFound()
  const data = await withTenant(ctx.tenant.id, async (tx) => {
    const [run] = await tx.select().from(payrollRuns).where(eq(payrollRuns.id, runId))
    if (!run) return null
    const lines = await tx.select().from(payrollLines).where(eq(payrollLines.runId, run.id))
    const people = lines.length
      ? await tx
          .select()
          .from(staff)
          .where(
            inArray(
              staff.id,
              lines.map((l) => l.staffId),
            ),
          )
      : []
    const [t] = await tx.select({ settings: tenants.settings }).from(tenants)
    return { run, lines, people, wps: t?.settings.wps }
  })
  if (!data) notFound()
  if (!data.wps?.employerId || !data.wps.routingCode)
    return new Response('Set up the WPS employer details on the payroll page first.', { status: 422 })
  const byId = new Map(data.people.map((p) => [p.id, p]))
  const period = days(data.run.periodStart, data.run.periodEnd)
  const rows = data.lines.flatMap((l) => {
    const p = byId.get(l.staffId)?.payroll
    const net = Number(l.netAed)
    if (!p?.iban || !p.personId || net <= 0) return []
    const fixed = Math.min(Number(l.baseAed), net)
    return [
      {
        personId: p.personId,
        routingCode: p.routingCode || data.wps!.routingCode!,
        iban: p.iban,
        days: period,
        fixedAed: fixed,
        variableAed: Math.round((net - fixed) * 100) / 100,
      },
    ]
  })
  const now = new Date()
  const body = wpsSif({
    employerId: data.wps.employerId,
    employerBankRoutingCode: data.wps.routingCode,
    periodStart: data.run.periodStart,
    periodEnd: data.run.periodEnd,
    createdAt: now,
    lines: rows,
  })
  // Banks expect EEEEEEEEEEEEEYYMMDDHHMMSS.SIF (employer ID + creation timestamp).
  const stamp = new Date(now.getTime() + 4 * 3600_000).toISOString().replace(/\D/g, '').slice(2, 14)
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: 'payroll.sif.exported',
    entityId: runId,
    data: { employees: rows.length },
  })
  return new Response(`${body}\r\n`, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'content-disposition': `attachment; filename="${data.wps.employerId.padStart(13, '0')}${stamp}.SIF"`,
      'cache-control': 'private, no-store',
    },
  })
}
