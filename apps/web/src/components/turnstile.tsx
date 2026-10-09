'use client'
// F9 (G17): Cloudflare Turnstile widget for public forms. Managed mode with appearance "interaction-only": invisible
// unless Cloudflare wants a click. The server verifies the token (server/turnstile.ts). No site key → inert.
import { useCallback, useEffect, useRef, useState } from 'react'

type TurnstileApi = {
  render(el: HTMLElement, opts: Record<string, unknown>): string | undefined
  reset(id: string): void
  remove(id: string): void
}
declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

/** Same name as core `TURNSTILE_FIELD` (client code doesn't import the @spa/core root). */
export const TURNSTILE_FIELD = 'cf-turnstile-response'
const API = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
const WAIT_MS = 30_000

let loader: Promise<TurnstileApi> | null = null
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  loader ??= new Promise<TurnstileApi>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = API
    s.async = true
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile')))
    s.onerror = () => {
      loader = null
      reject(new Error('turnstile'))
    }
    document.head.appendChild(s)
  })
  return loader
}

/**
 * `ref` goes on an empty `<div>` inside the form (the widget renders there when it needs the visitor). Before sending,
 * `await getToken()` (waits for the widget; '' without a site key or when it fails — the server then answers with
 * its bot-check message); after every answer `reset()`, because a token is single-use.
 */
export function useTurnstile(siteKey: string | null | undefined, action: string, language?: string) {
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  const widget = useRef<string | null>(null)
  const token = useRef('')
  /** Script blocked or the widget errored: a submit gets '' at once instead of waiting (Turnstile keeps retrying). */
  const failed = useRef(false)
  const waiting = useRef<((t: string) => void)[]>([])

  useEffect(() => {
    if (!siteKey || !el) return
    let gone = false
    const settle = (t: string) => {
      token.current = t
      failed.current = !t
      for (const resolve of waiting.current.splice(0)) resolve(t)
    }
    loadTurnstile()
      .then((api) => {
        if (gone) return
        widget.current =
          api.render(el, {
            sitekey: siteKey,
            action,
            language: language ?? 'auto',
            appearance: 'interaction-only',
            'response-field': false,
            callback: settle,
            'expired-callback': () => {
              token.current = ''
            },
            'error-callback': () => {
              // Turnstile retries on its own; a waiting submit gets '' now instead of hanging.
              settle('')
              return true
            },
          }) ?? null
      })
      .catch(() => settle(''))
    return () => {
      gone = true
      failed.current = false
      if (widget.current) window.turnstile?.remove(widget.current)
      widget.current = null
      token.current = ''
    }
  }, [siteKey, el, action, language])

  const getToken = useCallback(async () => {
    if (!siteKey) return ''
    if (token.current || failed.current) return token.current
    return new Promise<string>((resolve) => {
      const done = (t: string) => {
        clearTimeout(timer)
        resolve(t)
      }
      const timer = setTimeout(() => {
        waiting.current = waiting.current.filter((w) => w !== done)
        resolve('')
      }, WAIT_MS)
      waiting.current.push(done)
    })
  }, [siteKey])

  const reset = useCallback(() => {
    token.current = ''
    if (widget.current) window.turnstile?.reset(widget.current)
  }, [])

  return { ref: setEl, getToken, reset }
}
