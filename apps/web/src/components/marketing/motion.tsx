'use client'
import { useEffect, useRef } from 'react'

// Marketing motion ("C · Bold product-led", owner 2026-10-08). Driven only by DOM queries and data attributes so the
// same effect body also runs on statically exported HTML (no other React state):
// - [data-mkt-nav] top bar hides on scroll down, returns on scroll up (no-JS fallback lives in marketing.css);
// - [data-tilt] product frames start tilted back in 3D (perspective 1200px) and straighten as they reach the centre
//   of the viewport, reversing on the way up; they follow the mouse gently on desktop;
// - [data-rise] blocks rise with a scroll-linked 3D tilt and stagger (reverses on scroll up); [data-rise="card"]
//   also leans towards the pointer;
// - [data-depth="k"] hero layers drift at their own depth (parallax on scroll, and with the mouse on desktop);
// - a relaxing aurora of soft greens, teal, mint, lime and sky drifts behind the page (the canvas rendered here).
// Positions come from cached layout offsets (offsetTop ignores transforms), so frames only write transform /
// translate / opacity: no layout reads in the loop. Motion runs for every visitor, including OS reduced motion
// (owner decision 2026-10-07). Everything pauses while the tab is hidden.

const cl = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const ez = (x: number) => 1 - (1 - x) ** 3
const smooth = (x: number) => x * x * (3 - 2 * x)
const f2 = (n: number) => Math.round(n * 100) / 100

// rgb, centre x/y (0–1), drift x/y amplitude, period (s), radius (× max side), alpha, scroll pull
const BLOBS: [string, number, number, number, number, number, number, number, number][] = [
  ['110,201,160', 0.18, 0.22, 0.16, 0.12, 34, 0.62, 0.2, 0.12],
  ['94,196,186', 0.82, 0.28, 0.14, 0.16, 27, 0.58, 0.16, -0.1],
  ['174,236,207', 0.5, 0.62, 0.22, 0.14, 38, 0.7, 0.26, 0.16],
  ['217,242,106', 0.88, 0.78, 0.12, 0.12, 24, 0.42, 0.16, -0.14],
  ['150,200,250', 0.12, 0.84, 0.14, 0.1, 31, 0.5, 0.15, 0.1],
  ['15,107,75', 0.62, 0.08, 0.18, 0.08, 40, 0.46, 0.06, 0.08],
]

type Spot = { el: HTMLElement; top: number; h: number; last: string }

export function MarketingMotion() {
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const cv = canvas.current
    const root = cv?.closest<HTMLElement>('.mkt')
    const g = cv?.getContext('2d')
    if (!cv || !root || !g) return
    root.classList.add('mkt-js')
    const ac = new AbortController()
    const { signal } = ac
    const opt = { passive: true, signal }
    let raf = 0
    let vw = innerWidth
    let vh = innerHeight
    let phone = vw < 700
    let fine = false
    const finePointer = matchMedia('(hover: hover) and (pointer: fine)')
    const sizes = () => {
      vw = innerWidth
      vh = innerHeight
      phone = vw < 700
      fine = finePointer.matches && vw > 980
    }
    sizes()

    /* top bar: hides on scroll down, returns on scroll up */
    const nv = root.querySelector<HTMLElement>('[data-mkt-nav]')
    let ly = scrollY
    let acc = 0
    addEventListener(
      'scroll',
      () => {
        if (!nv) return
        const y = scrollY
        const d = y - ly
        ly = y
        nv.classList.toggle('scrolled', y > 10)
        acc = Math.sign(d) === Math.sign(acc) ? acc + d : d
        if (y < 120 || acc < -12) nv.classList.remove('hide')
        else if (acc > 12) nv.classList.add('hide')
      },
      opt,
    )
    nv?.addEventListener('focusin', () => nv.classList.remove('hide'), { signal })

    /* pointer (normalised −0.5…0.5), smoothed in the frame loop */
    let mx = 0
    let my = 0
    let sx = 0
    let sy = 0
    addEventListener(
      'pointermove',
      (e) => {
        if (e.pointerType !== 'mouse') return
        mx = e.clientX / vw - 0.5
        my = e.clientY / vh - 0.5
      },
      opt,
    )

    /* layout cache: page offsets ignore transforms, so the effects never feed back into their own measurements */
    const pageTop = (el: HTMLElement) => {
      let y = 0
      let n: HTMLElement | null = el
      while (n) {
        y += n.offsetTop
        n = n.offsetParent as HTMLElement | null
      }
      return y
    }
    const spot = (el: HTMLElement): Spot => ({ el, top: 0, h: 0, last: '' })

    const rise = [...root.querySelectorAll<HTMLElement>('[data-rise]')].map((el) => {
      el.classList.add('mkt-r3')
      const sibs = [...(el.parentElement?.children ?? [])].filter((c) => c.hasAttribute('data-rise'))
      const it = { ...spot(el), k: sibs.indexOf(el) % 4, op: '', tx: 0, ty: 0, hx: 0, hy: 0 }
      if (el.dataset.rise === 'card') {
        el.addEventListener(
          'pointermove',
          (e) => {
            if (e.pointerType !== 'mouse') return
            const r = el.getBoundingClientRect()
            it.tx = (e.clientX - r.left) / r.width - 0.5
            it.ty = (e.clientY - r.top) / r.height - 0.5
          },
          { signal },
        )
        el.addEventListener(
          'pointerleave',
          () => {
            it.tx = 0
            it.ty = 0
          },
          { signal },
        )
      }
      return it
    })
    const tilts = [...root.querySelectorAll<HTMLElement>('[data-tilt]')].map((el) => ({
      ...spot(el),
      t: 1,
    }))
    const depth = [...root.querySelectorAll<HTMLElement>('[data-depth]')].map((el) => ({
      ...spot(el),
      d: Number(el.dataset.depth) || 0,
    }))
    let docH = 0
    const measure = () => {
      for (const it of [...rise, ...tilts]) {
        it.top = pageTop(it.el)
        it.h = it.el.offsetHeight
      }
      docH = document.documentElement.scrollHeight
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(document.body)
    addEventListener(
      'resize',
      () => {
        sizes()
        measure()
        size()
      },
      opt,
    )
    document.fonts?.ready.then(measure)

    const write = (it: { el: HTMLElement; last: string }, v: string) => {
      if (v === it.last) return
      it.last = v
      it.el.style.transform = v
    }

    /* sections and cards rise in 3D, linked to scroll (reverses when scrolling back up) */
    const riseFx = (y: number) => {
      const lift = phone ? 46 : 90
      const tip = phone ? 14 : 26
      for (const it of rise) {
        const top = it.top - y
        if (top > vh + 240 || top + it.h < -240) continue
        const q = ez(cl((vh - top) / (vh * 0.62) - (phone ? 0 : it.k * 0.09)))
        const u = 1 - q
        it.hx += (it.tx - it.hx) * 0.12
        it.hy += (it.ty - it.hy) * 0.12
        const hover = fine ? ` rotateX(${f2(-it.hy * 6)}deg) rotateY(${f2(it.hx * 8)}deg)` : ''
        write(
          it,
          `perspective(1000px) translate3d(0,${f2(u * lift)}px,${f2(-u * 140)}px) rotateX(${f2(u * tip)}deg)${hover}`,
        )
        const op = (0.04 + 0.96 * q).toFixed(3)
        if (op !== it.op) {
          it.op = op
          it.el.style.opacity = op
        }
      }
    }

    /* product frames: tilted back until their centre reaches the middle of the viewport, then flat */
    const tiltFx = (y: number) => {
      const A = phone ? 13 : 22
      for (const it of tilts) {
        const top = it.top - y
        if (top > vh + 300 || top + it.h < -300) continue
        const c = top + it.h / 2
        const target = smooth(cl((c - vh * 0.5) / (vh * 0.6)))
        it.t += (target - it.t) * 0.16
        const t = it.t
        const mouse = fine ? ` rotateY(${f2(sx * 9)}deg) rotateX(${f2(-sy * 6)}deg)` : ''
        write(
          it,
          `perspective(1200px) translate3d(0,${f2(t * (phone ? 24 : 70))}px,0) rotateX(${f2(t * A)}deg)${mouse} scale(${f2(1 - t * (phone ? 0.05 : 0.1))})`,
        )
      }
    }

    /* hero depth layers: parallax with scroll (and the mouse on desktop) */
    const depthFx = (y: number) => {
      if (y > vh * 1.6) return
      for (const it of depth) {
        const px = fine ? sx * it.d * 150 : 0
        const py = y * it.d + (fine ? sy * it.d * 90 : 0)
        const v = `${f2(px)}px ${f2(py)}px`
        if (v === it.last) continue
        it.last = v
        it.el.style.translate = v
      }
    }

    /* relaxing aurora: long 24–40 s drifts, slight pull with scroll, drawn small and scaled up by CSS */
    let W = 0
    let H = 0
    const size = () => {
      const d = 0.3
      W = vw
      H = vh
      cv.width = Math.ceil(W * d)
      cv.height = Math.ceil(H * d)
      g.setTransform(d, 0, 0, d, 0, 0)
    }
    size()
    let sp = 0
    const draw = (t: number, y: number) => {
      sp += (cl(y / Math.max(1, docH - vh)) - sp) * 0.04
      g.clearRect(0, 0, W, H)
      const R = Math.max(W, H)
      for (const [c, cx, cy, ax, ay, period, rad, alpha, pull] of BLOBS) {
        const w = (Math.PI * 2) / period
        const ph = cx * 7 + cy * 3
        const px = W * (cx + ax * Math.sin(t * w + ph) + pull * 0.4 * Math.sin(sp * Math.PI * 2))
        const py = H * (cy + ay * Math.cos(t * w * 0.8 + ph) - pull * sp)
        const r = R * rad * (1 + 0.08 * Math.sin(t * w * 1.3 + ph))
        const grd = g.createRadialGradient(px, py, 0, px, py, r)
        grd.addColorStop(0, `rgba(${c},${alpha})`)
        grd.addColorStop(0.55, `rgba(${c},${f2(alpha * 0.35)})`)
        grd.addColorStop(1, `rgba(${c},0)`)
        g.fillStyle = grd
        g.fillRect(0, 0, W, H)
      }
    }

    const T0 = performance.now()
    let lastBg = -1e9
    const frame = (now: number) => {
      const y = scrollY
      sx += ((fine ? mx : 0) - sx) * 0.06
      sy += ((fine ? my : 0) - sy) * 0.06
      riseFx(y)
      tiltFx(y)
      depthFx(y)
      if (now - lastBg > 32) {
        lastBg = now
        draw((now - T0) / 1000, y)
      }
      raf = requestAnimationFrame(frame)
    }
    const start = () => {
      cancelAnimationFrame(raf)
      if (!document.hidden) raf = requestAnimationFrame(frame)
    }
    document.addEventListener('visibilitychange', start, { signal })
    start()

    return () => {
      ac.abort()
      ro.disconnect()
      cancelAnimationFrame(raf)
      root.classList.remove('mkt-js')
    }
  }, [])

  // biome-ignore lint/a11y/noAriaHiddenOnFocusable: decorative background canvas, never focusable
  return <canvas ref={canvas} className="mkt-calm" aria-hidden="true" />
}
