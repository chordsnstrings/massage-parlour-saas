import { serveFile } from '../../serve'

/** Same file with a readable name (nicer downloads, extension-based edge caching). The name is ignored. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string; name: string }> }) {
  return serveFile(req, (await params).id)
}
