'use client'
import { useEffect, useRef } from 'react'

// Mint Cloud motion — the page script of docs/design/01-mint-cloud.html, ported and adapted to this markup:
// - [data-mkt-nav] top bar hides on scroll down, returns on scroll up (no-JS fallback lives in marketing.css);
// - [data-rise] blocks rise with a soft 3D tilt linked to scroll (reverses on the way back); [data-rise="card"]
//   also leans towards the pointer;
// - [data-tilt] product visuals sit tilted in 3D, straighten as they scroll in and follow the mouse;
// - a soft mint / sky / peach light drifts behind the page (the canvas this component renders).
// The design's own reduced-motion handling is kept: CSS stops animations/transitions; here the background
// draws once and stays still.

const REVEAL = (u: number) => `translateY(${u * 70}px) rotateX(${u * 28}deg)`
const cl = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const ez = (x: number) => 1 - (1 - x) ** 3
const rgb = (hex: string) => {
  let h = hex.replace('#', '')
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('')
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16)).join(',')
}
// colour key, radius, x/y amplitude, x/y speed, phase
const BLOBS: [string, number, number, number, number, number, number][] = [
  ['a', 0.55, 0.3, 0.25, 0.05, 0.04, 0],
  ['b', 0.5, 0.32, 0.3, 0.04, 0.05, 2],
  ['c', 0.42, 0.3, 0.3, 0.06, 0.035, 4],
  ['a', 0.38, 0.25, 0.32, 0.035, 0.055, 5.5],
]

export function MarketingMotion() {
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const cv = canvas.current
    const root = cv?.closest<HTMLElement>('.mkt')
    const x = cv?.getContext('2d')
    if (!cv || !root || !x) return
    root.classList.add('mkt-js')
    const ac = new AbortController()
    const { signal } = ac
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    let raf = 0
    let rafBg = 0

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
        if (y < 120 || acc < -14) nv.classList.remove('hide')
        else if (acc > 14) nv.classList.add('hide')
      },
      { passive: true, signal },
    )
    nv?.addEventListener('focusin', () => nv.classList.remove('hide'), { signal })

    let mx = 0
    let my = 0
    addEventListener(
      'pointermove',
      (e) => {
        mx = e.clientX / innerWidth - 0.5
        my = e.clientY / innerHeight - 0.5
      },
      { passive: true, signal },
    )

    /* sections enter in 3D, linked to scroll (reverses when scrolling back up) */
    const rise = [...root.querySelectorAll<HTMLElement>('[data-rise]')].map((el) => {
      el.classList.add('mkt-r3')
      const it = {
        el,
        k: [...(el.parentElement?.children ?? [])].indexOf(el) % 3,
        tx: 0,
        ty: 0,
        hx: 0,
        hy: 0,
        done: false,
      }
      if (el.dataset.rise === 'card') {
        el.addEventListener(
          'pointermove',
          (e) => {
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
    const revFx = () => {
      const vh = innerHeight
      const m = innerWidth < 700
      for (const it of rise) {
        const r = it.el.getBoundingClientRect()
        const vis = !(r.top > vh + 150 || r.bottom < -150)
        if (!vis && it.done) continue
        it.done = !vis
        const q = ez(cl((vh - r.top) / (vh * 0.6) - (m ? 0 : it.k * 0.08)))
        const u = 1 - q
        it.hx += (it.tx - it.hx) * 0.12
        it.hy += (it.ty - it.hy) * 0.12
        it.el.style.transform = `perspective(1100px) ${REVEAL(u)} rotateX(${-it.hy * 7}deg) rotateY(${it.hx * 9}deg)`
        it.el.style.opacity = (0.08 + 0.92 * q).toFixed(3)
      }
    }

    /* product visual: straightens from its 3D tilt as it scrolls in, follows the mouse */
    const tilts = [...root.querySelectorAll<HTMLElement>('[data-tilt]')]
    let sx = 0
    let sy = 0
    const tiltFx = (t: number) => {
      const m = innerWidth <= 980
      sx += ((m ? Math.sin(t * 0.4) * 0.3 : mx) - sx) * 0.06
      sy += ((m ? Math.cos(t * 0.3) * 0.2 : my) - sy) * 0.06
      for (const tl of tilts) {
        const h = cl((innerHeight - tl.getBoundingClientRect().top) / (innerHeight * 0.8))
        const k = 1 - ez(h)
        tl.style.transform = `rotateX(${14 * k - sy * 6}deg) rotateY(${-18 * k + sx * 8}deg) rotateZ(${2 * k}deg) translateZ(${h * 40}px)`
      }
    }

    const T0 = performance.now()
    const frame = (now: number) => {
      revFx()
      tiltFx((now - T0) / 1000)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    /* soft mint aurora background */
    const css = (n: string) => getComputedStyle(root).getPropertyValue(n).trim()
    const C: Record<string, string> = { a: rgb(css('--t1')), b: rgb(css('--t2')), c: rgb(css('--t3')) }
    let W = 0
    let H = 0
    const size = () => {
      const d = 0.4
      W = innerWidth
      H = innerHeight
      cv.width = W * d
      cv.height = H * d
      x.setTransform(d, 0, 0, d, 0, 0)
    }
    size()
    addEventListener('resize', size, { signal })
    const draw = (n: number) => {
      const t = n / 1000
      x.clearRect(0, 0, W, H)
      const R = Math.max(W, H)
      const s = scrollY * 0.0004
      for (const [c, r, ax, ay, bx, by, ph] of BLOBS) {
        const px = W * (0.6 + ax * Math.sin(t * bx + ph + s))
        const py = H * (0.4 + ay * Math.cos(t * by + ph - s))
        const g = x.createRadialGradient(px, py, 0, px, py, R * r)
        g.addColorStop(0, `rgba(${C[c]},.55)`)
        g.addColorStop(1, `rgba(${C[c]},0)`)
        x.fillStyle = g
        x.fillRect(0, 0, W, H)
      }
      if (!reduce) rafBg = requestAnimationFrame(draw)
    }
    rafBg = requestAnimationFrame(draw)

    return () => {
      ac.abort()
      cancelAnimationFrame(raf)
      cancelAnimationFrame(rafBg)
      root.classList.remove('mkt-js')
    }
  }, [])

  // biome-ignore lint/a11y/noAriaHiddenOnFocusable: decorative background canvas, never focusable
  return <canvas ref={canvas} className="mkt-calm" aria-hidden="true" />
}
