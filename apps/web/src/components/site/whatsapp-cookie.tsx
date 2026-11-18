'use client'
// R47: a block page can't set a cookie from the server, so a new visitor's WhatsApp number (assigned there) is saved
// here: the same first-party `spa_wa` cookie the design page sets, kept 30 days (server/whatsapp-rotation.ts).
import { useEffect } from 'react'

export function WhatsappCookie({ number, path }: { number: string; path: string }) {
  useEffect(() => {
    if (!/^\d{8,15}$/.test(number)) return
    const secure = window.location.protocol === 'https:' ? '; Secure' : ''
    // biome-ignore lint/suspicious/noDocumentCookie: one plain cookie; the Cookie Store API is missing in older Safari
    document.cookie = `spa_wa=${number}; Path=${path}; Max-Age=${30 * 86_400}; SameSite=Lax${secure}`
  }, [number, path])
  return null
}
