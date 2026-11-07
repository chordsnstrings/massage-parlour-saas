import { DomainError, inlineHtmlDesignDocs } from '@spa/services'
import { isPlatformAdmin } from '@/server/access'
import { templateDocReader } from '@/server/html-design-files'
import { getSession } from '@/server/session'
import { loadAdminTemplate } from '../../data'

/** Template studio: download a template (studio row or built-in) as JSON for editing or moving between envs. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session || !(await isPlatformAdmin(session.user.id))) return new Response('Not found', { status: 404 })
  const template = await loadAdminTemplate((await params).id)
  if (!template) return new Response('Not found', { status: 404 })
  // R24: an HTML design goes into the file itself (its stored file exists only on this install).
  const read = templateDocReader()
  let pages: typeof template.pages
  try {
    pages = await Promise.all(
      template.pages.map(async (p) => ({ ...p, data: await inlineHtmlDesignDocs(p.data, read) })),
    )
  } catch (e) {
    // A missing design file: a clear message instead of the error page.
    if (!(e instanceof DomainError)) throw e
    return new Response(`${e.message} — upload it again, then export.`, {
      status: 409,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    })
  }
  return new Response(JSON.stringify({ ...template, pages }, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${template.key}.template.json"`,
      'cache-control': 'no-store',
    },
  })
}
