import { ArrowRight } from 'lucide-react'
import type { Metadata } from 'next'
import { TEMPLATES } from '@/components/marketing/content'
import { EditorMock } from '@/components/marketing/mocks'
import { CtaBand, MarketingShell } from '@/components/marketing/shell'
import { appUrl } from '@/lib/paths'

export const metadata: Metadata = {
  title: 'Website builder',
  description:
    'Eight designer templates, drag-and-drop editing, English and Arabic, online booking built in.',
}

const POINTS = [
  { title: 'English and Arabic', text: 'Every page in both languages, right-to-left done properly.' },
  { title: 'Looks right on phones', text: 'Style each section for phone, tablet and desktop separately.' },
  {
    title: 'Safe to change',
    text: 'Version history, one-click template undo and checks before you publish.',
  },
  { title: 'Booking built in', text: 'Every page carries your Book button, tracked by source.' },
  { title: 'Your own domain', text: 'Connect yours or buy one from us — HTTPS included.' },
  { title: 'AI when you want it', text: 'Draft and translate copy, or let AI write the first version.' },
]

const css = (vars: Record<string, number>) => vars as React.CSSProperties

export default function WebsiteBuilderPage() {
  return (
    <MarketingShell active="website-builder">
      <section className="mkt-wrap pt-20 pb-16 text-center sm:pt-28">
        <p className="mkt-eyebrow mkt-rise">Website builder</p>
        <h1 className="mkt-rise mx-auto mt-4 max-w-3xl text-[38px] leading-[1.06] font-semibold tracking-tight sm:text-[56px]">
          A beautiful spa website, in an afternoon.
        </h1>
        <p
          className="mkt-rise mx-auto mt-5 max-w-xl text-[17px] text-[var(--ink-2)]"
          style={css({ '--d': 1 })}
        >
          Pick a template, drop in your services and photos, publish. Change anything later — nothing breaks.
        </p>
      </section>

      {/* The editor turns to face you while its sections build up */}
      <section data-scene="device" data-pin="wide" style={css({ '--len': 300 })} className="tint-mist">
        <div data-stage>
          <div className="mkt-wrap py-20">
            <div data-world className="mx-auto max-w-4xl">
              <EditorMock />
            </div>
          </div>
        </div>
      </section>

      {/* Templates fly into the gallery */}
      <section data-scene="assemble" className="mkt-wrap py-24">
        <p className="mkt-eyebrow">Eight templates</p>
        <h2 className="mt-3 max-w-xl text-3xl font-semibold tracking-tight sm:text-[40px] sm:leading-tight">
          Start from a design made for spas.
        </h2>
        <div className="mt-12 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {TEMPLATES.map((t) => (
            <div
              key={t.name}
              data-beat
              className="mkt-card overflow-hidden border border-[var(--line)] bg-white"
            >
              <div className="aspect-[4/3] p-4" style={{ background: t.colors[0] }}>
                <div className="h-1.5 w-10 rounded-full" style={{ background: t.colors[1] }} />
                <div
                  className="mt-3 h-2.5 w-3/4 rounded-full opacity-80"
                  style={{ background: t.colors[2] }}
                />
                <div
                  className="mt-1.5 h-2.5 w-1/2 rounded-full opacity-80"
                  style={{ background: t.colors[2] }}
                />
                <div className="mt-4 h-10 rounded-md opacity-40" style={{ background: t.colors[1] }} />
              </div>
              <div className="px-4 py-3">
                <p className="text-[14px] font-medium">{t.name}</p>
                <p className="text-[12px] text-[var(--mute)]">{t.mood}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-[var(--line)]">
        <div className="mkt-wrap grid gap-x-10 gap-y-12 py-24 sm:grid-cols-2 lg:grid-cols-3">
          {POINTS.map((p) => (
            <div key={p.title} data-scene="reveal" data-span=".45">
              <h3 className="font-medium">{p.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-[var(--ink-2)]">{p.text}</p>
            </div>
          ))}
        </div>
        <div className="mkt-wrap pb-8 text-center">
          <a href={appUrl('/signup')} className="mkt-link inline-flex items-center gap-1.5 font-medium">
            Build yours now <ArrowRight className="mkt-arrow size-4" />
          </a>
        </div>
      </section>

      <CtaBand title="Your spa, beautifully online." />
    </MarketingShell>
  )
}
