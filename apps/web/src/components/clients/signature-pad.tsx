'use client'
import { Eraser } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { SIGNATURE_VIEWBOX } from './shared'

type Point = [number, number]

/**
 * Pointer-event signature pad (finger, stylus or mouse). Strokes are kept in a fixed
 * 600×200 space and submitted as SVG path data through a hidden input.
 */
export function SignaturePad({
  name,
  label,
  clearLabel = 'Clear',
  hint,
  className,
}: {
  name: string
  label: string
  clearLabel?: string
  hint?: string
  className?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const strokes = useRef<Point[][]>([])
  const drawing = useRef<Point[] | null>(null)
  const [path, setPath] = useState('')

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) {
      canvas.width = Math.round(rect.width * dpr)
      canvas.height = Math.round(rect.height * dpr)
    }
    const sx = canvas.width / SIGNATURE_VIEWBOX.w
    const sy = canvas.height / SIGNATURE_VIEWBOX.h
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = 2.4 * dpr
    ctx.strokeStyle = getComputedStyle(canvas).color
    for (const stroke of strokes.current) {
      ctx.beginPath()
      stroke.forEach(([x, y], i) => {
        if (i) ctx.lineTo(x * sx, y * sy)
        else ctx.moveTo(x * sx, y * sy)
      })
      if (stroke.length === 1) ctx.lineTo(stroke[0]![0] * sx + 0.1, stroke[0]![1] * sy)
      ctx.stroke()
    }
  }, [])

  useEffect(() => {
    redraw()
    const canvas = canvasRef.current
    if (!canvas) return
    const ro = new ResizeObserver(redraw)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [redraw])

  const toPoint = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * SIGNATURE_VIEWBOX.w
    const y = ((e.clientY - rect.top) / rect.height) * SIGNATURE_VIEWBOX.h
    const clamp = (v: number, max: number) => Math.round(Math.min(Math.max(v, 0), max) * 10) / 10
    return [clamp(x, SIGNATURE_VIEWBOX.w), clamp(y, SIGNATURE_VIEWBOX.h)]
  }

  const commit = () =>
    setPath(
      strokes.current
        .filter((s) => s.length > 1)
        .map((s) => s.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' '))
        .join(' '),
    )

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] font-medium">{label}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-11 sm:h-8"
          onClick={() => {
            strokes.current = []
            setPath('')
            redraw()
          }}
        >
          <Eraser /> {clearLabel}
        </Button>
      </div>
      <div className="relative overflow-hidden rounded-xl border bg-surface">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={label}
          data-testid="signature-pad"
          className="block aspect-[3/1] w-full cursor-crosshair touch-none text-fg"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            drawing.current = [toPoint(e)]
            strokes.current.push(drawing.current)
            redraw()
          }}
          onPointerMove={(e) => {
            if (!drawing.current) return
            const p = toPoint(e)
            const last = drawing.current[drawing.current.length - 1]!
            if (Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]) < 1) return
            drawing.current.push(p)
            redraw()
          }}
          onPointerUp={() => {
            drawing.current = null
            commit()
          }}
          onPointerCancel={() => {
            drawing.current = null
            commit()
          }}
        />
        <div className="pointer-events-none absolute inset-x-6 bottom-[22%] border-b border-dashed border-border" />
        {!path && (
          <span className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-muted/70">
            {hint}
          </span>
        )}
      </div>
      <input type="hidden" name={name} value={path} />
    </div>
  )
}

/** Renders a captured signature path. */
export function SignatureImage({ path, className }: { path: string; className?: string }) {
  return (
    <svg
      viewBox={`0 0 ${SIGNATURE_VIEWBOX.w} ${SIGNATURE_VIEWBOX.h}`}
      className={cn('w-full text-fg', className)}
      role="img"
      aria-label="Signature"
    >
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
