import '@fontsource-variable/dm-sans'
import '@fontsource-variable/space-grotesk'
import '../brand-app.css'
import { Check } from 'lucide-react'
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
    // Marketing look (.mkt-app, components/brand-app.css; R13 §14.8): dark band beside a white form column.
    <div className="mkt-app grid min-h-dvh bg-surface lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="mkt-app-dark relative hidden lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
        <Logo className="relative h-14 self-start" />
        <div className="relative max-w-md space-y-7">
          <span className="mkt-app-chip">Automation for UAE spas</span>
          <h2 className="text-[44px] leading-[1.02] font-bold">
            More bookings.
            <br />
            Less work.
          </h2>
          <ul className="space-y-4 text-[15px] text-muted">
            {points.map((p) => (
              <li key={p} className="flex gap-3">
                <Check className="mt-0.5 size-[18px] shrink-0 text-accent" strokeWidth={2.25} />
                {p}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-sm text-muted">Made for spas across the UAE.</p>
      </aside>
      <main className="flex flex-col px-5 py-8 sm:px-10 lg:justify-center lg:px-16">
        <Logo className="mb-12 h-12 self-start lg:hidden" />
        <Reveal className="mx-auto w-full max-w-[400px]">
          <div className="mb-8 space-y-2">
            <h1 className="text-[32px] leading-[1.05]">{title}</h1>
            {subtitle && <p className="text-[15px] text-muted">{subtitle}</p>}
          </div>
          {children}
        </Reveal>
      </main>
    </div>
  )
}
