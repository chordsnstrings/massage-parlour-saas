// Lightweight product illustrations in HTML/CSS (no images).

const STAFF = ['Aya', 'Mei', 'Noor', 'Ravi']
const HOURS = ['10:00', '11:00', '12:00', '13:00', '14:00']
const BOOKINGS: {
  col: number
  start: number
  len: number
  name: string
  what: string
  tint: string
}[] = [
  { col: 0, start: 0, len: 1.5, name: 'Layla H.', what: 'Deep tissue · 90', tint: 'tint-mist' },
  { col: 1, start: 0.5, len: 1, name: 'Sara K.', what: 'Swedish · 60', tint: 'tint-sage' },
  { col: 2, start: 1, len: 2, name: 'Couples', what: 'Hot stone · 120', tint: 'tint-plum' },
  { col: 3, start: 1, len: 2, name: 'Couples', what: 'Hot stone · 120', tint: 'tint-plum' },
  { col: 0, start: 2, len: 1, name: 'Walk-in', what: 'Foot · 60', tint: 'tint-sand' },
  { col: 1, start: 2.5, len: 1.5, name: 'Noura A.', what: 'Thai · 90', tint: 'tint-clay' },
]
const ROW = 52 // px per hour

/** Today's calendar in the C product frame: dark device bezel around a white screen. */
export function CalendarMock() {
  return (
    <div className="mkt-device">
      <div className="mkt-screen">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3.5 sm:px-5">
          <div className="flex items-center gap-2.5">
            <span className="mkt-pulse size-2 rounded-full bg-[var(--sage)]" />
            <strong className="mkt-head text-[15px] sm:text-[17px]">Today · Jumeirah branch</strong>
          </div>
          <span className="rounded-full bg-[var(--lime)] px-3 py-1 text-[11px] font-semibold sm:text-[12px]">
            14 bookings · 2 walk-ins
          </span>
        </div>
        <div className="grid grid-cols-[3.25rem_repeat(4,minmax(0,1fr))] text-[11px]">
          <div />
          {STAFF.map((s) => (
            <div key={s} className="px-2 py-2 font-semibold">
              {s}
            </div>
          ))}
          <div className="relative col-span-5 grid grid-cols-[3.25rem_repeat(4,minmax(0,1fr))]">
            <div>
              {HOURS.map((h) => (
                <div key={h} style={{ height: ROW }} className="px-2.5 pt-1 text-[var(--mute)] tabular-nums">
                  {h}
                </div>
              ))}
            </div>
            {STAFF.map((s, col) => (
              <div key={s} className="relative">
                {HOURS.map((h) => (
                  <div key={h} style={{ height: ROW }} className="border-t border-[var(--grey)]" />
                ))}
                {BOOKINGS.filter((b) => b.col === col).map((b) => (
                  <div
                    key={`${b.name}-${b.start}`}
                    style={{ top: b.start * ROW + 3, height: b.len * ROW - 6 }}
                    className={`absolute inset-x-1 rounded-[10px] px-2 py-1.5 ${b.tint}`}
                  >
                    <p className="truncate font-semibold text-[var(--ink)]">{b.name}</p>
                    <p className="truncate text-[10px] text-[var(--ink-2)]">{b.what}</p>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

const BLOCKS = ['Hero', 'Services', 'Team', 'Offers', 'Reviews', 'Book button']

export function EditorMock() {
  return (
    <div className="overflow-hidden rounded-[1.25rem] border border-[var(--line)] bg-white shadow-[0_30px_80px_-40px_rgb(35_34_31/0.35)]">
      <div className="flex items-center gap-1.5 border-b border-[var(--line)] px-4 py-3">
        <span className="size-2.5 rounded-full bg-[var(--clay)]" />
        <span className="size-2.5 rounded-full bg-[var(--sand)]" />
        <span className="size-2.5 rounded-full bg-[var(--sage)]" />
        <span className="ms-3 truncate rounded-full bg-[var(--sand-soft)] px-3 py-1 text-[11px] text-[var(--mute)]">
          serenity.spamanagement.ae
        </span>
      </div>
      <div className="grid grid-cols-[8.5rem_1fr] text-[11px] sm:grid-cols-[10rem_1fr]">
        <div className="space-y-1.5 border-e border-[var(--line)] p-3">
          <p className="px-1 pb-1 text-[10px] font-medium tracking-wide text-[var(--mute)] uppercase">
            Blocks
          </p>
          {BLOCKS.map((b) => (
            <div key={b} className="rounded-md border border-[var(--line)] px-2 py-1.5 text-[var(--ink-2)]">
              {b}
            </div>
          ))}
        </div>
        <div className="space-y-2.5 bg-[var(--sand-soft)] p-3">
          <div data-beat="1" data-from="y:18 o:0" className="rounded-lg bg-white p-4">
            <div className="h-2 w-16 rounded-full bg-[var(--sage)]" />
            <div className="mt-3 h-3.5 w-4/5 rounded-full bg-[var(--ink)]/80" />
            <div className="mt-2 h-3.5 w-3/5 rounded-full bg-[var(--ink)]/80" />
            <div className="mt-4 inline-block rounded-full bg-[var(--ink)] px-3 py-1.5 text-[10px] text-white">
              Book now
            </div>
          </div>
          <div data-beat="2" data-from="y:18 o:0" className="grid grid-cols-3 gap-2">
            {['tint-sage', 'tint-clay', 'tint-mist'].map((t) => (
              <div key={t} className={`h-16 rounded-lg ${t}`} />
            ))}
          </div>
          <div data-beat="3" data-from="y:18 o:0" className="flex items-center gap-3 rounded-lg bg-white p-3">
            <div className="size-8 rounded-full bg-[var(--plum-soft)]" />
            <div className="flex-1 space-y-1.5">
              <div className="h-2 w-3/5 rounded-full bg-[var(--ink)]/70" />
              <div className="h-2 w-2/5 rounded-full bg-[var(--mute)]/50" />
            </div>
            <span className="text-[var(--clay)]">★★★★★</span>
          </div>
        </div>
      </div>
    </div>
  )
}
