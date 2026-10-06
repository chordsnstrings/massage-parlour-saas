import { isPlatformAdmin } from '@/server/access'
import { getSession } from '@/server/session'
import { loadAdminTemplate } from '../../data'

/** Template studio: download a template (studio row or built-in) as JSON for editing or moving between envs. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session || !(await isPlatformAdmin(session.user.id))) return new Response('Not found', { status: 404 })
  const template = await loadAdminTemplate((await params).id)
  if (!template) return new Response('Not found', { status: 404 })
  return new Response(JSON.stringify(template, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${template.key}.template.json"`,
      'cache-control': 'no-store',
    },
  })
}
