import { notFound } from 'next/navigation'
import { AppShell } from '@/components/shell/app-shell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/card'
import { Field } from '@/components/ui/form'
import { Checkbox, Input, Select, Textarea } from '@/components/ui/input'
import { EmptyState, PageBody, PageHeader, Skeleton } from '@/components/ui/page'
import { StatCard } from '@/components/ui/stat-card'
import { DataTable } from '@/components/ui/table'
import { appPath } from '@/lib/paths'
import { formatAed } from '@/lib/utils'
import { isPlatformAdmin } from '@/server/access'
import { getSession } from '@/server/session'
import { KitInteractive } from './kit-client'

const swatches = [
  'bg',
  'surface',
  'subtle',
  'border',
  'fg',
  'muted',
  'accent',
  'accent-soft',
  'success',
  'warning',
  'danger',
]

/** Design-system gallery (docs/PLAN.md §12.5). Dev only, or super-admins in production. */
export default async function KitPage() {
  const session = await getSession()
  if (process.env.NODE_ENV === 'production' && !(session && (await isPlatformAdmin(session.user.id))))
    notFound()
  const rows = [
    { id: '1', name: 'Swedish massage · 60 min', therapist: 'Maya', price: 350 },
    { id: '2', name: 'Thai massage · 90 min', therapist: 'Ploy', price: 450 },
    { id: '3', name: 'Hot stone · 75 min', therapist: 'Grace', price: 420 },
  ]
  return (
    <AppShell
      title="Design system"
      subtitle="Component kit"
      homeHref={appPath('/dev/kit')}
      user={session?.user ?? { name: 'Preview User', email: 'preview@spamanagement.ae' }}
      nav={[
        { href: appPath('/dev/kit'), label: 'Kit', icon: 'home' },
        { href: appPath('/dev/kit#forms'), label: 'Forms', icon: 'settings' },
        { href: appPath('/dev/kit#data'), label: 'Data', icon: 'billing' },
      ]}
    >
      <PageHeader
        eyebrow="Lagom"
        title="Component kit"
        description="Tokens and components, light and dark, at every breakpoint."
        actions={<Button>Primary</Button>}
      />
      <PageBody>
        <Card>
          <CardHeader title="Colour tokens" />
          <CardBody className="grid grid-cols-3 gap-3 sm:grid-cols-6 xl:grid-cols-11">
            {swatches.map((s) => (
              <div key={s} className="space-y-2">
                <div className="h-14 rounded-lg border" style={{ background: `var(--${s})` }} />
                <p className="text-xs text-muted">{s}</p>
              </div>
            ))}
          </CardBody>
        </Card>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Revenue today" value={4850} format="aed" hint="+12% vs last Tuesday" />
          <StatCard label="Bookings" value={23} hint="4 walk-ins" />
          <StatCard label="Utilisation" value={78} format="pct" hint="Therapist hours booked" />
          <StatCard label="New clients" value={6} />
        </div>
        <Card>
          <CardHeader title="Buttons & badges" />
          <CardBody className="space-y-5">
            <div className="flex flex-wrap gap-3">
              <Button>Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="danger">Danger</Button>
              <Button pending>Saving</Button>
              <Button size="sm">Small</Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {(['neutral', 'accent', 'success', 'warning', 'danger'] as const).map((t) => (
                <Badge key={t} tone={t}>
                  {t}
                </Badge>
              ))}
            </div>
            <KitInteractive />
          </CardBody>
        </Card>
        <Card id="forms">
          <CardHeader title="Forms" description="Labels above, hints below, errors in danger." />
          <CardBody className="grid gap-5 sm:grid-cols-2">
            <Field label="Client name" name="k1" hint="As it appears on WhatsApp.">
              <Input id="k1" placeholder="Fatima Al Mansoori" />
            </Field>
            <Field label="Service" name="k2">
              <Select id="k2">
                <option>Swedish massage</option>
                <option>Thai massage</option>
              </Select>
            </Field>
            <Field label="Notes" name="k3" className="sm:col-span-2">
              <Textarea id="k3" placeholder="Prefers medium pressure, no lavender." />
            </Field>
            <label className="flex items-center gap-2.5 text-sm">
              <Checkbox defaultChecked /> Send WhatsApp reminder
            </label>
          </CardBody>
          <CardFooter>
            <Button variant="ghost">Cancel</Button>
            <Button>Save booking</Button>
          </CardFooter>
        </Card>
        <Card id="data">
          <CardHeader title="Data table" description="Table on desktop, cards on phones." />
          <div className="mt-4 border-t">
            <DataTable
              rows={rows}
              rowKey={(r) => r.id}
              columns={[
                {
                  key: 'n',
                  header: 'Service',
                  primary: true,
                  cell: (r) => <span className="font-medium">{r.name}</span>,
                },
                { key: 't', header: 'Therapist', cell: (r) => r.therapist },
                {
                  key: 'p',
                  header: 'Price',
                  className: 'text-end',
                  cell: (r) => <span className="tabular">{formatAed(r.price)}</span>,
                },
              ]}
            />
          </div>
        </Card>
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <EmptyState
              title="No bookings yet"
              description="New bookings appear here as they come in."
              action={<Button size="sm">New booking</Button>}
            />
          </Card>
          <Card className="space-y-3 p-6">
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-24 w-full" />
          </Card>
        </div>
      </PageBody>
    </AppShell>
  )
}
