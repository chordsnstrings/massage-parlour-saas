'use client'
import { whatsappLink } from '@spa/core'
import { Copy, MessageCircle } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ActionForm, SubmitButton } from '@/components/ui/form'
import { Textarea } from '@/components/ui/input'
import type { ActionResult } from '@/lib/action'

/**
 * "Generate payment reminder" (R12): creates the reminder the spa sees, then offers the message as a click-to-send
 * WhatsApp link (a human presses send) and a copy button. No automated sending.
 */
export function PaymentReminder({
  action,
  phone,
}: {
  action: (prev: ActionResult, fd: FormData) => Promise<ActionResult>
  /** Spa owner's WhatsApp/phone in E.164 digits, or null to let WhatsApp ask for the contact. */
  phone: string | null
}) {
  const [message, setMessage] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const href = message
    ? phone
      ? whatsappLink(phone, message)
      : `https://wa.me/?text=${encodeURIComponent(message)}`
    : null
  return (
    <div className="space-y-3">
      <ActionForm
        action={action}
        onSuccess={(r) => {
          setMessage(typeof r.data?.message === 'string' ? r.data.message : null)
          setCopied(false)
        }}
      >
        <SubmitButton variant="secondary">Generate payment reminder</SubmitButton>
      </ActionForm>
      {message && href && (
        <div className="space-y-2">
          <Textarea readOnly value={message} rows={8} aria-label="Reminder message" />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" asChild>
              <a href={href} target="_blank" rel="noreferrer">
                <MessageCircle /> Send on WhatsApp
              </a>
            </Button>
            <Button
              size="sm"
              variant="secondary"
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(message).then(() => setCopied(true))
              }}
            >
              <Copy /> {copied ? 'Copied' : 'Copy message'}
            </Button>
          </div>
          {!phone && (
            <p className="text-xs text-muted">
              No spa phone on file — WhatsApp will ask you to pick the contact.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
