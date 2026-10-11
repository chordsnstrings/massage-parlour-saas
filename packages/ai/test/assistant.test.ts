// F30 dashboard "Ask AI": tool permission checks, branch limits, links, limits and the gateway gates (fixtures).
import { dubaiInstant, type Permission, SYSTEM_ROLES } from '@spa/core'
import {
  aiUsage,
  bookingItems,
  bookings,
  branches,
  clients,
  closeAllDbs,
  memberBranches,
  members,
  roles,
  saleLines,
  sales,
  shifts,
  staff,
  tenants,
  user,
  withTenant,
} from '@spa/db'
import { seedPlatform } from '@spa/db/seed'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  AiNotInPlanError,
  AiPausedError,
  ASSISTANT_AGENT_KEY,
  ASSISTANT_LIMITS,
  type AssistantScope,
  createModelArkClient,
  runAssistant,
} from '../src'

const { platform, app } = testDbs()
const ids = {} as Record<string, string>
const now = dubaiInstant('2026-10-06', 10 * 60) // Tuesday
const tomorrow = '2026-10-07'

const reply = (m: object) =>
  new Response(
    JSON.stringify({
      choices: [{ message: { role: 'assistant', ...m }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 900, completion_tokens: 60 },
    }),
  )
let n = 0
const call = (name: string, args: object = {}) => ({
  id: `c${++n}`,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
})
const tools = (...calls: ReturnType<typeof call>[]) => reply({ content: null, tool_calls: calls })

/** A ModelArk client answering with the scripted steps (then repeating the last one). */
function scripted(...steps: Response[]) {
  const fetchMock = vi.fn()
  for (const s of steps) fetchMock.mockResolvedValueOnce(s)
  return {
    fetchMock,
    client: createModelArkClient({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch }),
  }
}
type Body = { messages: { role: string; content: string; tool_call_id?: string }[] }
const body = (f: ReturnType<typeof vi.fn>, i: number) =>
  JSON.parse((f.mock.calls[i] as unknown as [string, RequestInit])[1].body as string) as Body
/** Tool results the model saw, in call order (from the last request). */
const toolResults = (f: ReturnType<typeof vi.fn>) =>
  body(f, f.mock.calls.length - 1)
    .messages.filter((m) => m.role === 'tool')
    .map((m) => JSON.parse(m.content))

const perms = (...p: Permission[]) => new Set<Permission>(p)
const OWNER: Permission[] = [...SYSTEM_ROLES.owner.permissions]
const DESK: Permission[] = [...SYSTEM_ROLES.receptionist.permissions]
const ACCOUNTANT: Permission[] = [...SYSTEM_ROLES.accountant.permissions]
const scope = (memberKey: string, p: Permission[]): AssistantScope => ({
  permissions: perms(...p),
  memberId: ids[memberKey]!,
})

const ask = (s: AssistantScope, client: ReturnType<typeof createModelArkClient>, extra = {}) =>
  runAssistant({ tenantId: ids.tenant!, scope: s, question: 'q', locale: 'en', now, client, ...extra })

beforeAll(async () => {
  await resetTestDatabase()
  await seedPlatform(platform)
  const [t] = await platform.insert(tenants).values({ slug: 'ask', name: 'Lotus Spa' }).returning()
  ids.tenant = t!.id
  await platform
    .insert(user)
    .values(['owner', 'desk', 'acct'].map((k) => ({ id: `ask-${k}`, name: k, email: `${k}@ask.test` })))
  await withTenant(
    ids.tenant,
    // biome-ignore lint/suspicious/noExplicitAny: test seeding helper
    async (tx: any) => {
      const tenantId = ids.tenant!
      const role = async (key: 'owner' | 'receptionist' | 'accountant') => {
        const [r] = await tx
          .insert(roles)
          .values({ tenantId, key, name: key, permissions: [...SYSTEM_ROLES[key].permissions] })
          .returning()
        return r.id
      }
      const [marina] = await tx
        .insert(branches)
        .values({ tenantId, name: 'Marina', isDefault: true })
        .returning()
      const [jlt] = await tx.insert(branches).values({ tenantId, name: 'JLT' }).returning()
      ids.marina = marina.id
      ids.jlt = jlt.id
      const m = await tx
        .insert(members)
        .values([
          { tenantId, userId: 'ask-owner', roleId: await role('owner') },
          { tenantId, userId: 'ask-desk', roleId: await role('receptionist'), allBranches: false },
          { tenantId, userId: 'ask-acct', roleId: await role('accountant') },
        ])
        .returning()
      for (const row of m) ids[row.userId.slice(4)] = row.id
      await tx.insert(memberBranches).values({ tenantId, memberId: ids.desk, branchId: jlt.id })
      const [maya] = await tx.insert(staff).values({ tenantId, displayName: 'Maya' }).returning()
      const [noor] = await tx.insert(staff).values({ tenantId, displayName: 'Noor' }).returning()
      ids.maya = maya.id
      for (const [s, b] of [
        [maya, marina],
        [noor, jlt],
      ])
        await tx.insert(shifts).values({
          tenantId,
          staffId: s.id,
          branchId: b.id,
          startsAt: dubaiInstant(tomorrow, 10 * 60),
          endsAt: dubaiInstant(tomorrow, 20 * 60),
        })
      const day = (d: number) => new Date(now.getTime() - d * 86_400_000)
      const cs = await tx
        .insert(clients)
        .values([
          { tenantId, name: 'Sara Ahmed', phoneE164: '971501110001', lastVisitAt: day(90) },
          { tenantId, name: 'Omar Khan', phoneE164: '971501110002', lastVisitAt: day(100) },
          { tenantId, name: 'Lina Haddad', phoneE164: '971501110003', lastVisitAt: day(10) },
          {
            tenantId,
            name: 'Huda Saleh',
            phoneE164: '971501110004',
            lastVisitAt: day(80),
            tags: ['no-marketing'],
          },
        ])
        .returning()
      for (const c of cs) ids[c.name.split(' ')[0].toLowerCase()] = c.id
      let ref = 0
      const book = async (o: {
        branchId: string
        clientId: string | null
        date: string
        status: 'confirmed' | 'completed'
        staffId: string
      }) => {
        const startsAt = dubaiInstant(o.date, 14 * 60)
        const endsAt = dubaiInstant(o.date, 15 * 60)
        const [b] = await tx
          .insert(bookings)
          .values({
            tenantId,
            branchId: o.branchId,
            clientId: o.clientId,
            refCode: `R${++ref}AAA`,
            source: 'phone',
            status: o.status,
            businessDate: o.date,
            startsAt,
            endsAt,
          })
          .returning()
        await tx.insert(bookingItems).values({
          tenantId,
          bookingId: b.id,
          serviceName: 'Swedish massage',
          durationMin: 60,
          priceAed: '350',
          startsAt,
          endsAt,
          staffIds: [o.staffId],
        })
      }
      await book({
        branchId: jlt.id,
        clientId: ids.sara,
        date: '2026-07-08',
        status: 'completed',
        staffId: noor.id,
      })
      await book({
        branchId: marina.id,
        clientId: ids.omar,
        date: '2026-06-28',
        status: 'completed',
        staffId: maya.id,
      })
      await book({
        branchId: marina.id,
        clientId: ids.huda,
        date: '2026-07-18',
        status: 'completed',
        staffId: maya.id,
      })
      await book({
        branchId: marina.id,
        clientId: ids.lina,
        date: tomorrow,
        status: 'confirmed',
        staffId: maya.id,
      })
      await book({ branchId: jlt.id, clientId: null, date: tomorrow, status: 'confirmed', staffId: noor.id })
      // Last week (Mon 29 Sep – Sun 5 Oct): Marina 500 + JLT 300; the week before: Marina 400.
      let number = 0
      for (const [b, d, total, name] of [
        [marina.id, '2026-09-30', '500', 'Swedish massage'],
        [jlt.id, '2026-10-01', '300', 'Hot stone'],
        [marina.id, '2026-09-24', '400', 'Swedish massage'],
      ] as const) {
        const [s] = await tx
          .insert(sales)
          .values({
            tenantId,
            branchId: b,
            number: ++number,
            businessDate: d,
            subtotalAed: total,
            totalAed: total,
            status: 'paid',
          })
          .returning()
        await tx.insert(saleLines).values({
          tenantId,
          saleId: s.id,
          kind: 'service',
          description: name,
          unitPriceAed: total,
          lineTotalAed: total,
        })
      }
    },
    app,
  )
})
afterAll(closeAllDbs)

describe('Ask AI assistant', () => {
  it('answers from the tools, with server-built deep links, metered under staff_assistant', async () => {
    const { fetchMock, client } = scripted(
      tools(call('bookings_summary', { from: tomorrow })),
      reply({ content: 'You have 2 bookings tomorrow.' }),
    )
    const res = await ask(scope('owner', OWNER), client)
    expect(res.answer).toBe('You have 2 bookings tomorrow.')
    expect(res.incomplete).toBe(false)
    const [summary] = toolResults(fetchMock)
    expect(summary.total).toBe(2)
    expect(summary.byStatus).toEqual({ confirmed: 2 })
    expect(summary.bookings.map((b: { client: string }) => b.client).sort()).toEqual([
      'Lina Haddad',
      'Walk-in',
    ])
    expect(summary.bookings[0].therapists).toHaveLength(1)
    expect(res.links).toEqual([
      { kind: 'screen', screen: 'calendar', path: `/calendar?date=${tomorrow}`, date: tomorrow },
      {
        kind: 'screen',
        screen: 'bookings',
        path: `/bookings?from=${tomorrow}&to=${tomorrow}`,
        from: tomorrow,
        to: tomorrow,
      },
    ])
    expect(res.calls).toEqual([{ name: 'bookings_summary', ok: true }])
    // The prompt carries the business date + weekday facts and the UI language.
    const system = body(fetchMock, 0).messages[0]!.content
    expect(system).toContain('Today (business date): 2026-10-06, Tuesday')
    expect(system).toContain('Friday 2026-10-09')
    expect(system).toContain('Reply in English.')
    const usage = await platform
      .select()
      .from(aiUsage)
      .where(and(eq(aiUsage.tenantId, ids.tenant!), eq(aiUsage.agentKey, ASSISTANT_AGENT_KEY)))
    expect(usage).toHaveLength(2)
    expect(usage[0]!.modelId).toBe('seed-2-0-lite-260428')
  })

  it('keeps a branch-limited member to their branches (bookings, shifts, clients, revenue)', async () => {
    const { fetchMock, client } = scripted(
      tools(
        call('bookings_summary', { from: tomorrow }),
        call('bookings_summary', { from: tomorrow, branch_id: ids.marina }),
        call('staff_on_shift', { date: tomorrow }),
        call('lapsed_clients', { days: 60 }),
        call('revenue_summary', {
          from: '2026-09-29',
          to: '2026-10-05',
          compare_from: '2026-09-22',
          compare_to: '2026-09-28',
        }),
      ),
      reply({ content: 'Done.' }),
    )
    const res = await ask(scope('desk', [...DESK, 'reports.view', 'dashboard.revenue']), client, {
      locale: 'th',
    })
    const [mine, other, onShift, lapsed, revenue] = toolResults(fetchMock)
    expect(mine.total).toBe(1)
    expect(mine.bookings[0].client).toBe('Walk-in')
    expect(other.error).toBe('branch_not_allowed')
    expect(onShift.onShift).toEqual([{ staff: 'Noor', start: '10:00', end: '20:00' }])
    expect(lapsed.clients.map((c: { name: string }) => c.name)).toEqual(['Sara Ahmed'])
    expect(revenue.period.revenueAed).toBe(300)
    expect(revenue.compare.revenueAed).toBe(0)
    expect(revenue.branches).toEqual(['JLT'])
    // Links keep the member's single branch.
    expect(res.links.find((l) => l.kind === 'screen' && l.screen === 'calendar')).toMatchObject({
      path: `/calendar?date=${tomorrow}&branch=${ids.jlt}`,
    })
    expect(body(fetchMock, 0).messages[0]!.content).toContain('Reply in Thai.')
  })

  it('compares revenue across the whole spa and lists top treatments', async () => {
    const { fetchMock, client } = scripted(
      tools(
        call('revenue_summary', {
          from: '2026-09-29',
          to: '2026-10-05',
          compare_from: '2026-09-22',
          compare_to: '2026-09-28',
        }),
        call('top_services', { from: '2026-09-01', to: '2026-10-06' }),
      ),
      reply({ content: 'Revenue doubled.' }),
    )
    const res = await ask(scope('owner', OWNER), client)
    const [revenue, top] = toolResults(fetchMock)
    expect(revenue.period).toMatchObject({ revenueAed: 800, paidSales: 2, averageTicketAed: 400 })
    expect(revenue.compare.revenueAed).toBe(400)
    expect(revenue.revenueChangePct).toBe(100)
    expect(top.services).toEqual([
      { name: 'Swedish massage', sold: 2, revenueAed: 900 },
      { name: 'Hot stone', sold: 1, revenueAed: 300 },
    ])
    expect(res.links.map((l) => (l.kind === 'screen' ? l.path : l.href))).toEqual([
      '/reports',
      '/?period=30d',
    ])
  })

  it('refuses tools the role lacks: no data, audited as denied, no link', async () => {
    const { fetchMock, client } = scripted(
      tools(
        call('revenue_summary', { from: '2026-09-29', to: '2026-10-05' }),
        call('top_services', { from: '2026-09-01', to: '2026-10-06' }),
      ),
      reply({ content: 'Your role cannot see revenue.' }),
    )
    const res = await ask(scope('desk', DESK), client)
    const results = toolResults(fetchMock)
    expect(results.map((r) => r.error)).toEqual(['not_allowed', 'not_allowed'])
    expect(JSON.stringify(results)).not.toContain('800')
    expect(res.denied).toEqual(['revenue_summary', 'top_services'])
    expect(res.links).toEqual([])

    // Accountant: revenue yes, client lists and WhatsApp drafts no.
    const acct = scripted(
      tools(
        call('lapsed_clients', {}),
        call('whatsapp_draft', { client_id: ids.sara, message: 'Hi' }),
        call('revenue_summary', { from: '2026-09-29', to: '2026-10-05' }),
      ),
      reply({ content: 'ok' }),
    )
    const r2 = await ask(scope('acct', ACCOUNTANT), acct.client)
    const [lapsed, draft, revenue] = toolResults(acct.fetchMock)
    expect(lapsed.error).toBe('not_allowed')
    expect(draft.error).toBe('not_allowed')
    expect(revenue.period.revenueAed).toBe(800)
    expect(r2.denied).toEqual(['lapsed_clients', 'whatsapp_draft'])
    expect(r2.links.some((l) => l.kind === 'whatsapp')).toBe(false)
  })

  it('drafts WhatsApp click-to-send links server-side, only with marketing consent, never exposing the phone', async () => {
    const { fetchMock, client } = scripted(
      tools(
        call('whatsapp_draft', { client_id: ids.sara, message: 'Hi Sara, we miss you at Lotus Spa!' }),
        call('whatsapp_draft', { client_id: ids.huda, message: 'Hi Huda' }),
        call('whatsapp_draft', { client_id: '00000000-0000-4000-8000-000000000000', message: 'Hi' }),
      ),
      reply({ content: 'Draft ready — open it to send.' }),
    )
    const res = await ask(scope('owner', OWNER), client)
    const [ok, noConsent, missing] = toolResults(fetchMock)
    expect(ok).toMatchObject({ ok: true, client: 'Sara Ahmed' })
    expect(noConsent.error).toBe('no_consent')
    expect(missing.error).toBe('not_found')
    expect(JSON.stringify(toolResults(fetchMock))).not.toContain('97150111')
    expect(res.links).toEqual([
      {
        kind: 'whatsapp',
        name: 'Sara Ahmed',
        href: `https://wa.me/971501110001?text=${encodeURIComponent('Hi Sara, we miss you at Lotus Spa!')}`,
      },
    ])
  })

  it('caps tool calls per question and reports an unfinished run', async () => {
    const many = Array.from({ length: ASSISTANT_LIMITS.maxToolCalls + 1 }, () => call('list_branches'))
    const { fetchMock, client } = scripted(tools(...many), reply({ content: 'Two branches.' }))
    const res = await ask(scope('owner', OWNER), client)
    expect(res.calls).toHaveLength(ASSISTANT_LIMITS.maxToolCalls + 1)
    expect(toolResults(fetchMock).at(-1).error).toBe('tool_limit')
    expect(toolResults(fetchMock)[0].branches.map((b: { name: string }) => b.name)).toEqual(['Marina', 'JLT'])

    // A model that never stops calling tools ends after maxSteps model calls with no answer.
    const loop = vi.fn().mockImplementation(async () => tools(call('list_branches')))
    const looping = createModelArkClient({ apiKey: 'k', fetch: loop as unknown as typeof fetch })
    const stuck = await ask(scope('owner', OWNER), looping)
    expect(loop).toHaveBeenCalledTimes(ASSISTANT_LIMITS.maxSteps)
    expect(stuck).toMatchObject({ answer: '', incomplete: true })
  })

  it('sends only a short, clipped history', async () => {
    const { fetchMock, client } = scripted(reply({ content: 'Hello.' }))
    const history = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 ? ('assistant' as const) : ('user' as const),
      text: `turn ${i} ${'x'.repeat(2000)}`,
    }))
    await ask(scope('owner', OWNER), client, { history })
    const msgs = body(fetchMock, 0).messages
    expect(msgs).toHaveLength(1 + ASSISTANT_LIMITS.historyTurns + 1)
    expect(msgs[1]!.content.startsWith('turn 4 ')).toBe(true)
    expect(msgs[1]!.content.length).toBeLessThanOrEqual(ASSISTANT_LIMITS.turnChars)
  })

  it('stops at the kill switch and the plan before any model call', async () => {
    const { fetchMock, client } = scripted(reply({ content: 'x' }))
    await platform.update(tenants).set({ aiEnabled: false }).where(eq(tenants.id, ids.tenant!))
    await expect(ask(scope('owner', OWNER), client)).rejects.toBeInstanceOf(AiPausedError)
    await platform
      .update(tenants)
      .set({ aiEnabled: true, featureTier: 'standard' })
      .where(eq(tenants.id, ids.tenant!))
    await expect(ask(scope('owner', OWNER), client)).rejects.toBeInstanceOf(AiNotInPlanError)
    expect(fetchMock).not.toHaveBeenCalled()
    await platform.update(tenants).set({ featureTier: null }).where(eq(tenants.id, ids.tenant!))
  })
})
