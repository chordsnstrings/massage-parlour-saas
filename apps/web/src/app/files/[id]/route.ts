import { serveFile } from '../serve'

/** A stored file by id (see ../serve.ts for access and caching rules). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return serveFile(req, (await params).id)
}
