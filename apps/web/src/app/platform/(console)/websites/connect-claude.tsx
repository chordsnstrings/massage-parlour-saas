'use client'
import { useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { CopyButton } from '@/components/ui/copy-button'
import { toast } from '@/components/ui/toast'
import { formatDateTime } from '@/lib/utils'
import { revokeClaudeClientAction } from './claude-actions'

export type ClaudeClient = {
  clientId: string
  name: string
  connectedAt: string | null
  lastUsedAt: string | null
}

/**
 * Console card for the AI assistant MCP connector (R25: Claude or ChatGPT): the URL to add in either assistant, the
 * setup steps for both, and this account's connected clients with Revoke. Usable only by SITE_AI_EDITOR_EMAILS
 * accounts.
 */
export function ConnectClaudeCard({
  url,
  enabled,
  clients,
}: {
  url: string
  enabled: boolean
  clients: ClaudeClient[]
}) {
  const [pending, start] = useTransition()
  const revoke = (clientId: string) =>
    start(async () => {
      const r = await revokeClaudeClientAction(clientId)
      if (r?.ok) toast.success(r.message ?? 'Disconnected')
      else if (r) toast.error(r.error)
    })
  return (
    <Card aria-label="Connect Claude or ChatGPT">
      <CardHeader
        title="Connect Claude or ChatGPT"
        description="Edit spa websites from Claude or ChatGPT. Changes are saved as drafts; you preview and publish here as usual."
      />
      <CardBody className="space-y-4">
        {!enabled && (
          <p role="note" className="rounded-xl border bg-subtle/50 p-3 text-sm text-muted">
            Connecting Claude or ChatGPT isn’t enabled for your account (SITE_AI_EDITOR_EMAILS).
          </p>
        )}
        <div className="space-y-1.5">
          <ul aria-label="Setup" className="list-disc space-y-1 ps-5 text-xs text-muted">
            <li>
              <span className="font-medium text-fg">Claude:</span> Settings → Connectors → Add custom
              connector, paste this URL.
            </li>
            <li>
              <span className="font-medium text-fg">ChatGPT:</span> Settings → Apps &amp; Connectors →
              Advanced settings → turn on Developer mode → Create, paste this URL and choose OAuth.
            </li>
          </ul>
          <p className="text-xs text-muted">
            Then sign in here with your super-admin account and two-step code and choose Allow.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg border bg-subtle/50 px-3 py-2 text-sm">
              {url}
            </code>
            <CopyButton value={url} />
          </div>
        </div>
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Connected clients</h3>
          {clients.length ? (
            <ul aria-label="Connected clients" className="divide-y rounded-xl border">
              {clients.map((c) => (
                <li key={c.clientId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{c.name}</span>
                    <span className="block text-xs text-muted">
                      {c.connectedAt ? `Connected ${formatDateTime(new Date(c.connectedAt))}` : 'Connected'}
                      {c.lastUsedAt ? ` · last sign-in ${formatDateTime(new Date(c.lastUsedAt))}` : ''}
                    </span>
                  </span>
                  <Button variant="secondary" size="sm" onClick={() => revoke(c.clientId)} pending={pending}>
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No assistant connected yet.</p>
          )}
        </div>
      </CardBody>
    </Card>
  )
}
