/* Scene recipes. Every one of them ends (p = 1) with all inline styles removed, i.e. today's design. */
import { beat, type Ctx, clamp, easeOut, type Move, rand, registerScene, timeline } from './scroll-scenes'

const ONE = new Set(['s', 'sx', 'sy', 'o', 'wipe'])

/** "y:16 o:0 sx:0 wipey:0" → Move. Starting pose of a beat, copied from the site's own "before" state. */
export function parseMove(spec: string): Move {
  const m: Record<string, number | string> = {}
  for (const tok of spec.split(/[\s;,]+/).filter(Boolean)) {
    const [k = '', v = ''] = tok.split(':')
    if (k === 'wipey') {
      m.wipe = +v
      m.wipeDir = 'y'
    } else m[k] = +v
  }
  return m as Move
}

/** Interpolates a starting pose toward rest. u = 1 returns {} (rest) so no inline style is left behind. */
export function toward(from: Move, u: number, origin?: string): Move {
  if (u >= 1) return {}
  const m: Record<string, number | string | undefined> = { origin, wipeDir: from.wipeDir }
  for (const [k, v] of Object.entries(from)) {
    if (typeof v !== 'number') continue
    const id = ONE.has(k) ? 1 : 0
    m[k] = v + (id - v) * u
  }
  return m as Move
}

/** [data-beat="n"] elements move in order (same n = same beat) from their data-from pose to rest.
 *  The beat in progress gets data-on (map it to the site's existing "active" style if it has one). */
function beats(stage: HTMLElement) {
  const items = beatsOf(stage)
  const nums = items.map((it, i) => (it.dataset.beat ? +it.dataset.beat : i)) // unnumbered → DOM order
  const groups = [...new Set(nums)].sort((a, b) => a - b)
  const from = items.map((it) => parseMove(it.dataset.from ?? 'y:16 o:0'))
  return (c: Ctx) => {
    const u = groups.map((_, g) => beat(c.p, g, groups.length))
    const cur = c.p >= 0.85 ? -1 : u.reduce((k, v, g) => (v > 0 ? g : k), -1)
    items.forEach((it, i) => {
      const g = groups.indexOf(nums[i] ?? 0)
      c.move(it, toward(from[i] ?? {}, u[g] ?? 1, it.dataset.origin))
      it.toggleAttribute('data-on', g === cur)
    })
  }
}

/** [data-chapter] controls (tabs, chapter dots, step buttons) follow the scroll and jump to their slice. */
function chapters(stage: HTMLElement) {
  const btns = [...stage.querySelectorAll<HTMLElement>('[data-chapter]')]
  let seek = (_p: number) => {}
  btns.forEach((b, i) => {
    // a property, not a listener, so a re-mount replaces it instead of stacking
    b.onclick = (e) => {
      e.preventDefault()
      seek(((i + 0.9) / btns.length) * 0.85)
    }
  })
  return (c: Ctx, q: number) => {
    seek = c.seek
    const k = Math.min(btns.length - 1, Math.floor(q * btns.length))
    btns.forEach((b, i) => {
      if (i === k) b.setAttribute('aria-current', 'step')
      else b.removeAttribute('aria-current')
    })
  }
}

/** beats — a flow, steps or a diagram builds up part by part. */
/** Marked `[data-beat]` parts, else the items inside a `[data-beats]` box (site sections), skipping single
 *  wrappers so a section holding one grid animates the grid's cells. */
function beatsOf(stage: HTMLElement): HTMLElement[] {
  const marked = [...stage.querySelectorAll<HTMLElement>('[data-beat]')]
  if (marked.length) return marked
  let box = stage.querySelector<HTMLElement>('[data-beats]')
  while (box && box.children.length === 1) box = box.firstElementChild as HTMLElement
  return box ? ([...box.children] as HTMLElement[]) : []
}

registerScene('beats', (_el, stage) => {
  const run = beats(stage),
    chap = chapters(stage)
  return (c) => {
    run(c)
    chap(c, clamp(c.p / 0.85))
  }
})

/** device — the section's device or visual ([data-world]) turns from an angle to face you, tilting with
 *  the pointer and floating until it lands; inside it, [data-beat] parts build up and any timed CSS
 *  animation under [data-timeline] is scrubbed. data-timeline="data-run state=play" lists the attributes
 *  that put the existing demo into its playing state. */
registerScene('device', (_el, stage) => {
  const world = stage.querySelector<HTMLElement>('[data-world]')
  const tlRoot = stage.querySelector<HTMLElement>('[data-timeline]')
  tlRoot?.dataset.timeline
    ?.split(/\s+/)
    .filter(Boolean)
    .forEach((a) => {
      const [name = '', value = ''] = a.split('=')
      tlRoot.setAttribute(name, value)
    })
  const tl = tlRoot ? timeline(tlRoot) : null
  tl?.(0)
  const run = beats(stage),
    chap = chapters(stage)
  return (c) => {
    const q = clamp(c.p / 0.85) // the story is told by 85%, then holds
    const land = easeOut(clamp(c.p / 0.5)) // faces you by halfway
    const live = 1 - easeOut(clamp((c.p - 0.7) / 0.15)) // tilt and float fade out before the end
    const k = c.phone ? 0.5 : 1
    if (world)
      c.move(
        world,
        land >= 1 && live <= 0
          ? {}
          : {
              rx: (8 * (1 - land) - c.my * 6 * live) * k,
              ry: (-18 * (1 - land) + c.mx * 10 * live) * k,
              y: Math.sin(c.t * 0.8) * 6 * live,
            },
      )
    tl?.(q)
    run(c)
    chap(c, q)
  }
})

/** assemble — cards start scattered in depth and fly into their place in today's grid. */
registerScene('assemble', (_el, stage) => {
  const items = beatsOf(stage)
  return (c) => {
    const k = c.phone ? 0.45 : 1
    items.forEach((it, i) => {
      const u = beat(c.p, i, items.length, 0.05, 0.8, 0.7),
        v = 1 - u
      c.move(
        it,
        u >= 1
          ? {}
          : {
              x: rand(i + 1) * 450 * k * v,
              y: rand(i + 7) * 250 * k * v,
              z: -(900 + rand(i + 13) * 450) * k * v,
              rx: rand(i + 21) * 35 * v,
              ry: rand(i + 29) * 45 * v,
              o: 0.15 + 0.85 * u,
            },
      )
    })
  }
})

/** rise — bars, bands or tiers are revealed one by one (data-grow="x" sideways, default upward).
 *  Uses a clip wipe, so text inside is never squashed. */
registerScene('rise', (el, stage) => {
  const items = beatsOf(stage)
  const dir = el.dataset.grow === 'x' ? 'x' : 'y'
  return (c) => {
    const u = items.map((_, i) => beat(c.p, i, items.length, 0.05, 0.85, 0.3))
    const cur = c.p >= 0.85 ? -1 : u.reduce((k, v, i) => (v > 0 ? i : k), -1)
    items.forEach((it, i) => {
      const w = u[i] ?? 1
      c.move(it, w >= 1 ? {} : { wipe: w, wipeDir: dir })
      it.toggleAttribute('data-on', i === cur)
    })
  }
})

/** flip — rows hinge open from flat, like a departure board, and land as today's list. */
registerScene('flip', (_el, stage) => {
  const items = beatsOf(stage)
  return (c) =>
    items.forEach((it, i) => {
      const u = beat(c.p, i, items.length, 0.05, 0.85, 0.6)
      c.move(it, u >= 1 ? {} : { rx: -92 * (1 - u), o: 0.08 + 0.92 * u, origin: '50% 0' })
    })
})

/** reveal — ordinary content rises and tilts up into place as it enters (use in place, data-span=".45"). */
registerScene('reveal', (el) => (c) => {
  const u = easeOut(c.p)
  c.move(el, u >= 1 ? {} : { y: 24 * (1 - u), rx: 14 * (1 - u), o: 0.1 + 0.9 * u, origin: '50% 100%' })
})

/** depart — the hero's content ([data-world]) sinks back as the hero scrolls away (data-mode="leave").
 *  Its rest state is the top of the page. */
registerScene('depart', (_el, stage) => {
  const w =
    stage.querySelector<HTMLElement>('[data-world]') ?? (stage.firstElementChild as HTMLElement) ?? stage
  return (c) => {
    const k = c.phone ? 0.5 : 1
    c.move(w, c.p <= 0 ? {} : { y: 80 * c.p * k, z: -180 * c.p * k, rx: 6 * c.p * k, o: 1 - 0.6 * c.p })
  }
})
