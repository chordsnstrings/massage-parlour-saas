import { createHash } from 'node:crypto'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  auditLog,
  closeAllDbs,
  mediaAssets,
  oauthClient,
  oauthConsent,
  pageVersions,
  platformAdmins,
  sitePageLocks,
  sitePages,
  sites,
  storedFiles,
  tenants,
  user,
  withTenant,
} from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import {
  acquirePageLock,
  ensureSite,
  getEditablePage,
  getHtmlDesign,
  publishPage,
  putTemplateFile,
  storeTemplateHtmlDoc,
  undoTemplateSwitch,
} from '@spa/services'
import type { SiteEditSchema } from '@spa/services/site-kit'
import { and, eq, like } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  handleSiteMcpRequest,
  type McpTemplate,
  SITE_MCP_MAX_REQUEST_BYTES,
  SITE_MCP_TOOL_HINTS,
  SITE_MCP_TOOL_NAMES,
  type SiteMcpOpts,
} from '../src'

const { platform, app } = testDbs()
const ids = {} as Record<string, string>

const schema: SiteEditSchema = {
  blocks: {
    Heading: { label: 'Heading', props: { text: { kind: 'bi' } }, defaults: { text: { en: 'Heading' } } },
  },
  root: { title: { kind: 'bi' } },
  theme: { accent: { kind: 'color' } },
  presets: [],
}
const EDITORS = ['owner@mcp.test', 'no2fa@mcp.test']
/** Test tokens stand in for Better Auth access tokens (their verification is the auth package's job). */
const TOKENS: Record<string, { userId: string; clientId: string; tokenId: string }> = {}

const opts = (over: Partial<SiteMcpOpts> = {}): SiteMcpOpts => ({
  verifyToken: async (t) => TOKENS[t] ?? null,
  schema,
  resourceMetadataUrl: 'http://localhost/.well-known/oauth-protected-resource/api/mcp',
  appUrl: (p) => `http://app.localhost${p}`,
  adminUrl: (p) => `http://admin.localhost${p}`,
  previewSecret: 'preview-secret',
  editorEmails: EDITORS,
  platform,
  app,
  ...over,
})

let rpcId = 0
const rpc = (token: string | null, method: string, params: unknown = {}, o = opts()) =>
  handleSiteMcpRequest(
    new Request('http://localhost/api/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
    }),
    o,
  )
const call = async (token: string, name: string, args: Record<string, unknown>, o = opts()) => {
  const res = await rpc(token, 'tools/call', { name, arguments: args }, o)
  expect(res.status).toBe(200)
  const body = (await res.json()) as { result: { isError?: boolean; content: { text: string }[] } }
  return { isError: Boolean(body.result.isError), data: JSON.parse(body.result.content[0]!.text) }
}

beforeAll(async () => {
  await resetTestDatabase()
  const [t] = await platform.insert(tenants).values({ slug: 'mcp-spa', name: 'MCP Spa' }).returning()
  ids.tenant = t!.id
  await withTenant(
    t!.id,
    (tx) =>
      ensureSite(tx, t!.id, {
        key: 'zen',
        name: 'Zen',
        theme: { accent: '#111111' },
        pages: [
          {
            slug: '',
            title: { en: 'Home' },
            data: {
              root: { props: {} },
              content: [{ type: 'Heading', props: { id: 'h1', text: { en: 'Slow down' } } }],
            },
          },
        ],
      }),
    app,
  )
  const [home] = await withTenant(t!.id, (tx) => tx.select().from(sitePages), app)
  ids.home = home!.id
  await withTenant(t!.id, (tx) => publishPage(tx, { tenantId: t!.id, pageId: home!.id }), app)
  const mk = async (email: string, admin: boolean, twoFactor: boolean) => {
    const id = `u-${email}`
    await platform
      .insert(user)
      .values({ id, name: email, email, emailVerified: true, twoFactorEnabled: twoFactor })
    if (admin) await platform.insert(platformAdmins).values({ userId: id })
    return id
  }
  ids.owner = await mk('owner@mcp.test', true, true)
  ids.otherAdmin = await mk('other@mcp.test', true, true)
  ids.no2fa = await mk('no2fa@mcp.test', true, false)
  await platform.insert(oauthClient).values({
    id: 'c1',
    clientId: 'claude-client',
    name: 'Claude',
    redirectUris: ['https://claude.ai/api/mcp/auth_callback'],
  })
  for (const u of [ids.owner, ids.otherAdmin, ids.no2fa])
    await platform
      .insert(oauthConsent)
      .values({ id: `consent-${u}`, clientId: 'claude-client', userId: u, scopes: ['sites:edit'] })
  TOKENS.owner = { userId: ids.owner!, clientId: 'claude-client', tokenId: 't-owner' }
  TOKENS.other = { userId: ids.otherAdmin!, clientId: 'claude-client', tokenId: 't-other' }
  TOKENS.no2fa = { userId: ids.no2fa!, clientId: 'claude-client', tokenId: 't-no2fa' }
})
afterAll(() => closeAllDbs())

describe('site MCP server (/api/mcp)', () => {
  it('401 with the RFC 9728 challenge without or with a bad token', async () => {
    const none = await rpc(null, 'tools/list')
    expect(none.status).toBe(401)
    expect(none.headers.get('www-authenticate')).toBe(
      'Bearer resource_metadata="http://localhost/.well-known/oauth-protected-resource/api/mcp"',
    )
    const bad = await rpc('forged', 'tools/list')
    expect(bad.status).toBe(401)
    expect(bad.headers.get('www-authenticate')).toContain('error="invalid_token"')
  })

  it('403 for a super-admin outside SITE_AI_EDITOR_EMAILS and for a listed one without 2FA', async () => {
    expect((await rpc('other', 'tools/list')).status).toBe(403)
    expect((await rpc('no2fa', 'tools/list')).status).toBe(403)
    // Empty allow-list = nobody, even the owner.
    expect((await rpc('owner', 'tools/list', {}, opts({ editorEmails: [] }))).status).toBe(403)
  })

  it('initialize + list tools: the ops, and no publish tool', async () => {
    const init = await rpc('owner', 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    })
    expect(init.status).toBe(200)
    expect(((await init.json()) as { result: { serverInfo: { name: string } } }).result.serverInfo.name).toBe(
      'spamanagement-sites',
    )
    const list = (await (await rpc('owner', 'tools/list')).json()) as {
      result: { tools: { name: string; annotations?: Record<string, unknown> }[] }
    }
    const names = list.result.tools.map((t) => t.name)
    expect(names.sort()).toEqual([...SITE_MCP_TOOL_NAMES].sort())
    expect(names).toEqual(
      expect.arrayContaining(['list_spas', 'get_site', 'update_block', 'set_theme', 'preview_link']),
    )
    expect(names.some((n) => n.includes('publish'))).toBe(false)
    // R25: every tool is annotated from the one hints map (ChatGPT + Claude use them for confirmations).
    expect(Object.keys(SITE_MCP_TOOL_HINTS).sort()).toEqual([...SITE_MCP_TOOL_NAMES].sort())
    const hints = Object.fromEntries(list.result.tools.map((t) => [t.name, t.annotations]))
    for (const name of names)
      expect(hints[name]).toMatchObject({ ...SITE_MCP_TOOL_HINTS[name], openWorldHint: false })
    for (const name of ['list_spas', 'get_site', 'list_block_types', 'preview_link'])
      expect(hints[name]?.readOnlyHint, name).toBe(true)
    const writes = names.filter((n) => !hints[n]?.readOnlyHint)
    expect(writes.length).toBeGreaterThan(0)
    for (const name of writes) expect(hints[name], name).toMatchObject({ readOnlyHint: false })
    // Overwrites of existing drafts count as destructive (OpenAI: "may delete or overwrite user data").
    expect(writes.filter((n) => hints[n]?.destructiveHint).sort()).toEqual([
      'apply_template',
      'patch_html_design',
      'remove_block',
      'rename_page',
      'replace_html_design',
      'set_html_design',
      'set_theme',
      'update_block',
    ])
    expect(writes.filter((n) => !hints[n]?.destructiveHint).sort()).toEqual([
      'add_block',
      'add_image',
      'add_page',
      'move_block',
    ])
    for (const name of ['list_templates', 'get_html_design'])
      expect(hints[name]?.readOnlyHint, name).toBe(true)
  })

  it('get_site and update_block edit the draft only, audited via AI assistant (MCP)', async () => {
    // R23: list_spas carries the console's computed website stage (no review status).
    const spas = await call('owner', 'list_spas', { query: 'mcp' })
    expect(spas.data).toEqual([
      {
        slug: 'mcp-spa',
        name: 'MCP Spa',
        status: 'trial',
        has_site: true,
        website: 'live',
        unpublished_changes: false,
        console_url: 'http://admin.localhost/websites/mcp-spa',
      },
    ])
    const site = await call('owner', 'get_site', { spa: 'mcp-spa' })
    expect(site.data.pages[0].data.content[0]).toMatchObject({ id: 'h1', type: 'Heading' })
    // R23: the owner previews and publishes in the console.
    expect(site.data.console_url).toBe('http://admin.localhost/websites/mcp-spa')
    const dry = await call('owner', 'update_block', {
      spa: 'mcp-spa',
      page: 'home',
      block_id: 'h1',
      props: { text: { en: 'Preview only' } },
      dry_run: true,
    })
    expect(dry.data.saved).toBe(false)
    const draft = async () =>
      JSON.stringify(
        (await withTenant(ids.tenant!, (tx) => getEditablePage(tx, ids.tenant!, ids.home!), app))!.data,
      )
    expect(await draft()).not.toContain('Preview only')
    const r = await call('owner', 'update_block', {
      spa: 'mcp-spa',
      page: 'home',
      block_id: 'h1',
      props: { text: { en: 'Golden calm', ar: 'هدوء ذهبي' } },
    })
    expect(r.isError).toBe(false)
    expect(r.data.saved).toBe(true)
    expect(r.data.summary).toEqual(['Home: Updated Heading (text)'])
    expect(await draft()).toContain('Golden calm')
    const versions = await withTenant(
      ids.tenant!,
      (tx) => tx.select().from(pageVersions).where(eq(pageVersions.pageId, ids.home!)),
      app,
    )
    const live = versions.find((v) => v.status === 'published')!
    expect(JSON.stringify(live.data)).toContain('Slow down')
    const bad = await call('owner', 'update_block', {
      spa: 'mcp-spa',
      page: 'home',
      block_id: 'h1',
      props: { colour: 'red' },
    })
    expect(bad.isError).toBe(true)
    expect(bad.data.error).toMatch(/Nothing was changed: .*no prop "colour"/)
    const rows = await platform.select().from(auditLog).where(like(auditLog.action, 'site.mcp.%'))
    const update = rows.find((x) => x.action === 'site.mcp.update_block' && (x.data as { ok?: boolean }).ok)
    expect(update).toMatchObject({ tenantId: ids.tenant, actorUserId: ids.owner })
    expect(update!.data).toMatchObject({ via: 'via AI assistant (MCP)', client: 'Claude', ops: ['update'] })
    expect(rows.some((x) => x.action === 'site.mcp.get_site')).toBe(true)
  })

  it('preview_link signs a draft preview URL', async () => {
    const r = await call('owner', 'preview_link', { spa: 'mcp-spa', days: 1 })
    expect(r.data.url).toMatch(/^http:\/\/app\.localhost\/website\/preview\?token=/)
  })

  describe('R24 design tools: templates, HTML designs, add_image', () => {
    const PNG_1PX = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    )
    /** Magic bytes are all extraction checks: a PNG signature + filler over the 1 KB minimum. */
    const fakePng = (seed: string) =>
      Buffer.concat([PNG_1PX.subarray(0, 16), Buffer.from(seed.repeat(1500).slice(0, 1500))])
    const fileUrl = (id: string, name: string) => `http://app.localhost/files/${id}/${name}`
    const d = {} as Record<string, string>
    let server: http.Server
    let allow: string[] = []
    let at = (_p: string) => ''
    const TPL: McpTemplate[] = []
    const dopts = (over: Partial<SiteMcpOpts> = {}) =>
      opts({
        rateLimit: 1000,
        templates: async () => TPL,
        fileUrl,
        imageFetch: { allow },
        ...over,
      })
    const dcall = (name: string, args: Record<string, unknown>, over: Partial<SiteMcpOpts> = {}) =>
      call('design', name, { spa: 'mcp-design', ...args }, dopts(over))
    const inD = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(d.tenant!, fn, app)
    const published = () =>
      inD((tx) =>
        tx
          .select({ id: pageVersions.id, data: pageVersions.data })
          .from(pageVersions)
          .where(and(eq(pageVersions.tenantId, d.tenant!), eq(pageVersions.status, 'published'))),
      )
    const draftOf = async (pageId: string) =>
      JSON.stringify((await inD((tx) => getEditablePage(tx, d.tenant!, pageId)))!.data)
    /** The stored design of an HTML design page (the spa's own file). */
    const designOf = async (page: string) => (await inD((tx) => getHtmlDesign(tx, d.tenant!, page)))!.html
    const site = async () => (await inD((tx) => tx.select().from(sites)))[0]!

    beforeAll(async () => {
      server = http.createServer((req, res) => {
        const send = (type: string, body: Buffer | string, status = 200) => {
          res.writeHead(status, { 'content-type': type })
          res.end(body)
        }
        if (req.url === '/ok.png') send('image/png', PNG_1PX)
        else if (req.url === '/page') send('text/html', '<!doctype html><p>hi</p>')
        else if (req.url === '/logo.svg') send('image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"/>')
        else if (req.url === '/fake.png') send('image/png', '<!doctype html><p>not a png</p>')
        else if (req.url === '/big.png')
          send('image/png', Buffer.concat([PNG_1PX, Buffer.alloc(9 * 1024 * 1024)]))
        else if (req.url === '/meta') {
          res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data' })
          res.end()
        } else send('text/plain', 'nope', 404)
      })
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
      const { port } = server.address() as AddressInfo
      allow = [`127.0.0.1:${port}`]
      at = (path: string) => `http://127.0.0.1:${port}${path}`
      TOKENS.design = { ...TOKENS.owner!, tokenId: 't-design' }

      const [t] = await platform
        .insert(tenants)
        .values({ slug: 'mcp-design', name: 'Design Spa' })
        .returning()
      d.tenant = t!.id
      const heading = (id: string, en: string) => ({
        root: { props: {} },
        content: [{ type: 'Heading', props: { id, text: { en } } }],
      })
      await inD((tx) =>
        ensureSite(tx, t!.id, {
          key: 'zen',
          name: 'Zen',
          theme: { accent: '#111111' },
          pages: [
            { slug: '', title: { en: 'Home' }, data: heading('h1', 'Slow down') },
            { slug: 'about', title: { en: 'About' }, data: heading('a1', 'About us') },
            { slug: 'empty', title: { en: 'Empty' }, data: { root: { props: {} }, content: [] } },
          ],
        }),
      )
      for (const p of await inD((tx) => tx.select().from(sitePages))) {
        d[p.slug || 'home'] = p.id
        if (p.slug !== 'empty') await inD((tx) => publishPage(tx, { tenantId: t!.id, pageId: p.id }))
      }

      // An uploaded HTML design template whose image lives in the platform's template files.
      const bytes = fakePng('template')
      const tf = await putTemplateFile(platform, {
        bytes,
        contentType: 'image/png',
        sha256: createHash('sha256').update(bytes).digest('hex'),
      })
      d.templateFile = tf.id
      const page = (slug: string, en: string, data: Record<string, unknown>) => ({
        slug,
        title: { en },
        data,
      })
      TPL.push(
        {
          key: 'desert',
          name: 'Desert Arches',
          feel: 'Beige and terracotta, arches',
          source: 'builtin',
          kind: 'classic',
          previewUrl: 'http://admin.localhost/templates/desert/preview',
          theme: { accent: '#c2410c' },
          pages: [
            page('', 'Home', heading('d1', 'Desert calm')),
            page('offers', 'Offers', heading('d2', 'Offers')),
          ],
        },
        {
          key: 'sand-silk',
          name: 'Sand Silk',
          feel: 'Uploaded HTML design',
          source: 'studio',
          kind: 'html',
          previewUrl: 'http://admin.localhost/templates/x/preview',
          theme: { accent: '#d4b483' },
          pages: [
            page('', 'Home', {
              root: { props: { htmlDesign: true } },
              content: [
                {
                  type: 'HtmlDesign',
                  props: {
                    id: 'sand-html-design',
                    // R24: the design itself is a template file; the page only references it.
                    html: '',
                    doc: await storeTemplateHtmlDoc(platform, {
                      html: `<!doctype html><html><body><h1>Sand silk</h1><img src="${fileUrl(tf.id, 'x.png')}"></body></html>`,
                    }),
                    images: [],
                    phoneFixes: false,
                  },
                },
              ],
            }),
          ],
        },
      )
    })
    afterAll(() => new Promise<void>((r) => server.close(() => r())))

    it('every new tool sits behind the same gate (403 outside the allow-list)', async () => {
      for (const name of [
        'list_templates',
        'apply_template',
        'set_html_design',
        'get_html_design',
        'patch_html_design',
        'add_image',
      ]) {
        expect(SITE_MCP_TOOL_NAMES).toContain(name)
        const res = await rpc('other', 'tools/call', { name, arguments: { spa: 'mcp-design' } }, dopts())
        expect(res.status, name).toBe(403)
      }
      expect((await call('design', 'list_templates', {}, opts({ rateLimit: 1000 }))).data.error).toMatch(
        /Templates aren’t available/,
      )
    })

    it('list_templates lists the catalogue and marks the spa’s current template', async () => {
      const r = await dcall('list_templates', {})
      expect(r.data.current).toBe('zen')
      expect(r.data.templates).toEqual([
        expect.objectContaining({ key: 'desert', kind: 'classic', pages: ['home', 'offers'] }),
        expect.objectContaining({ key: 'sand-silk', kind: 'html', source: 'studio' }),
      ])
      const q = await dcall('list_templates', { spa: undefined, query: 'silk' })
      expect(q.data.templates.map((t: { key: string }) => t.key)).toEqual(['sand-silk'])
    })

    it('apply_template: dry run writes nothing; apply saves drafts + the DRAFT theme, live untouched; undo restores', async () => {
      const liveBefore = await published()
      const unknown = await dcall('apply_template', { template: 'nope' })
      expect(unknown.data.error).toBe('No template "nope" — use list_templates.')
      const dry = await dcall('apply_template', { template: 'desert', dry_run: true })
      expect(dry.data).toMatchObject({
        saved: false,
        theme: 'draft',
        pages: [
          { slug: 'home', new: false },
          { slug: 'offers', new: true },
        ],
        kept_pages: expect.arrayContaining([expect.objectContaining({ slug: 'about' })]),
      })
      expect((await site()).templateKey).toBe('zen')
      expect(await draftOf(d.home!)).toContain('Slow down')

      const r = await dcall('apply_template', { template: 'desert' })
      expect(r.isError).toBe(false)
      expect(r.data.saved).toBe(true)
      expect(r.data.note).toMatch(/live site is unchanged/)
      const s1 = await site()
      expect(s1.templateKey).toBe('desert')
      expect(s1.theme).toMatchObject({ accent: '#111111' })
      expect(s1.themeDraft).toMatchObject({ accent: '#c2410c' })
      expect(s1.templateUndo).toMatchObject({ templateKey: 'zen', draftTheme: true, themeDraft: null })
      expect(await draftOf(d.home!)).toContain('Desert calm')
      // Nothing published: the same published versions, the same live data.
      expect(await published()).toEqual(liveBefore)
      const offers = (await inD((tx) => tx.select().from(sitePages))).find((p) => p.slug === 'offers')
      expect(offers).toBeTruthy()

      // The console's one-click Undo restores the template key, the draft theme and the drafts.
      await inD((tx) => undoTemplateSwitch(tx, d.tenant!, ids.owner))
      const s2 = await site()
      expect(s2.templateKey).toBe('zen')
      expect(s2.themeDraft).toBeNull()
      expect(s2.theme).toMatchObject({ accent: '#111111' })
      expect(await draftOf(d.home!)).toContain('Slow down')
      expect((await inD((tx) => tx.select().from(sitePages))).some((p) => p.slug === 'offers')).toBe(false)
      expect(await published()).toEqual(liveBefore)
    })

    it('apply_template is refused while someone else has a page it writes open in the Studio editor', async () => {
      await inD((tx) =>
        acquirePageLock(tx, {
          tenantId: d.tenant!,
          pageId: d.home!,
          userId: ids.otherAdmin!,
          holderName: 'Ahmed',
        }),
      )
      const dry = await dcall('apply_template', { template: 'desert', dry_run: true })
      expect(dry.data.locked).toEqual(['home (Ahmed)'])
      const r = await dcall('apply_template', { template: 'desert' })
      expect(r.isError).toBe(true)
      expect(r.data.error).toMatch(/^Ahmed is editing this page/)
      expect((await site()).templateKey).toBe('zen')
      await inD((tx) => tx.delete(sitePageLocks).where(eq(sitePageLocks.tenantId, d.tenant!)))
    })

    it('apply_template of an HTML template copies its design and the files it uses into the spa', async () => {
      const r = await dcall('apply_template', { template: 'sand-silk' })
      expect(r.data).toMatchObject({ saved: true, html_design_pages: 1, html_files_copied: 1 })
      const draft = await draftOf(d.home!)
      expect(draft).not.toContain('Sand silk')
      const html = await designOf('home')
      expect(html).toContain('Sand silk')
      expect(html).not.toContain(d.templateFile!)
      const files = await inD((tx) =>
        tx.select().from(storedFiles).where(eq(storedFiles.purpose, 'html_design')),
      )
      expect(files).toHaveLength(1)
      expect(files[0]!.isPublic).toBe(true)
      expect(html).toContain(`http://app.localhost/files/${files[0]!.id}/`)
      const [doc] = await inD((tx) =>
        tx.select().from(storedFiles).where(eq(storedFiles.purpose, 'html_design_doc')),
      )
      expect(doc).toMatchObject({ isPublic: false, contentType: 'text/html; charset=utf-8' })
      await inD((tx) => undoTemplateSwitch(tx, d.tenant!, ids.owner))
    })

    it('set_html_design: convert needed on a block page; stored byte for byte; exact (no phone fixes) by default', async () => {
      const img = `data:image/png;base64,${fakePng('about').toString('base64')}`
      const html = `<!doctype html><html><head><title>About</title></head><body><h1>Our story</h1><p>Calm hands.</p><p>Calm hands.</p><img src="${img}" width="10" height="10"></body></html>`
      const refused = await dcall('set_html_design', { page: 'about', html })
      expect(refused.isError).toBe(true)
      expect(refused.data.error).toMatch(/has 1 block; pass convert: true/)
      expect(await draftOf(d.about!)).toContain('About us')
      const dry = await dcall('set_html_design', { page: 'about', html, convert: true, dry_run: true })
      expect(dry.data.saved).toBe(false)
      expect(dry.data.html_designs[0]).toMatchObject({
        page: 'about',
        html_chars: html.length,
        stored: 'exactly as sent',
        phone_fixes: false,
      })
      expect(await draftOf(d.about!)).toContain('About us')

      const r = await dcall('set_html_design', { page: 'about', html, convert: true })
      expect(r.data.saved).toBe(true)
      const draft = JSON.parse(await draftOf(d.about!))
      expect(draft.root.props.htmlDesign).toBe(true)
      expect(draft.content[0].props.phoneFixes).toBe(false)
      expect(draft.content[0].props.html).toBe('')
      expect(await designOf('about')).toBe(html)
      const g = await dcall('get_site', { page: 'about' })
      expect(g.data.pages[0]).toMatchObject({ htmlDesign: true, html: { phone_fixes: false } })
      // The published About page is still the block page.
      expect(JSON.stringify((await published()).map((v) => v.data)).includes('About us')).toBe(true)
    })

    it('get_html_design pages and searches the stored HTML (exactly as sent)', async () => {
      const notHtml = await dcall('get_html_design', { page: 'home' })
      expect(notHtml.data.error).toMatch(/is not an HTML design page/)
      const all = await dcall('get_html_design', { page: 'about' })
      expect(all.data).toMatchObject({ phone_fixes: false, start: 0, more: false })
      expect(all.data.html).toContain('<img src="data:image/png;base64,')
      const part = await dcall('get_html_design', { page: 'about', start: 10, length: 20 })
      expect(part.data).toMatchObject({ start: 10, end: 30, more: true })
      expect(part.data.html).toBe(all.data.html.slice(10, 30))
      const found = await dcall('get_html_design', { page: 'about', search: 'Calm hands.' })
      expect(found.data.match_count).toBe(2)
      expect(found.data.matches[0].context).toContain('<p>Calm hands.</p>')
    })

    it('patch_html_design: each find must match exactly once, all or nothing, dry run saves nothing', async () => {
      const before = await draftOf(d.about!)
      const none = await dcall('patch_html_design', {
        page: 'about',
        edits: [
          { find: 'Our story', replace: 'Our journey' },
          { find: 'Not there', replace: 'x' },
        ],
      })
      expect(none.data.error).toMatch(/Edit 2: `find` matches 0 times/)
      const many = await dcall('patch_html_design', {
        page: 'about',
        edits: [{ find: 'Calm hands.', replace: 'Warm hands.' }],
      })
      expect(many.data.error).toMatch(/matches 2 times/)
      expect(await draftOf(d.about!)).toBe(before)
      const dry = await dcall('patch_html_design', {
        page: 'about',
        edits: [{ find: 'Our story', replace: 'Our journey' }],
        dry_run: true,
      })
      expect(dry.data.saved).toBe(false)
      expect(await draftOf(d.about!)).toBe(before)
      const r = await dcall('patch_html_design', {
        page: 'about',
        edits: [
          { find: 'Our story', replace: 'Our journey' },
          { find: '<p>Calm hands.</p><p>Calm hands.</p>', replace: '<p>Calm hands.</p>' },
        ],
      })
      expect(r.data.saved).toBe(true)
      expect(r.data.html_designs[0].edits_at).toHaveLength(2)
      const after = JSON.parse(await draftOf(d.about!)).content[0].props
      const patched = await designOf('about')
      expect(patched).toContain('Our journey')
      expect(patched.match(/Calm hands/g)).toHaveLength(1)
      expect(after.phoneFixes).toBe(false)
      // Locks apply as for every draft writer.
      await inD((tx) =>
        acquirePageLock(tx, {
          tenantId: d.tenant!,
          pageId: d.about!,
          userId: ids.otherAdmin!,
          holderName: 'Sara',
        }),
      )
      const locked = await dcall('patch_html_design', {
        page: 'about',
        edits: [{ find: 'Our journey', replace: 'Our path' }],
      })
      expect(locked.data.error).toMatch(/Sara is editing/)
      await inD((tx) => tx.delete(sitePageLocks).where(eq(sitePageLocks.tenantId, d.tenant!)))
    })

    it('a whole 4.6 MB design (JSON body over the SDK’s 4 MiB default: quotes, newlines, Arabic) is saved exactly', async () => {
      const big = `<!doctype html><html lang="ar"><head><meta charset="utf-8"><style>${'.a::after{content:"x"}\n'.repeat(40_000)}</style></head><body><p>${'سبا "هادئ"\n'.repeat(190_000)}</p><script>${'var q="\\"";\n'.repeat(50_000)}</script></body></html>`
      expect(Buffer.byteLength(big)).toBeGreaterThan(4.5 * 1024 * 1024)
      expect(Buffer.byteLength(big)).toBeLessThan(5 * 1024 * 1024)
      const body = JSON.stringify({
        name: 'set_html_design',
        arguments: { spa: 'mcp-design', page: 'about', html: big },
      })
      expect(Buffer.byteLength(body)).toBeGreaterThan(5 * 1024 * 1024)
      const r = await dcall('set_html_design', { page: 'about', html: big })
      expect(r.isError, JSON.stringify(r.data).slice(0, 300)).toBe(false)
      expect(r.data.html_designs[0]).toMatchObject({
        html_chars: big.length,
        html_bytes: Buffer.byteLength(big),
      })
      expect(await designOf('about')).toBe(big)
      // Over the documented cap: refused by the transport before any tool code runs.
      expect(SITE_MCP_MAX_REQUEST_BYTES).toBeGreaterThanOrEqual(2 * 5 * 1024 * 1024)
      const huge = await rpc(
        'design',
        'tools/call',
        { name: 'get_site', arguments: { spa: 'mcp-design', pad: 'x'.repeat(SITE_MCP_MAX_REQUEST_BYTES) } },
        dopts(),
      )
      expect(huge.status).toBe(413)
    })

    it('add_image refuses http, private addresses, redirects to metadata, non-images, SVG, fakes and > 8 MB', async () => {
      const refusals: [string, RegExp, Partial<SiteMcpOpts>?][] = [
        ['http://example.com/a.png', /Only https:\/\//],
        ['not a url', /isn’t a valid image address/],
        ['https://10.0.0.5/a.png', /private network/],
        ['https://169.254.169.254/latest', /private network/],
        [
          'https://rebind.test/a.png',
          /private network/,
          { imageFetch: { resolve: async () => [{ address: '127.0.0.1', family: 4 }] } },
        ],
        [at('/meta'), /private network/],
        [at('/page'), /isn’t a picture we can use \(text\/html\)/],
        [at('/logo.svg'), /never SVG/],
        [at('/fake.png'), /bytes don’t match/],
        [at('/big.png'), /too large/],
      ]
      for (const [url, msg, over] of refusals) {
        // Refused attempts count towards the per-minute limit too: a token of its own (more than 10 calls).
        TOKENS.refusals = { ...TOKENS.owner!, tokenId: 't-refusals' }
        const r = await call('refusals', 'add_image', { spa: 'mcp-design', url }, dopts(over))
        expect(r.isError, url).toBe(true)
        expect(r.data.error, url).toMatch(msg)
      }
      expect(await inD((tx) => tx.select().from(mediaAssets))).toHaveLength(0)
    })

    it('add_image stores a public media-library image and returns its block path + absolute URL; limited', async () => {
      const r = await dcall('add_image', { url: at('/ok.png'), alt_en: 'Hot stones' })
      expect(r.isError, JSON.stringify(r.data)).toBe(false)
      expect(r.data).toMatchObject({ width: 1, height: 1, alt: { en: 'Hot stones' } })
      expect(r.data.path).toBe(`/files/${r.data.file_id}`)
      expect(r.data.url).toMatch(
        new RegExp(`^http://app\\.localhost/files/${r.data.file_id}/ai-127\\.0\\.0\\.1\\.webp$`),
      )
      expect(r.data.use.html).toBe(`<img src="${r.data.url}" alt="Hot stones" width="1" height="1">`)
      const [asset] = await inD((tx) => tx.select().from(mediaAssets))
      expect(asset).toMatchObject({ id: r.data.id, url: r.data.path, tags: ['ai-assistant', '127.0.0.1'] })
      const [file] = await inD((tx) =>
        tx.select().from(storedFiles).where(eq(storedFiles.id, r.data.file_id)),
      )
      expect(file).toMatchObject({ isPublic: true, purpose: 'media', contentType: 'image/webp' })
      // Per spa per day, and per token per minute.
      const day = await dcall('add_image', { url: at('/ok.png') }, { imageLimits: { perDay: 1 } })
      expect(day.data.error).toMatch(/already got 1 images from the AI assistant today/)
      TOKENS.img = { ...TOKENS.owner!, tokenId: 't-img' }
      const o = dopts({ imageLimits: { perMinute: 1 } })
      expect((await call('img', 'add_image', { spa: 'mcp-design', url: at('/ok.png') }, o)).isError).toBe(
        false,
      )
      const burst = await call('img', 'add_image', { spa: 'mcp-design', url: at('/ok.png') }, o)
      expect(burst.data.error).toMatch(/at most 1 a minute/)
      const rows = await platform.select().from(auditLog).where(eq(auditLog.action, 'site.mcp.add_image'))
      expect(rows.find((x) => (x.data as { ok?: boolean }).ok)?.data).toMatchObject({
        via: 'via AI assistant (MCP)',
        host: '127.0.0.1',
        width: 1,
      })
      expect(rows.some((x) => (x.data as { ok?: boolean }).ok === false)).toBe(true)
    })

    it('audits every design tool and never publishes', async () => {
      const rows = await platform.select().from(auditLog).where(eq(auditLog.tenantId, d.tenant!))
      for (const tool of ['apply_template', 'set_html_design', 'patch_html_design', 'get_html_design'])
        expect(
          rows.some((x) => x.action === `site.mcp.${tool}`),
          tool,
        ).toBe(true)
      expect(rows.find((x) => x.action === 'site.mcp.apply_template')?.actorUserId).toBe(ids.owner)
      const live = await published()
      expect(live).toHaveLength(2)
      expect(JSON.stringify(live.map((v) => v.data))).not.toContain('Our journey')
    })
  })

  it('rate-limits per token and stops at once when the consent is revoked', async () => {
    const o = opts({ rateLimit: 2 })
    TOKENS.burst = { ...TOKENS.owner!, tokenId: 't-burst' }
    expect((await rpc('burst', 'tools/list', {}, o)).status).toBe(200)
    expect((await rpc('burst', 'tools/list', {}, o)).status).toBe(200)
    expect((await rpc('burst', 'tools/list', {}, o)).status).toBe(429)
    await platform
      .delete(oauthConsent)
      .where(and(eq(oauthConsent.userId, ids.owner!), eq(oauthConsent.clientId, 'claude-client')))
    const revoked = await rpc('owner', 'tools/list')
    expect(revoked.status).toBe(401)
    expect(revoked.headers.get('www-authenticate')).toContain('invalid_token')
  })
})
