import { aiModelConfig, platformDb, platformSettings } from '@spa/db'
import { asc, eq, sql } from 'drizzle-orm'
import type { Metadata } from 'next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { FormSheet } from '@/components/ui/form-sheet'
import { Checkbox, Input, Textarea } from '@/components/ui/input'
import { PageBody, PageHeader } from '@/components/ui/page'
import { DataTable } from '@/components/ui/table'
import { saveAiModelAction, saveMetaMcpConfigAction } from '../actions'

export const metadata: Metadata = { title: 'AI models' }

export default async function AiModelsPage() {
  const rows = await platformDb()
    .select()
    .from(aiModelConfig)
    .orderBy(asc(aiModelConfig.kind), asc(aiModelConfig.agentKey))
  const [mcp] = await platformDb()
    .select({
      enabled: platformSettings.metaMcpEnabled,
      url: platformSettings.metaMcpUrl,
      hasKey: sql<boolean>`${platformSettings.metaMcpKeyEnc} is not null`,
      tools: platformSettings.metaMcpTools,
    })
    .from(platformSettings)
    .where(eq(platformSettings.id, 1))
  return (
    <>
      <PageHeader
        title="AI models"
        description="BytePlus ModelArk model per agent. Seed 2.0 by default — model IDs change often, so update them here, no deploy needed."
      />
      <PageBody>
        <Card>
          <DataTable
            rows={rows}
            rowKey={(r) => r.agentKey}
            columns={[
              {
                key: 'agent',
                header: 'Agent',
                primary: true,
                cell: (r) => (
                  <span>
                    <span className="block font-medium">{r.label}</span>
                    <span className="text-xs text-muted">{r.agentKey}</span>
                  </span>
                ),
              },
              {
                key: 'model',
                header: 'Model',
                cell: (r) => <span className="font-mono text-[13px]">{r.modelId}</span>,
              },
              {
                key: 'price',
                header: 'Price (USD)',
                cell: (r) => (
                  <span className="tabular text-muted">
                    {r.kind === 'image'
                      ? `${r.pricePerImage}/image`
                      : `${r.priceInPerM} in · ${r.priceOutPerM} out /1M`}
                  </span>
                ),
              },
              {
                key: 'status',
                header: 'Status',
                cell: (r) => (
                  <Badge tone={r.enabled ? 'success' : 'neutral'}>{r.enabled ? 'On' : 'Off'}</Badge>
                ),
              },
              {
                key: 'edit',
                header: <span className="sr-only">Edit</span>,
                className: 'text-end',
                cell: (r) => (
                  <FormSheet
                    title={r.label}
                    description={r.agentKey}
                    action={saveAiModelAction}
                    trigger={
                      <Button variant="ghost" size="sm">
                        Edit
                      </Button>
                    }
                  >
                    <input type="hidden" name="agentKey" value={r.agentKey} />
                    <Field label="Model ID" name="modelId">
                      <Input id="modelId" name="modelId" defaultValue={r.modelId} className="font-mono" />
                    </Field>
                    <div className="grid grid-cols-2 gap-4">
                      <Field label="Input $/1M" name="priceInPerM">
                        <Input
                          id="priceInPerM"
                          name="priceInPerM"
                          inputMode="decimal"
                          defaultValue={r.priceInPerM}
                        />
                      </Field>
                      <Field label="Output $/1M" name="priceOutPerM">
                        <Input
                          id="priceOutPerM"
                          name="priceOutPerM"
                          inputMode="decimal"
                          defaultValue={r.priceOutPerM}
                        />
                      </Field>
                      <Field label="Cached input $/1M" name="priceCachedInPerM">
                        <Input
                          id="priceCachedInPerM"
                          name="priceCachedInPerM"
                          inputMode="decimal"
                          defaultValue={r.priceCachedInPerM}
                        />
                      </Field>
                      <Field label="$ per image" name="pricePerImage">
                        <Input
                          id="pricePerImage"
                          name="pricePerImage"
                          inputMode="decimal"
                          defaultValue={r.pricePerImage}
                        />
                      </Field>
                    </div>
                    <label className="flex items-center gap-2.5 text-sm">
                      <Checkbox name="supportsStructuredOutput" defaultChecked={r.supportsStructuredOutput} />{' '}
                      Supports structured (JSON schema) output
                    </label>
                    <label className="flex items-center gap-2.5 text-sm">
                      <Checkbox name="enabled" defaultChecked={r.enabled} /> Enabled
                    </label>
                  </FormSheet>
                ),
              },
            ]}
          />
        </Card>
        <Card className="mt-6" data-testid="meta-mcp-config">
          <CardHeader
            title="External Meta MCP server"
            description="Optional (R7): an official or third-party Meta MCP server (Streamable HTTP) for the meta_agent. Our own Meta tools need no setup. Only the tool names listed here are offered, and any WhatsApp send-like tool is always dropped — WhatsApp stays click-to-send."
          />
          <CardBody>
            <ActionForm action={saveMetaMcpConfigAction} className="grid gap-5 sm:grid-cols-2">
              <Field label="Server URL" name="url" className="sm:col-span-2">
                <Input
                  id="url"
                  name="url"
                  type="url"
                  placeholder="https://mcp.example.com/mcp"
                  defaultValue={mcp?.url ?? ''}
                  className="font-mono"
                />
              </Field>
              <Field
                label="API key"
                name="key"
                hint={
                  mcp?.hasKey
                    ? 'A key is stored (encrypted). Leave blank to keep it.'
                    : 'Sent as a Bearer token.'
                }
              >
                <Input id="key" name="key" type="password" autoComplete="off" />
              </Field>
              <Field label="Allowed tool names" name="tools" hint="Space, comma or newline separated.">
                <Textarea id="tools" name="tools" rows={3} defaultValue={(mcp?.tools ?? []).join('\n')} />
              </Field>
              <label className="flex items-center gap-2.5 text-sm">
                <Checkbox name="enabled" defaultChecked={mcp?.enabled ?? false} /> Enabled
              </label>
              {mcp?.hasKey && (
                <label className="flex items-center gap-2.5 text-sm">
                  <Checkbox name="clearKey" /> Remove the stored key
                </label>
              )}
              <div className="sm:col-span-2">
                <SubmitButton>Save</SubmitButton>
              </div>
            </ActionForm>
          </CardBody>
        </Card>
      </PageBody>
    </>
  )
}
