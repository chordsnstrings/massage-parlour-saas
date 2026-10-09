import { PLATFORM_NAME, whatsappLink } from '@spa/core'
import { platformDb, user } from '@spa/db'
import { getEnquiry } from '@spa/services'
import { eq } from 'drizzle-orm'
import { ArrowLeft, Mail, MessageCircle, Phone } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { PageBody, PageHeader } from '@/components/ui/page'
import { adminPath } from '@/lib/paths'
import { formatDateTime } from '@/lib/utils'
import { requirePlatformAdmin } from '@/server/access'
import { updateEnquiryAction } from '../actions'
import { ENQUIRY_STATUS } from '../status'
import { HandleEnquiryForm } from './handle-form'

export const metadata: Metadata = { title: 'Enquiry' }

const linkClass =
  'inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors hover:border-fg'

export default async function EnquiryDetail({ params }: { params: Promise<{ id: string }> }) {
  await requirePlatformAdmin()
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound()
  const db = platformDb()
  const e = await getEnquiry(db, id)
  if (!e) notFound()
  const handler = e.handledBy ? await db.query.user.findFirst({ where: eq(user.id, e.handledBy) }) : null
  const status = ENQUIRY_STATUS[e.status]
  // Click-to-send only (locked comms rule): WhatsApp opens with a draft; a person presses send.
  const wa = whatsappLink(
    e.phone,
    `Hi ${e.name}, thanks for contacting ${PLATFORM_NAME} about ${e.spaName}. `,
  )
  const mail = `mailto:${e.email}?subject=${encodeURIComponent(`Your enquiry to ${PLATFORM_NAME}`)}`
  const rows: [string, React.ReactNode][] = [
    ['Name', e.name],
    ['Spa name', e.spaName],
    [
      'Email',
      <a key="e" href={mail} className="break-all hover:text-accent">
        {e.email}
      </a>,
    ],
    [
      'Phone',
      <a key="p" href={`tel:${e.phone}`} className="hover:text-accent">
        {e.phone}
      </a>,
    ],
    ['Sent', formatDateTime(e.createdAt)],
    [
      'Last handled',
      e.handledAt
        ? `${formatDateTime(e.handledAt)}${handler ? ` · ${handler.name || handler.email}` : ''}`
        : '—',
    ],
  ]
  return (
    <>
      <PageHeader
        title={e.name}
        description={`Enquiry from ${e.spaName}`}
        actions={
          <Badge tone={status.tone} data-testid="enquiry-status">
            {status.label}
          </Badge>
        }
      />
      <PageBody>
        <Link
          href={adminPath('/enquiries')}
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg"
        >
          <ArrowLeft className="size-4" /> All enquiries
        </Link>
        <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="space-y-6">
            <Card>
              <CardHeader title="What they need" />
              <CardBody>
                <p
                  className="whitespace-pre-wrap break-words text-sm leading-relaxed"
                  data-testid="enquiry-message"
                >
                  {e.message}
                </p>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Contact" />
              <CardBody className="space-y-5">
                <div className="flex flex-wrap gap-2">
                  <a href={`tel:${e.phone}`} className={linkClass}>
                    <Phone className="size-4" strokeWidth={1.5} /> Call
                  </a>
                  <a href={wa} target="_blank" rel="noopener noreferrer" className={linkClass}>
                    <MessageCircle className="size-4" strokeWidth={1.5} /> WhatsApp
                  </a>
                  <a href={mail} className={linkClass}>
                    <Mail className="size-4" strokeWidth={1.5} /> Email
                  </a>
                </div>
                <dl className="divide-y border-y text-sm">
                  {rows.map(([k, v]) => (
                    <div key={k} className="grid gap-1 py-2.5 sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-4">
                      <dt className="text-muted">{k}</dt>
                      <dd className="break-words font-medium">{v}</dd>
                    </div>
                  ))}
                </dl>
              </CardBody>
            </Card>
          </div>
          <Card>
            <CardHeader title="Follow-up" description="Status and an internal note. Changes are audited." />
            <CardBody>
              <HandleEnquiryForm
                action={updateEnquiryAction.bind(null, e.id)}
                status={e.status}
                note={e.adminNote}
              />
            </CardBody>
          </Card>
        </div>
      </PageBody>
    </>
  )
}
