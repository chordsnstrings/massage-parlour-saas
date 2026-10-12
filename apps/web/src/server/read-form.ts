/** A multipart body went over its limit (Content-Length is optional behind proxies, so it's counted while read). */
export class TooLarge extends Error {}

/** Parses the multipart body, aborting as soon as more than `limit` bytes have arrived. */
export function readForm(req: Request, limit: number) {
  if (!req.body) return req.formData()
  let total = 0
  const counted = req.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctrl) {
        total += chunk.byteLength
        if (total > limit) ctrl.error(new TooLarge())
        else ctrl.enqueue(chunk)
      },
    }),
  )
  return new Response(counted, { headers: { 'content-type': req.headers.get('content-type') ?? '' } })
    .formData()
    .catch((e) => {
      throw total > limit ? new TooLarge() : e
    })
}

/** R26: the body as text, aborting as soon as more than `limit` bytes have arrived (Content-Length checked first). */
export async function readText(req: Request, limit: number): Promise<string> {
  const declared = Number(req.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > limit) throw new TooLarge()
  if (!req.body) return ''
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel().catch(() => {})
      throw new TooLarge()
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

/** Same-origin POSTs only (fetch/XHR always send Origin on POST). */
export function sameOrigin(req: Request) {
  const origin = req.headers.get('origin')
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  try {
    return Boolean(origin && host && new URL(origin).host === host)
  } catch {
    return false
  }
}
