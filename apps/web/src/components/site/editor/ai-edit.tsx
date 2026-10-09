'use client'
import { Sparkles, Undo2, X } from 'lucide-react'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import type { ActionResult } from '@/lib/action'
import { cn } from '@/lib/utils'
import type { SiteTheme } from '../theme'

type PageJson = Record<string, unknown>
/** Before an applied change: the page + theme to show again, and `restore` (opaque, sent back with the undo). */
type Snapshot = { data: PageJson; theme: SiteTheme | null; restore?: unknown }
type Plan = {
  data: PageJson
  theme: SiteTheme | null
  summary: string[]
  note: string
  ops: { op: string }[]
}
type Applied = { at: number; instruction: string; summary: string[]; previous: Snapshot }

/** How many applied AI changes the panel keeps for undo (newest first). */
const HISTORY = 5

export type AiEditApi = {
  plan: (input: { instruction: string; data: PageJson }) => Promise<ActionResult>
  apply: (input: { instruction: string; ops: { op: string }[]; data: PageJson }) => Promise<ActionResult>
  undo: (input: { summary: string[]; data: PageJson; restore?: unknown }) => Promise<ActionResult>
}

/**
 * "Ask AI" (Website Studio, super-admin tooling — English UI; instructions in any language): an instruction becomes
 * a previewed change on the canvas (page + draft theme), then Apply saves it as the draft (never publishes). The last
 * few applied changes stay listed; Undo reverts the newest to the draft before it. `show` puts data/theme on the
 * canvas; `saved` resets the editor's unsaved-changes baseline. `enabled` = SITE_AI_EDITOR_EMAILS account.
 */
export function AiEditPanel({
  api,
  enabled,
  getData,
  theme,
  show,
  saved,
}: {
  api: AiEditApi
  enabled: boolean
  getData: () => PageJson
  theme: SiteTheme
  show: (data: PageJson, theme: SiteTheme) => void
  saved: () => void
}) {
  const [open, setOpen] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [plan, setPlan] = useState<
    (Plan & { instruction: string; before: Snapshot & { theme: SiteTheme } }) | null
  >(null)
  const [history, setHistory] = useState<Applied[]>([])
  const [pending, start] = useTransition()

  const preview = () =>
    start(async () => {
      const before = { data: getData(), theme }
      const r = await api.plan({ instruction, data: before.data })
      if (!r?.ok) {
        if (r) toast.error(r.error)
        return
      }
      const next = r.data as Plan
      setPlan({ ...next, instruction, before })
      show(next.data, next.theme ?? theme)
    })
  const discard = () => {
    if (!plan) return
    show(plan.before.data, plan.before.theme)
    setPlan(null)
  }
  const apply = () =>
    start(async () => {
      if (!plan) return
      const r = await api.apply({ instruction: plan.instruction, ops: plan.ops, data: plan.before.data })
      if (!r?.ok) {
        if (r) toast.error(r.error)
        return
      }
      saved()
      const previous = r.data?.previous as Snapshot
      setHistory((h) =>
        [{ at: Date.now(), instruction: plan.instruction, summary: plan.summary, previous }, ...h].slice(
          0,
          HISTORY,
        ),
      )
      setPlan(null)
      setInstruction('')
      toast.success(r.message ?? 'Saved')
    })
  const undo = () =>
    start(async () => {
      const latest = history[0]
      if (!latest) return
      const prev = latest.previous
      const r = await api.undo({ summary: latest.summary, data: prev.data, restore: prev.restore })
      if (!r?.ok) {
        if (r) toast.error(r.error)
        return
      }
      show(prev.data, prev.theme ?? theme)
      setTimeout(saved, 60)
      setHistory((h) => h.slice(1))
      toast.success(r.message ?? 'Undone')
    })

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen((o) => !o)}
        aria-pressed={open}
        aria-label="Ask AI"
        title="Ask AI to edit this page"
        className={cn(open && 'bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent')}
      >
        <Sparkles />
      </Button>
      {open && (
        <section
          aria-label="Ask AI"
          className="fixed end-3 top-16 z-[60] w-[min(24rem,calc(100vw-1.5rem))] rounded-2xl border bg-surface p-4 shadow-pop"
        >
          <header className="mb-3 flex items-center gap-2">
            <Sparkles className="size-4 text-accent" />
            <h2 className="flex-1 text-sm font-semibold tracking-tight">Ask AI to edit</h2>
            <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Close Ask AI">
              <X />
            </Button>
          </header>
          {!enabled ? (
            <p role="note" className="rounded-xl border bg-subtle/50 p-3 text-sm text-muted">
              AI site editing isn’t enabled for your account.
            </p>
          ) : plan ? (
            <div className="space-y-3">
              <p className="text-xs text-muted">Previewing on the canvas — nothing is saved yet.</p>
              {plan.note && <p className="text-sm">{plan.note}</p>}
              <ul
                aria-label="Proposed changes"
                className="space-y-1 rounded-xl border bg-subtle/50 p-3 text-sm"
              >
                {plan.summary.map((s, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: static list for one preview
                  <li key={i}>• {s}</li>
                ))}
              </ul>
              {plan.theme && (
                <p className="text-xs text-muted">
                  Theme changes are saved as a draft theme for every page; they go live when you publish.
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={discard} disabled={pending}>
                  Discard
                </Button>
                <Button onClick={apply} pending={pending}>
                  Apply to draft
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <label className="block text-xs text-muted" htmlFor="ai-edit-instruction">
                Describe the change (any language), e.g. “Add an FAQ after the services”, “Rewrite the hero in
                Arabic”, “Make all pages gold”.
              </label>
              <textarea
                id="ai-edit-instruction"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                maxLength={1500}
                rows={3}
                className="w-full resize-y rounded-xl border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
                placeholder="What should change?"
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted">Saved as a draft. Publishing stays separate.</span>
                <Button onClick={preview} pending={pending} disabled={instruction.trim().length < 3}>
                  Preview change
                </Button>
              </div>
              {history.length > 0 && (
                <div className="space-y-2 border-t pt-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-xs font-medium text-muted">Recent AI changes</h3>
                    <Button variant="ghost" onClick={undo} pending={pending}>
                      {!pending && <Undo2 />}
                      Undo AI change
                    </Button>
                  </div>
                  <ol aria-label="Recent AI changes" className="space-y-1 text-xs">
                    {history.map((h, i) => (
                      <li
                        key={h.at}
                        className={cn('truncate', i > 0 && 'text-muted')}
                        title={h.summary.join(' · ')}
                      >
                        {h.instruction}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </>
  )
}
