'use client'
import { Sparkles, Undo2, X } from 'lucide-react'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import type { ActionResult } from '@/lib/action'
import { cn } from '@/lib/utils'
import type { SiteTheme } from '../theme'

type PageJson = Record<string, unknown>
type Snapshot = { data: PageJson; theme: SiteTheme | null }
type Plan = { data: PageJson; theme: SiteTheme | null; summary: string[]; note: string }

export type AiEditApi = {
  plan: (input: { instruction: string; data: PageJson }) => Promise<ActionResult>
  apply: (input: {
    instruction: string
    summary: string[]
    data: PageJson
    theme: SiteTheme | null
  }) => Promise<ActionResult>
  undo: (input: { summary: string[]; data: PageJson; theme: SiteTheme | null }) => Promise<ActionResult>
}

/**
 * R16 "Ask AI" (Website Studio, super-admin tooling — English UI): an instruction becomes a previewed change on
 * the canvas (page + theme), then Apply saves it as the draft (never publishes) and Undo restores the previous
 * draft. `show` puts data/theme on the canvas; `saved` resets the editor's unsaved-changes baseline.
 */
export function AiEditPanel({
  api,
  getData,
  theme,
  show,
  saved,
}: {
  api: AiEditApi
  getData: () => PageJson
  theme: SiteTheme
  show: (data: PageJson, theme: SiteTheme) => void
  saved: () => void
}) {
  const [open, setOpen] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [plan, setPlan] = useState<(Plan & { before: Snapshot & { theme: SiteTheme } }) | null>(null)
  const [applied, setApplied] = useState<{ summary: string[]; previous: Snapshot } | null>(null)
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
      setApplied(null)
      setPlan({ ...next, before })
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
      const r = await api.apply({
        instruction,
        summary: plan.summary,
        data: plan.data,
        theme: plan.theme,
      })
      if (!r?.ok) {
        if (r) toast.error(r.error)
        return
      }
      saved()
      setApplied({ summary: plan.summary, previous: r.data?.previous as Snapshot })
      setPlan(null)
      setInstruction('')
      toast.success(r.message ?? 'Saved')
    })
  const undo = () =>
    start(async () => {
      if (!applied) return
      const prev = applied.previous
      const r = await api.undo({ summary: applied.summary, data: prev.data, theme: prev.theme })
      if (!r?.ok) {
        if (r) toast.error(r.error)
        return
      }
      show(prev.data, prev.theme ?? theme)
      setTimeout(saved, 60)
      setApplied(null)
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
            <h2 className="flex-1 text-sm font-semibold tracking-tight">Ask AI</h2>
            <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Close Ask AI">
              <X />
            </Button>
          </header>
          {plan ? (
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
                  Theme changes apply to every page once saved (like the Theme panel).
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
                Describe the change, e.g. “Add an FAQ after the services”, “Rewrite the hero in Arabic”, “Make
                all pages gold”.
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
                {applied ? (
                  <Button variant="ghost" onClick={undo} pending={pending}>
                    {!pending && <Undo2 />}
                    Undo AI change
                  </Button>
                ) : (
                  <span className="text-xs text-muted">Saved as a draft. Publishing stays separate.</span>
                )}
                <Button onClick={preview} pending={pending} disabled={instruction.trim().length < 3}>
                  Preview change
                </Button>
              </div>
            </div>
          )}
        </section>
      )}
    </>
  )
}
