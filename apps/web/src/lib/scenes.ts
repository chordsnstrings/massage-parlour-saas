/* Scene recipes. Every one of them ends (p = 1) with all inline styles removed, i.e. today's design. */
import {
  beat,
  type Ctx,
  clamp,
  easeOut,
  type Move,
  rand,
  registerScene,
  type Scene,
  timeline,
} from './scroll-scenes'

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
  const box = stage.querySelector<HTMLElement>('[data-beats]')
  return box ? itemsIn(box) : []
}

/** Skips single wrappers; a "title + grid" box yields the grid's cells (the cards are what should move). */
function itemsIn(start: HTMLElement): HTMLElement[] {
  let box = start
  while (box.children.length === 1) box = box.firstElementChild as HTMLElement
  const kids = [...box.children] as HTMLElement[]
  const lists = kids.filter((k) => k.children.length >= 3)
  return kids.length <= 3 && lists.length === 1 ? itemsIn(lists[0]!) : kids
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

/* ---------- design-template scenes (R5): each card starts in a pose and travels to rest ---------- */

/** Where an item sits in its stage (layout offsets, so the item's own transform never skews it). */
type Geo = {
  i: number
  n: number
  /** Item centre relative to the stage centre, in px and as a share of the stage width (−0.5…0.5). */
  dx: number
  dy: number
  fx: number
  /** Physical side of the stage centre (−1 left, 1 right) and the inline direction (1 LTR, −1 RTL). */
  side: -1 | 1
  dir: 1 | -1
}
type Pose = (g: Geo) => Move

const abs = (el: HTMLElement) => {
  let x = 0
  let y = 0
  for (let e: HTMLElement | null = el; e; e = e.offsetParent as HTMLElement | null) {
    x += e.offsetLeft
    y += e.offsetTop
  }
  return { x, y }
}

/** Builds a scene from a starting pose per item; beats overlap by `overlap` (1 → all together). */
function posed(pose: Pose, overlap = 0.55): Scene {
  return (_el, stage) => {
    const items = beatsOf(stage)
    let width = -1
    let poses: Move[] = []
    const measure = () => {
      width = stage.offsetWidth
      const s = abs(stage)
      const cx = s.x + stage.offsetWidth / 2
      const cy = s.y + stage.offsetHeight / 2
      const dir = getComputedStyle(stage).direction === 'rtl' ? -1 : 1
      poses = items.map((it, i) => {
        const a = abs(it)
        const dx = a.x + it.offsetWidth / 2 - cx
        const dy = a.y + it.offsetHeight / 2 - cy
        return pose({ i, n: items.length, dx, dy, fx: dx / Math.max(1, width), side: dx < 0 ? -1 : 1, dir })
      })
    }
    return (c) => {
      if (stage.offsetWidth !== width) measure()
      const k = c.phone ? 0.5 : 1
      const a = c.phone ? 0.7 : 1
      items.forEach((it, i) => {
        const u = beat(c.p, i, items.length, 0.05, 0.82, overlap)
        const m = poses[i] ?? {}
        const scaled: Move = { ...m }
        for (const key of ['x', 'y', 'z'] as const) if (m[key] !== undefined) scaled[key] = m[key]! * k
        for (const key of ['rx', 'ry', 'rz'] as const) if (m[key] !== undefined) scaled[key] = m[key]! * a
        c.move(it, toward(scaled, u, m.origin))
      })
    }
  }
}

const SCENE_POSES: Record<string, [Pose, number]> = {
  /** Noir Gold: the cards start as a fanned hand in the middle and deal out to the grid. */
  fan: [(g) => ({ x: -g.dx, y: 60 - g.dy * 0.4, rz: (g.i - (g.n - 1) / 2) * 9, origin: '50% 140%' }), 0.75],
  /** Ivory Marble: each card turns in like the next face of a cube. */
  cube: [(g) => ({ ry: 90 * g.dir, z: -120, o: 0.2, origin: g.dir > 0 ? '0% 50%' : '100% 50%' }), 0.45],
  /** Emerald Prestige: two doors swing open from the outer hinges. */
  doors: [(g) => ({ ry: g.side < 0 ? 75 : -75, o: 0.35, origin: g.side < 0 ? '0% 50%' : '100% 50%' }), 0.9],
  /** Platinum Minimal: cards slide past and turn, like a gallery coverflow. */
  coverflow: [(g) => ({ x: 420 * g.dir, z: -260, ry: -55 * g.dir, o: 0 }), 0.6],
  /** Desert Night: the steps approach from far down the road. */
  road: [() => ({ z: -1400, y: -140, rx: 28, o: 0, origin: '50% 100%' }), 0.55],
  /** Monogram Atelier: pages turn over from the spine. */
  pages: [(g) => ({ ry: -120 * g.dir, o: 0.15, origin: g.dir > 0 ? '0% 50%' : '100% 50%' }), 0.4],
  /** Obsidian Glass: the faces of a prism wrap around the centre and open flat. */
  prism: [(g) => ({ x: -g.dx * 0.55, z: -320 - Math.abs(g.fx) * 500, ry: -g.fx * 130, o: 0.3 }), 0.85],
  /** Sandstone Bronze: stone slabs start stacked and slide apart. */
  slabs: [(g) => ({ x: -g.dx, y: -g.dy, z: -g.i * 40, rz: g.i % 2 ? -3 : 3 }), 0.7],
  /** Aurora Glass: glass layers start stacked in depth and separate. */
  layers: [(g) => ({ y: -g.dy * 0.7, z: -160 * (g.i + 1), rx: 48, o: 0.45 }), 0.7],
  /** Blueprint: blocks rise one by one onto the grid. */
  blocks: [() => ({ y: 220, rx: 58, o: 0, origin: '50% 100%' }), 0.3],
  /** Sahara: the steps unfold like a folded brochure. */
  brochure: [(g) => ({ ry: g.i % 2 ? -88 : 88, o: 0.3, origin: g.i % 2 ? '0% 50%' : '100% 50%' }), 0.55],
  /** Clay: cards flip over to their front. */
  turn: [(g) => ({ ry: -170 * g.dir, y: 30, o: 0.1, origin: '50% 50%' }), 0.5],
}
for (const [name, [pose, overlap]] of Object.entries(SCENE_POSES)) registerScene(name, posed(pose, overlap))
