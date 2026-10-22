// Live check against ModelArk: `pnpm --filter @spa/ai smoke` (needs ARK_API_KEY). Costs a fraction of a cent.
import { createModelArkClient } from './modelark'

if (!process.env.ARK_API_KEY) {
  console.log('ARK_API_KEY not set — skipping smoke test')
  process.exit(0)
}
const model = process.argv[2] ?? 'seed-2-0-lite-260428'
const res = await createModelArkClient().chat({
  model,
  messages: [{ role: 'user', content: 'Reply with {"ok": true} only.' }],
  response_format: {
    type: 'json_schema',
    json_schema: {
      name: 'output',
      schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
      strict: true,
    },
  },
})
console.log(model, res.choices[0]?.message.content, res.usage)
