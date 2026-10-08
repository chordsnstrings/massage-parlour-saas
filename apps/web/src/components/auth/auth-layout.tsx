import { Logo } from '@/components/brand'
import { Reveal } from '@/components/ui/motion'

const points = [
  'Bookings, walk-ins and rooms on one calm calendar',
  'Cash-first POS, packages and simple accounts',
  'A beautiful website and AI that fills empty slots',
]

export function AuthLayout({
  children,
  title,
  subtitle,
}: {
  children: React.ReactNode
  title: string
  subtitle?: React.ReactNode
}) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="relative hidden overflow-hidden border-e bg-subtle/60 lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
        <div className="pointer-events-none absolute -top-32 -left-24 size-[28rem] rounded-full bg-accent-soft blur-3xl" />
        <Logo className="relative h-8 self-start" />
        <div className="relative max-w-md space-y-8">
          <h2 className="text-[34px] leading-[1.15] font-semibold tracking-tight">Run a calmer spa.</h2>
          <ul className="space-y-4 text-[15px] text-muted">
            {points.map((p) => (
              <li key={p} className="flex gap-3">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" />
                {p}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-sm text-muted">Made for spas across the UAE.</p>
      </aside>
      <main className="flex flex-col px-5 py-8 sm:px-10 lg:justify-center lg:px-16">
        <Logo className="mb-12 h-7 self-start lg:hidden" />
        <Reveal className="mx-auto w-full max-w-[400px]">
          <div className="mb-8 space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {subtitle && <p className="text-[15px] text-muted">{subtitle}</p>}
          </div>
          {children}
        </Reveal>
      </main>
    </div>
  )
}
