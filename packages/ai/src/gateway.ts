import { aiModelConfig, aiUsage, type Db, platformDb, tenants } from '@spa/db'
import { and, eq, gte, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  type ChatMessage,
  type ChatRequest,
  createModelArkClient,
  type ModelArkClient,
  type ToolDef,
  type Usage,
} from './modelark'

export type ModelConfig = typeof aiModelConfig.$inferSelect

export class AiBudgetExceededError extends Error {
  constructor(readonly tenantId: string) {
    super('Monthly AI budget reached')
  }
}
export class AiDisabledError extends Error {}
export class AiOutputError extends Error {}

/** USD cost of one call from token usage and the configured prices (per 1M tokens). */
export function costOf(
  cfg: Pick<ModelConfig, 'priceInPerM' | 'priceOutPerM' | 'priceCachedInPerM'>,
  usage?: Usage,
) {
  if (!usage) return 0
  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0
  const fresh = Math.max(usage.prompt_tokens - cached, 0)
  return (
    (fresh * Number(cfg.priceInPerM) +
      cached * Number(cfg.priceCachedInPerM) +
      usage.completion_tokens * Number(cfg.priceOutPerM)) /
    1e6
  )
}

/** First instant of the current month in Asia/Dubai (UTC+4, no DST). */
export function dubaiMonthStart(now = new Date()) {
  const dubai = new Date(now.getTime() + 4 * 3600_000)
  return new Date(Date.UTC(dubai.getUTCFullYear(), dubai.getUTCMonth(), 1) - 4 * 3600_000)
}

export async function monthSpendUsd(db: Db, tenantId: string, now = new Date()) {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${aiUsage.costUsd}), 0)` })
    .from(aiUsage)
    .where(and(eq(aiUsage.tenantId, tenantId), gte(aiUsage.createdAt, dubaiMonthStart(now))))
  return Number(row?.total ?? 0)
}

/** OpenAI-compatible multimodal user content (vision models): text + images as data: or https: URLs. */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } }
export type InputMessage = ChatMessage | { role: 'user'; content: ContentPart[] }

export type RunChatOptions<T extends z.ZodType | undefined> = {
  tenantId: string
  agentKey: string
  messages: InputMessage[]
  tools?: ToolDef[]
  /** Validates the reply as JSON. Uses json_schema mode when the model supports it, else instructions + one retry. */
  schema?: T
  temperature?: number
  maxTokens?: number
  db?: Db
  client?: ModelArkClient
}

export type RunChatResult<T> = {
  message: Extract<ChatMessage, { role: 'assistant' }>
  output: T
  costUsd: number
  modelId: string
}

/**
 * The single entry point for chat models: config lookup → budget check → call → validate → meter.
 * Model IDs come from `ai_model_config` (super-admin), never from code.
 */
export async function runChat<T extends z.ZodType | undefined = undefined>(
  opts: RunChatOptions<T>,
): Promise<RunChatResult<T extends z.ZodType ? z.infer<T> : string | null>> {
  const db = opts.db ?? platformDb()
  const client = opts.client ?? createModelArkClient()
  const cfg = await db.query.aiModelConfig.findFirst({ where: eq(aiModelConfig.agentKey, opts.agentKey) })
  if (!cfg?.enabled || cfg.kind !== 'chat')
    throw new AiDisabledError(`AI agent "${opts.agentKey}" is disabled`)
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, opts.tenantId),
    columns: { aiBudgetUsd: true },
  })
  if (!tenant) throw new Error('unknown tenant')
  if ((await monthSpendUsd(db, opts.tenantId)) >= Number(tenant.aiBudgetUsd))
    throw new AiBudgetExceededError(opts.tenantId)

  const jsonSchema = opts.schema ? z.toJSONSchema(opts.schema) : undefined
  // Image parts go over the wire as-is; the client's ChatMessage type only models text.
  const messages = [...opts.messages] as ChatMessage[]
  const request: ChatRequest = {
    model: cfg.modelId,
    messages,
    tools: opts.tools,
    temperature: opts.temperature,
    max_tokens: opts.maxTokens,
    ...(cfg.params as Partial<ChatRequest>),
  }
  if (jsonSchema) {
    if (cfg.supportsStructuredOutput) {
      request.response_format = {
        type: 'json_schema',
        json_schema: { name: 'output', schema: jsonSchema, strict: true },
      }
    } else {
      messages.unshift({
        role: 'system',
        content: `Reply with JSON only (no prose, no code fences) matching this JSON Schema:\n${JSON.stringify(jsonSchema)}`,
      })
    }
  }

  let totalCost = 0
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Awaited<ReturnType<ModelArkClient['chat']>>
    try {
      res = await client.chat({ ...request, messages })
    } catch (e) {
      await db
        .insert(aiUsage)
        .values({ tenantId: opts.tenantId, agentKey: opts.agentKey, modelId: cfg.modelId, status: 'error' })
      throw e
    }
    const cost = costOf(cfg, res.usage)
    totalCost += cost
    await db.insert(aiUsage).values({
      tenantId: opts.tenantId,
      agentKey: opts.agentKey,
      modelId: cfg.modelId,
      tokensIn: res.usage?.prompt_tokens ?? 0,
      tokensOut: res.usage?.completion_tokens ?? 0,
      tokensCached: res.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      costUsd: cost.toFixed(6),
    })
    const message = res.choices[0]?.message
    if (!message) throw new AiOutputError('empty response')
    if (!opts.schema || message.tool_calls?.length) {
      return { message, output: message.content as never, costUsd: totalCost, modelId: cfg.modelId }
    }
    const parsed = opts.schema.safeParse(parseJson(message.content))
    if (parsed.success)
      return { message, output: parsed.data as never, costUsd: totalCost, modelId: cfg.modelId }
    if (attempt === 1) throw new AiOutputError(`invalid output: ${parsed.error.message}`)
    messages.push(message, {
      role: 'user',
      content: `That reply was not valid. Fix it and reply with JSON only. Errors: ${parsed.error.message}`,
    })
  }
  throw new AiOutputError('unreachable')
}

function parseJson(content: string | null) {
  if (!content) return undefined
  const trimmed = content.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')
  try {
    return JSON.parse(trimmed)
  } catch {
    return undefined
  }
}

/** Image generation (Seedream) with the same config lookup, budget check and metering as chat. */
export async function runImage(opts: {
  tenantId: string
  agentKey: string
  prompt: string
  size?: string
  db?: Db
  client?: ModelArkClient
}) {
  const db = opts.db ?? platformDb()
  const client = opts.client ?? createModelArkClient()
  const cfg = await db.query.aiModelConfig.findFirst({ where: eq(aiModelConfig.agentKey, opts.agentKey) })
  if (!cfg?.enabled || cfg.kind !== 'image')
    throw new AiDisabledError(`AI image model "${opts.agentKey}" is disabled`)
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, opts.tenantId),
    columns: { aiBudgetUsd: true },
  })
  if (!tenant) throw new Error('unknown tenant')
  if ((await monthSpendUsd(db, opts.tenantId)) >= Number(tenant.aiBudgetUsd))
    throw new AiBudgetExceededError(opts.tenantId)
  const res = await client.image({ model: cfg.modelId, prompt: opts.prompt, size: opts.size })
  const cost = Number(cfg.pricePerImage)
  await db.insert(aiUsage).values({
    tenantId: opts.tenantId,
    agentKey: opts.agentKey,
    modelId: cfg.modelId,
    images: 1,
    costUsd: cost.toFixed(6),
  })
  const url = res.data[0]?.url
  if (!url) throw new AiOutputError('no image returned')
  return { url, costUsd: cost }
}
