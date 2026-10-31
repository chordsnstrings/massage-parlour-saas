// scroll-scenes — scroll replaces the clock. Framework-free, no dependencies.

export type Move = {
  x?: number
  y?: number
  z?: number // px
  rx?: number
  ry?: number
  rz?: number // deg
  s?: number
  sx?: number
  sy?: number // scale
  o?: number // opacity multiplier
  wipe?: number // 0→1 clip reveal (see wipeDir)
  wipeDir?: 'x' | 'y' // x: from inline-start, y: from the bottom
  origin?: string // transform-origin while moving
}

export type Ctx = {
  el: HTMLElement // the element with data-scene
  stage: HTMLElement // its [data-stage] (or el itself)
  p: number // 0 → 1 through the scene
  t: number // seconds since mount, for idle float (0 while frozen)
  mx: number
  my: number // pointer, −0.5 → 0.5 (0 while frozen)
  phone: boolean // viewport ≤ 620px
  move(target: HTMLElement, m: Move): void // inline styles while moving; removed at rest
  seek(p: number): void // smooth-scroll so this scene sits at progress p (pinned scenes)
}
export type Scene = (el: HTMLElement, stage: HTMLElement) => (c: Ctx) => void

const registry = new Map<string, Scene>()
export const registerScene = (name: string, scene: Scene) => {
  registry.set(name, scene)
}

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v))
export const easeOut = (t: number) => 1 - (1 - t) ** 3

/** Eased progress of beat i of n. Beats share [from, to] of the scene and overlap their neighbours;
 *  everything has landed by `to`, leaving a short hold before the pin releases. */
export function beat(p: number, i: number, n: number, from = 0.05, to = 0.85, overlap = 0.5) {
  const w = (to - from) / (n - (n - 1) * overlap)
  return easeOut(clamp((p - from - i * w * (1 - overlap)) / w))
}

/** Seeded random in [−1, 1] so a scene looks the same on every run (and in screenshots). */
export const rand = (seed: number) => {
  const x = Math.sin(seed * 9301 + 49297) * 233280
  return (x - Math.floor(x)) * 2 - 1
}

/** Scroll replaces the clock for every finite CSS/Web animation under root: the timeline is paused
 *  and its currentTime is set from progress, so delays, durations and easing stay exactly as designed.
 *  If the animations only exist in a "playing" state, put the element in that state first. */
const scrubbed = new Set<Animation>()
export function timeline(root: Element) {
  let anims: Animation[] = []
  let end = 0
  const collect = () => {
    anims = root
      .getAnimations({ subtree: true })
      .filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime as number))
    end = Math.max(0, ...anims.map((a) => a.effect!.getComputedTiming().endTime as number))
    anims.forEach((a) => {
      a.pause()
      scrubbed.add(a)
    })
  }
  return (p: number) => {
    if (!anims.length || anims.some((a) => a.playState === 'idle')) collect()
    anims.forEach((a) => {
      if (a.playState !== 'paused') {
        a.pause()
        scrubbed.add(a)
      }
      a.currentTime = p * end
    })
  }
}

/* ---------- inline styles, applied only while something is moving ---------- */

const PERSPECTIVE = 1400
const base = new WeakMap<HTMLElement, { t: string; o: number; rtl: boolean }>()
const touched = new Set<HTMLElement>()

function rest(el: HTMLElement) {
  const s = el.style
  s.transform = s.opacity = s.transformOrigin = s.clipPath = s.transition = ''
  touched.delete(el)
}

/** Motion switched off or page left: no inline styles, timed demos jump to their final frame. */
function restAll() {
  touched.forEach(rest)
  scrubbed.forEach((a) => {
    try {
      a.finish()
    } catch {
      /* removed from the DOM */
    }
  })
  scrubbed.clear()
}

function move(el: HTMLElement, m: Move) {
  const { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1, sx = 1, sy = 1, o = 1, wipe = 1 } = m
  if (!x && !y && !z && !rx && !ry && !rz && s === 1 && sx === 1 && sy === 1 && o === 1 && wipe === 1) {
    if (touched.has(el)) rest(el) // at rest the element is styled only by the site's own CSS
    return
  }
  if (!touched.has(el)) {
    // remember the design's own transform/opacity, then compose
    const cs = getComputedStyle(el)
    base.set(el, {
      t: cs.transform === 'none' ? '' : cs.transform,
      o: parseFloat(cs.opacity),
      rtl: cs.direction === 'rtl',
    })
    touched.add(el)
  }
  const b = base.get(el)!
  const st = el.style
  st.transition = 'none' // the site's own transitions must not smooth scroll-driven values
  st.transformOrigin = m.origin ?? ''
  st.transform =
    `perspective(${PERSPECTIVE}px) translate3d(${x}px,${y}px,${z}px) rotateX(${rx}deg) ` +
    `rotateY(${ry}deg) rotateZ(${rz}deg) scale3d(${s * sx},${s * sy},1) ${b.t}`
  st.opacity = String(b.o * o)
  if (wipe < 1) {
    const cut = `${((1 - wipe) * 100).toFixed(2)}%`
    st.clipPath =
      m.wipeDir === 'y' ? `inset(${cut} 0 0 0)` : b.rtl ? `inset(0 0 0 ${cut})` : `inset(0 ${cut} 0 0)`
  } else st.clipPath = ''
}

/* ---------- the engine ---------- */

type Live = {
  el: HTMLElement
  stage: HTMLElement
  run: (c: Ctx) => void
  on: boolean
  mode: 'pin' | 'enter' | 'leave'
  top: number
  padT: number
  padB: number
  stageH: number
  span: number
  p: number
  /** Left the viewport since the last frame: draw once more so a jump past it (anchor, End key) lands at rest. */
  flush: boolean
}

/** Finds every [data-scene] under root and drives it. Returns a cleanup function
 *  (call it on route change / unmount). Does nothing unless <html> has "scenes-on". */
export function mountScenes(root: ParentNode = document): () => void {
  const html = document.documentElement
  if (!html.classList.contains('scenes-on')) return () => {}

  const live: Live[] = []
  root.querySelectorAll<HTMLElement>('[data-scene]').forEach((el) => {
    const scene = registry.get(el.dataset.scene!)
    if (!scene) {
      console.warn(`[scroll-scenes] unknown scene "${el.dataset.scene}"`, el)
      return
    }
    const stage = el.querySelector<HTMLElement>(':scope > [data-stage]') ?? el
    live.push({
      el,
      stage,
      run: scene(el, stage),
      on: false,
      mode: 'enter',
      top: 0,
      padT: 0,
      padB: 0,
      stageH: 0,
      span: 0.7,
      p: -1,
      flush: false,
    })
  })

  const measure = () => {
    const phone = innerWidth <= 620
    for (const s of live) {
      const pin = s.el.hasAttribute('data-pin') && !(s.el.dataset.pin === 'wide' && phone)
      s.mode = pin ? 'pin' : s.el.dataset.mode === 'leave' ? 'leave' : 'enter'
      const cs = getComputedStyle(s.el)
      s.padT = parseFloat(cs.paddingTop) + parseFloat(cs.borderTopWidth)
      s.padB = parseFloat(cs.paddingBottom) + parseFloat(cs.borderBottomWidth)
      s.top = pin ? parseFloat(getComputedStyle(s.stage).top) || 0 : 0
      s.stageH = s.stage.offsetHeight
      s.span = parseFloat(s.el.dataset.span ?? '') || 0.7
      s.p = -1 // force a redraw
      if (pin && s.stage.scrollHeight > s.stage.clientHeight + 1)
        console.warn(
          '[scroll-scenes] pinned content is taller than the viewport; use data-pin="wide" or a shorter section',
          s.el,
        )
    }
  }
  measure()

  const io = new IntersectionObserver(
    (entries) =>
      entries.forEach((e) => {
        const s = live.find((x) => x.el === e.target)
        if (s) {
          if (s.on && !e.isIntersecting) s.flush = true
          s.on = e.isIntersecting
        }
      }),
    { rootMargin: '25% 0px' },
  )
  for (const s of live) io.observe(s.el)

  let mx = 0,
    my = 0,
    raf = 0,
    off = false
  const t0 = performance.now()
  const onPointer = (e: PointerEvent) => {
    mx = e.clientX / innerWidth - 0.5
    my = e.clientY / innerHeight - 0.5
  }
  addEventListener('pointermove', onPointer, { passive: true })
  addEventListener('resize', measure)
  document.fonts?.ready.then(measure) // web fonts can change paddings and heights

  const seekFor = (s: Live) => (p: number) => {
    if (s.mode !== 'pin') return s.el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    const r = s.el.getBoundingClientRect()
    const y = scrollY + r.top + s.padT - s.top + p * (r.height - s.padT - s.padB - s.stageH)
    scrollTo({ top: Math.round(y), behavior: 'smooth' })
  }

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame)
    if (!html.classList.contains('scenes-on')) {
      // motion switched off at runtime
      if (!off) {
        restAll()
        off = true
      }
      return
    }
    if (off) {
      off = false
      measure()
    }
    const still = html.hasAttribute('data-scenes-still') // set by tests for repeatable screenshots
    const vh = innerHeight,
      phone = innerWidth <= 620,
      t = still ? 0 : (now - t0) / 1000
    // Off-screen scenes still mid-move (a jump past them: anchor, End key, fling) are drawn until they settle.
    const act = live.filter((s) => s.on || s.flush || (s.p >= 0 && s.p < 1))
    const rects = act.map((s) => s.el.getBoundingClientRect()) // read everything, then write
    act.forEach((s, i) => {
      const r = rects[i] as DOMRect
      const p =
        s.mode === 'pin'
          ? clamp((s.top - r.top - s.padT) / (r.height - s.padT - s.padB - s.stageH))
          : s.mode === 'leave'
            ? clamp(-r.top / r.height)
            : clamp((vh - r.top) / (vh * s.span))
      s.flush = false
      const idle = !still && p > 0 && p < 1 // pointer tilt / float keep moving
      if (p === s.p && !idle) return
      s.p = p
      s.run({
        el: s.el,
        stage: s.stage,
        p,
        t,
        mx: still ? 0 : mx,
        my: still ? 0 : my,
        phone,
        move,
        seek: seekFor(s),
      })
    })
  }
  raf = requestAnimationFrame(frame)

  return () => {
    cancelAnimationFrame(raf)
    io.disconnect()
    removeEventListener('pointermove', onPointer)
    removeEventListener('resize', measure)
    restAll()
  }
}
