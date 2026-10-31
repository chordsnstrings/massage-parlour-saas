import '../../../[tenant]/crm.css'
import '../../../[tenant]/crm-kit.css'
import { Calendar, Rocket, Sparkles, Users, Wallet } from 'lucide-react'
import { notFound } from 'next/navigation'
import {
  BarChart,
  Bubble,
  Card,
  CHART_COLOURS,
  Chat,
  ComingItem,
  Eyebrow,
  GiftCardVisual,
  Grid,
  Hairline,
  Kpi,
  Legend,
  ListRow,
  Meter,
  Note,
  Pill,
  QueueItem,
  SectionTabs,
  Seg,
  SegBar,
  SiteFrame,
  Stack,
  Stat,
  TeamCard,
  TName,
} from '@/components/crm'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { EmptyState, PageHeader } from '@/components/ui/page'
import { DataTable } from '@/components/ui/table'
import { appPath } from '@/lib/paths'
import { isPlatformAdmin } from '@/server/access'
import { getSession } from '@/server/session'
import { CrmKitInteractive } from './kit-crm-client'

/** Spa-dashboard page kit gallery (docs/design/phase2-kit.md). Dev only, or super-admins in production. */
export default async function CrmKitPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const session = await getSession()
  if (process.env.NODE_ENV === 'production' && !(session && (await isPlatformAdmin(session.user.id))))
    notFound()
  const lang = (await searchParams).lang === 'th' ? 'th' : 'en'
  const here = appPath('/dev/kit/crm')
  const rows = [
    { id: '1', name: 'Aisha Rahman', svc: 'Thai massage · 90 min', status: 'confirmed', price: 'AED 450' },
    { id: '2', name: 'Maya Chen', svc: 'Hot stone · 75 min', status: 'pending', price: 'AED 420' },
    { id: '3', name: 'Grace Okafor', svc: 'Swedish · 60 min', status: 'no_show', price: 'AED 350' },
  ]
  const tone = { confirmed: 'info', pending: 'warn', no_show: 'bad' } as const
  const months = ['May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'].map((label, i) => ({
    label,
    value: [42, 51, 47, 60, 58, 66][i] ?? 0,
    hi: i === 5,
    title: `AED ${[42, 51, 47, 60, 58, 66][i]}k`,
  }))
  return (
    <div className="crm" lang={lang}>
      <main className="crm-view mx-auto">
        <PageHeader
          title="Spa page kit"
          description="components/crm + crm-kit.css at compact density. Add ?lang=th for the Thai sizes."
          actions={
            <Seg
              label="Language"
              value={lang}
              items={[
                { value: 'en', label: 'EN', href: here },
                { value: 'th', label: 'ไทย', href: `${here}?lang=th` },
              ]}
            />
          }
        />
        <SectionTabs
          label="Sections"
          value="kit"
          items={[
            { value: 'kit', label: 'Kit', href: here },
            { value: 'old', label: 'Base UI kit', href: appPath('/dev/kit') },
          ]}
        />
        <Stack>
          <Grid cols="kgrid">
            <Kpi
              label="Bookings"
              icon={<Calendar />}
              value="128"
              delta={{ text: '+12%', dir: 'up' }}
              sub="This week"
              href={here}
              linkLabel="View details"
            />
            <Kpi
              label="Revenue"
              icon={<Wallet />}
              value="AED 42,300"
              delta={{ text: '−3%', dir: 'down' }}
              sub="This month"
              href={here}
              linkLabel="View details"
            />
            <Kpi
              label="New clients"
              icon={<Users />}
              value="31"
              delta={{ text: '0%', dir: 'flat' }}
              sub="This month"
            />
            <Kpi label="Utilisation" icon={<Sparkles />} value="74%" sub="Rooms + therapists" />
            <Kpi label="AI drafts" icon={<Rocket />} value="9" sub="Waiting for approval" />
          </Grid>
          <Grid cols="g4">
            <Stat
              label="Today"
              value="18"
              unit="bookings"
              change={{ text: '+4 vs last Thu', dir: 'up' }}
              icon={<Calendar />}
            />
            <Stat label="Cash in drawer" value="AED 2,140" />
            <Stat label="No-shows" value="2" change={{ text: '+1', dir: 'down' }} />
            <Stat label="Rating" value="4.8" unit="/ 5" />
          </Grid>
          <Grid cols="col-2">
            <Card
              title="Upcoming bookings"
              sub="Next 3 hours"
              actions={
                <Button size="sm" variant="secondary">
                  View all
                </Button>
              }
              flush
            >
              <div className="crm-tbl-wrap px-[var(--crm-pad-card)] pb-2">
                <table className="crm-tbl" data-stack="true">
                  <thead>
                    <tr>
                      <th>Client</th>
                      <th>Status</th>
                      <th className="crm-num-c">Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td data-label="Client">
                          <TName name={r.name} sub={r.svc} />
                        </td>
                        <td data-label="Status">
                          <Pill tone={tone[r.status as keyof typeof tone]} dot>
                            {r.status.replace('_', ' ')}
                          </Pill>
                        </td>
                        <td data-label="Price" className="crm-num-c">
                          {r.price}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <Card title="Revenue by month" sub="Last 6 months">
              <BarChart label="Revenue by month" data={months} />
              <Hairline />
              <Legend
                items={[
                  { label: 'Massage', value: '62%', color: CHART_COLOURS[0] },
                  { label: 'Facials', value: '24%', color: CHART_COLOURS[1] },
                  { label: 'Retail', value: '14%', color: CHART_COLOURS[3] },
                ]}
              />
            </Card>
          </Grid>
          <Grid cols="g3">
            <Card title="Automations">
              <ListRow icon={<Calendar />} title="Reminder" body="24 h before each visit" time="Active" />
              <ListRow
                icon={<Sparkles />}
                title="Review request"
                body="After a completed visit"
                end={<Pill tone="ok">On</Pill>}
              />
              <ListRow icon={<Users />} title="Win-back" body="Clients away 60 days" href={here} />
            </Card>
            <Card title="Meters & journey">
              <Stack>
                <Meter label="AI allowance" value={0.62} valueText="62%" showLabel />
                <Meter
                  label="Massage oil stock"
                  value={3}
                  max={20}
                  valueText="3 / 20"
                  showLabel
                  tone="warn"
                />
                <SegBar
                  label="Client journey"
                  items={[
                    { value: 40, color: CHART_COLOURS[0] },
                    { value: 25, color: CHART_COLOURS[1] },
                    { value: 20, color: CHART_COLOURS[3] },
                    { value: 15, color: CHART_COLOURS[4] },
                  ]}
                />
                <CrmKitInteractive />
              </Stack>
            </Card>
            <Card title="Pills & notes">
              <div className="mb-3 flex flex-wrap gap-2">
                <Pill>Neutral</Pill>
                <Pill tone="ok" dot>
                  Paid
                </Pill>
                <Pill tone="warn">Pending</Pill>
                <Pill tone="bad">No-show</Pill>
                <Pill tone="info">Online</Pill>
                <Pill tone="acc">VIP</Pill>
              </div>
              <Eyebrow>Rituals</Eyebrow>
              <Stack>
                <Note>Payments are recorded here, never processed.</Note>
                <Note tone="acc">Your website is built by our studio team.</Note>
                <Note tone="warn">Two shifts overlap on Friday.</Note>
              </Stack>
            </Card>
          </Grid>
          <Grid cols="g4">
            <TeamCard
              name="Ploy Srisai"
              subtitle="Therapist"
              stats={[
                { label: 'Visits', value: '86' },
                { label: 'Rating', value: '4.9' },
              ]}
            />
            <GiftCardVisual top="Serenity Spa" value="AED 500" bottom="GC-4F7Q · until 8 Oct 2027" />
            <Card title="Inbox">
              <Chat label="Conversation">
                <Bubble from="them" time="14:02">
                  Do you have a slot at 6 pm?
                </Bubble>
                <Bubble from="us" time="14:03">
                  Yes — Thai massage 90 min at 18:00 with Ploy.
                </Bubble>
              </Chat>
            </Card>
            <Card title="WhatsApp queue">
              <QueueItem
                header={
                  <>
                    <b>Aisha Rahman</b>
                    <Pill tone="info">Reminder</Pill>
                  </>
                }
                message="Hi Aisha, see you tomorrow at 18:00."
                actions={
                  <>
                    <Button size="sm">Send</Button>
                    <Button size="sm" variant="ghost">
                      Edit
                    </Button>
                  </>
                }
              />
            </Card>
          </Grid>
          <Grid cols="col-2b">
            <Card title="Coming next">
              <Stack>
                <ComingItem icon={<Rocket />} pill={<Pill tone="acc">Q1</Pill>}>
                  Online gift-card shop
                </ComingItem>
                <ComingItem icon={<Sparkles />} pill={<Pill>Later</Pill>}>
                  Memberships
                </ComingItem>
              </Stack>
            </Card>
            <Card title="Website">
              <SiteFrame url="serenity.spamanagement.co">
                <h3>Serenity Spa</h3>
                <p>Thai and Balinese massage in Dubai Marina.</p>
              </SiteFrame>
            </Card>
          </Grid>
          <Grid cols="g2">
            <Card title="Form (components/ui, themed)">
              <Field label="Business name" name="name">
                <Input name="name" placeholder="Serenity Spa" />
              </Field>
              <div className="crm-fieldrow mt-3">
                <label htmlFor="raw">Raw .crm-inp</label>
                <input id="raw" className="crm-inp" placeholder="050 123 4567" />
              </div>
            </Card>
            <Card title="DataTable (components/ui, themed)" flush>
              <DataTable
                rows={rows}
                rowKey={(r) => r.id}
                columns={[
                  { key: 'n', header: 'Client', primary: true, cell: (r) => r.name },
                  { key: 'p', header: 'Price', cell: (r) => r.price, className: 'text-end' },
                ]}
                empty={<EmptyState title="No bookings yet" />}
              />
            </Card>
          </Grid>
        </Stack>
      </main>
    </div>
  )
}
