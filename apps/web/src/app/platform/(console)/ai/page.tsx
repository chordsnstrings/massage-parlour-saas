import { aiModelConfig, platformDb } from '@spa/db'
import { asc } from 'drizzle-orm'
import type { Metadata } from 'next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field } from '@/components/ui/form'
import { FormSheet } from '@/components/ui/form-sheet'
import { Checkbox, Input } from '@/components/ui/input'
import { PageBody, PageHeader } from '@/components/ui/page'
import { DataTable } from '@/components/ui/table'
import { saveAiModelAction } from '../actions'

export const metadata: Metadata = { title: 'AI models' }

export default async function AiModelsPage() {
  const rows = await platformDb()
    .select()
    .from(aiModelConfig)
    .orderBy(asc(aiModelConfig.kind), asc(aiModelConfig.agentKey))
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
      </PageBody>
    </>
  )
}
