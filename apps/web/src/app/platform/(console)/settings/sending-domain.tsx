'use client'
import type { SendingDomain, SendingDomainRecord } from '@spa/core'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { CardBody } from '@/components/ui/card'
import { CopyButton } from '@/components/ui/copy-button'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { DataTable } from '@/components/ui/table'
import type { ActionResult } from '@/lib/action'
import { sendingDomainAction } from '../actions'

type Tone = React.ComponentProps<typeof Badge>['tone']
/** Shrink-to-fit columns, so Value gets the rest of the row. */
const NARROW = 'w-px whitespace-nowrap'
// Resend's domain + record statuses (https://resend.com/docs/dashboard/domains/manage-domains).
const STATUS: Record<string, [string, Tone]> = {
  not_started: ['Not started', 'neutral'],
  pending: ['Pending', 'warning'],
  verified: ['Verified', 'success'],
  partially_verified: ['Partially verified', 'warning'],
  partially_failed: ['Partially failed', 'danger'],
  failed: ['Failed', 'danger'],
  temporary_failure: ['Temporary failure', 'danger'],
}
function StatusBadge({ status, ...props }: { status: string } & React.ComponentProps<'span'>) {
  const [label, tone] = STATUS[status] ?? [status.replaceAll('_', ' '), 'neutral']
  return (
    <Badge tone={tone} {...props}>
      {label}
    </Badge>
  )
}

/**
 * R18 "Sending domain" inside the Email (Resend) card: set up / check the From domain in Resend and list the DNS
 * records as Namecheap → Advanced DNS wants them. Records live in action state only (nothing stored).
 */
export function SendingDomainSection({
  domain,
  forwarding,
}: {
  domain: string | null
  forwarding: string | null
}) {
  const [view, setView] = useState<{ domain: SendingDomain; from: string } | null>(null)
  const [needsKey, setNeedsKey] = useState(false)
  const run = async (p: ActionResult, fd: FormData) => {
    const r = await sendingDomainAction(p, fd)
    if (r?.ok && r.data?.domain) setView(r.data as { domain: SendingDomain; from: string })
    if (r && !r.ok && r.fieldErrors?.setupKey) setNeedsKey(true)
    return r
  }
  const d = view?.domain
  const value = (r: SendingDomainRecord) => (
    <div className="space-y-1.5">
      <div className="flex items-start gap-2">
        <code className="min-w-0 flex-1 break-all font-mono text-xs leading-relaxed">{r.value}</code>
        <CopyButton value={r.value} />
      </div>
      {r.type === 'MX' && (
        <p className="text-xs text-warning" data-testid="mx-warning">
          Namecheap: an MX record on a subdomain needs Mail Settings = Custom MX, which turns off Email
          Forwarding
          {forwarding ? ` (${forwarding} stops receiving)` : ''}. Read the Resend step in
          deploy/droplet/README.md first.
        </p>
      )}
    </div>
  )
  return (
    <div className="border-t" data-testid="sending-domain">
      <CardBody className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            <h3 className="text-sm font-semibold">Sending domain</h3>
            <p className="text-[13px] text-muted">
              Resend sends only from a verified domain. Set up adds{' '}
              <span className="font-medium text-fg">{domain ?? '?'}</span> to Resend (region eu-west-1 when
              new) and lists the DNS records to add in Namecheap → Domain List → Manage → Advanced DNS. Check
              asks Resend to verify them (usually within 15 minutes of adding them, at most 72 hours).
            </p>
          </div>
          {d && <StatusBadge status={d.status} className="shrink-0" data-testid="domain-status" />}
        </div>
        <ActionForm action={run} className="space-y-4">
          {needsKey && (
            <Field
              label="Full-access key for setup"
              name="setupKey"
              className="max-w-md"
              hint="Sent only with Set up and Check verification: never stored, logged or shown (paste it again after a reload). Create one in Resend → API Keys (Full access); delete it there once the domain says Verified."
            >
              <Input id="setupKey" name="setupKey" type="password" autoComplete="off" placeholder="re_…" />
            </Field>
          )}
          <div className="flex flex-wrap gap-2">
            <SubmitButton name="intent" value="setup" disabled={!domain}>
              Set up sending domain
            </SubmitButton>
            <SubmitButton name="intent" value="check" variant="secondary" disabled={!domain}>
              Check verification
            </SubmitButton>
          </div>
        </ActionForm>
        {d && (
          <p className="text-[13px] text-muted">
            {d.name}
            {d.region ? ` · region ${d.region}` : ''} ·{' '}
            {d.status === 'verified' ? (
              <span className="font-medium text-success" data-testid="domain-verified">
                Sending works: staff email goes out from {view.from}.
              </span>
            ) : (
              'Add every record below, then click Check verification.'
            )}
          </p>
        )}
      </CardBody>
      {d && d.records.length > 0 && (
        <div className="border-t [--ui-cell-px:1rem]" data-testid="domain-records">
          <DataTable
            rows={d.records}
            rowKey={(r) => `${r.type}-${r.host}-${r.purpose}`}
            columns={[
              {
                key: 'type',
                header: 'Type',
                hideOnMobile: true,
                className: NARROW,
                cell: (r) => <span className="font-medium">{r.type}</span>,
              },
              {
                key: 'host',
                header: 'Host',
                primary: true,
                className: NARROW,
                cell: (r) => (
                  <div className="space-y-2">
                    {/* Phones: the card has no column headers, so label the parts as Namecheap names them. */}
                    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                      <span className="md:hidden">
                        <span className="me-1.5 text-sm font-normal text-muted">Type</span>
                        {r.type}
                      </span>
                      <span>
                        <span className="me-1.5 text-sm font-normal text-muted md:hidden">Host</span>
                        <code className="font-mono text-[13px]">{r.host}</code>
                      </span>
                    </div>
                    {/* Phones: the long value gets the full card width instead of half a row. */}
                    <div className="space-y-1 font-normal md:hidden">
                      <div className="text-sm text-muted">Value</div>
                      {value(r)}
                    </div>
                  </div>
                ),
              },
              { key: 'value', header: 'Value', hideOnMobile: true, className: 'min-w-[16rem]', cell: value },
              { key: 'priority', header: 'Priority', className: NARROW, cell: (r) => r.priority ?? '—' },
              { key: 'ttl', header: 'TTL', className: NARROW, cell: () => 'Automatic' },
              {
                key: 'status',
                header: 'Status',
                className: NARROW,
                cell: (r) => <StatusBadge status={r.status} />,
              },
            ]}
          />
        </div>
      )}
    </div>
  )
}
