'use client'
// F15/F16 print + share buttons (vouchers, QR posters). WhatsApp is click-to-send only: a link the staff opens.
import { MessageCircle, Printer } from 'lucide-react'
import { useEffect, useState } from 'react'
import { WA_MODE_KEY, type WaMode } from '@/components/messages/shared'
import { Button } from '@/components/ui/button'

export function PrintNow({ label }: { label: string }) {
  return (
    <Button type="button" onClick={() => window.print()}>
      <Printer /> {label}
    </Button>
  )
}

/** Opens WhatsApp with the text, in the send mode this device uses for the outbox (web / desktop app / phone). */
export function WhatsAppShare({ links, label }: { links: Record<WaMode, string>; label: string }) {
  const [mode, setMode] = useState<WaMode>('web')
  useEffect(() => {
    let stored: string | null = null
    try {
      stored = window.localStorage.getItem(WA_MODE_KEY)
    } catch {}
    if (stored === 'web' || stored === 'desktop' || stored === 'mobile') setMode(stored)
    else if (window.matchMedia?.('(pointer: coarse)').matches) setMode('mobile')
  }, [])
  return (
    <Button variant="secondary" asChild>
      <a href={links[mode]} target="spa-whatsapp" rel="noopener" data-testid="voucher-share">
        <MessageCircle /> {label}
      </a>
    </Button>
  )
}
