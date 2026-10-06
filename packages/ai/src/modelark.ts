/** Minimal OpenAI-compatible client for BytePlus ModelArk (no SDK dependency). */

export type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } }
export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; content: string; tool_call_id: string }
export type ToolDef = {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

export type ChatRequest = {
  model: string
  messages: ChatMessage[]
  tools?: ToolDef[]
  response_format?:
    | { type: 'json_object' }
    | { type: 'json_schema'; json_schema: { name: string; schema: unknown; strict?: boolean } }
  temperature?: number
  max_tokens?: number
}

export type Usage = {
  prompt_tokens: number
  completion_tokens: number
  prompt_tokens_details?: { cached_tokens?: number }
}
export type ChatResponse = {
  choices: { message: Extract<ChatMessage, { role: 'assistant' }>; finish_reason: string }[]
  usage?: Usage
}

export class ModelArkError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`ModelArk ${status}: ${body.slice(0, 300)}`)
  }
}

export type ModelArkClient = ReturnType<typeof createModelArkClient>

export function createModelArkClient(opts: { apiKey?: string; baseUrl?: string; fetch?: typeof fetch } = {}) {
  const apiKey = opts.apiKey ?? process.env.ARK_API_KEY
  // Pay-as-you-go endpoint. Never the /api/coding/v3 path (bills a different plan).
  const baseUrl = (
    opts.baseUrl ??
    process.env.ARK_BASE_URL ??
    'https://ark.ap-southeast.bytepluses.com/api/v3'
  ).replace(/\/$/, '')
  const doFetch = opts.fetch ?? fetch

  async function post<T>(path: string, body: unknown): Promise<T> {
    if (!apiKey) throw new Error('ARK_API_KEY is not set')
    const res = await doFetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new ModelArkError(res.status, await res.text())
    return (await res.json()) as T
  }

  return {
    chat: (req: ChatRequest) => post<ChatResponse>('/chat/completions', req),
    /** Seedream. Returned URLs expire after 7 days — copy to storage immediately. */
    image: (req: { model: string; prompt: string; size?: string }) =>
      post<{ data: { url: string }[] }>('/images/generations', {
        response_format: 'url',
        watermark: false,
        size: '2K',
        ...req,
      }),
  }
}
