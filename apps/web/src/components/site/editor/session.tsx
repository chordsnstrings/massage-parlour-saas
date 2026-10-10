'use client'
// F29 — Studio editor session helpers (super-admin tooling, EN UI): the page editing lock (take + heartbeat, view-only
// polling, take over), the unsaved local copy (localStorage per spa + page, restored after a crash with a prompt) and
// the autosave status line + banners. The editor (editor/[pageId]/editor.tsx) wires them to Puck.
import { CloudOff, Lock, RotateCcw, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { ActionResult } from '@/lib/action'

/** Autosave runs this long after the last change. */
export const AUTOSAVE_MS = 2000
/** The open editor renews its lock this often (services PAGE_LOCK_HEARTBEAT_MS). */
export const LOCK_HEARTBEAT_MS = 30_000

export type LockHolder = { name: string; since?: string; until?: string }
/**
 * `checking` until the first lock call answers; `mine` = this editor holds it; `other` = someone else does (`held`: on
 * open, `taken`: they took over while this editor was open, `free`: they left — reload to edit).
 */
export type LockState =
  | { kind: 'checking' }
  | { kind: 'mine' }
  | { kind: 'other'; holder: LockHolder; reason: 'held' | 'taken' | 'free' }

export type LockApi = {
  acquire: (takeOver?: boolean) => Promise<ActionResult>
  status: () => Promise<ActionResult>
  release: () => Promise<ActionResult>
}

/**
 * Takes the page lock on open (unless the server already said someone else holds it), renews it every 30 s and when
 * the tab becomes visible again, and reports a take-over by someone else. While view-only it only polls who holds
 * it (never takes it silently: the canvas may be stale) and offers a reload once it is free.
 */
export function useEditorLock(api: LockApi, initialHolder: LockHolder | null) {
  const [lock, setLock] = useState<LockState>(
    initialHolder ? { kind: 'other', holder: initialHolder, reason: 'held' } : { kind: 'checking' },
  )
  const kind = lock.kind
  /** Holds or is taking the lock: heartbeat (one effect run from open until someone else has it). */
  const active = kind !== 'other'
  const apiRef = useRef(api)
  apiRef.current = api

  useEffect(() => {
    if (!active) return
    let stop = false
    const beat = async () => {
      const r = await apiRef.current.acquire().catch(() => null)
      if (stop || !r?.ok) return
      if (r.data?.held) setLock((l) => (l.kind === 'other' ? l : { kind: 'mine' }))
      else
        setLock((l) => ({
          kind: 'other',
          holder: r.data?.holder as LockHolder,
          reason: l.kind === 'mine' ? 'taken' : 'held',
        }))
    }
    void beat()
    const t = setInterval(beat, LOCK_HEARTBEAT_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void beat()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stop = true
      clearInterval(t)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [active])

  const reason = lock.kind === 'other' ? lock.reason : null
  useEffect(() => {
    if (kind !== 'other' || reason === 'free') return
    let stop = false
    const poll = async () => {
      const r = await apiRef.current.status().catch(() => null)
      if (stop || !r?.ok) return
      const holder = r.data?.holder as LockHolder | null
      setLock((l) =>
        l.kind !== 'other'
          ? l
          : holder
            ? { ...l, holder }
            : { kind: 'other', holder: l.holder, reason: 'free' },
      )
    }
    const t = setInterval(poll, LOCK_HEARTBEAT_MS)
    return () => {
      stop = true
      clearInterval(t)
    }
  }, [kind, reason])

  // Best effort when the tab goes away; otherwise the lock frees itself 2 minutes after the last heartbeat.
  useEffect(() => {
    if (kind !== 'mine') return
    const bye = () => void apiRef.current.release().catch(() => null)
    window.addEventListener('pagehide', bye)
    return () => window.removeEventListener('pagehide', bye)
  }, [kind])

  /** Someone else's lock refused a save: this editor is view-only from now on. */
  const lost = useCallback((name: string) => {
    setLock({ kind: 'other', holder: { name }, reason: 'taken' })
  }, [])
  return { lock, setLock, lost }
}

/* ------------------------------------------------------------------ Local copy */

export type LocalCopy = { data: Record<string, unknown>; stamp: string; at: number }

export const localCopyKey = (slug: string, pageId: string) => `spa-editor-draft:${slug}:${pageId}`

export function readLocalCopy(key: string): LocalCopy | null {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const v = JSON.parse(raw) as LocalCopy
    return v && typeof v.data === 'object' && typeof v.at === 'number' ? v : null
  } catch {
    return null
  }
}

export function writeLocalCopy(key: string, json: string, stamp: string) {
  try {
    window.localStorage.setItem(key, `{"stamp":${JSON.stringify(stamp)},"at":${Date.now()},"data":${json}}`)
  } catch {
    // Storage full or blocked (private mode): the server autosave still runs.
  }
}

export function clearLocalCopy(key: string) {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // ignore
  }
}

/* ------------------------------------------------------------------ Status + banners */

export type SaveState = 'idle' | 'saving' | 'saved' | 'offline' | 'conflict' | 'error'

/** Re-renders every `ms` (relative "Saved · 3 min ago" times). */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

export function savedAgo(at: number, now: number) {
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  return `at ${new Date(at).toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit' })}`
}

/** The header's one-line state. */
export function saveStatusText(o: {
  lock: LockState
  state: SaveState
  dirty: boolean
  savedAt: number | null
  published: boolean
  now: number
}) {
  if (o.lock.kind === 'other') return 'View only'
  if (o.state === 'saving') return 'Saving…'
  if (o.state === 'offline') return 'Offline – changes kept locally'
  if (o.state === 'conflict') return 'Changed elsewhere (Claude or another editor)'
  if (o.state === 'error') return 'Not saved'
  if (o.dirty) return 'Unsaved changes'
  if (o.savedAt !== null && o.state === 'saved') return `Saved · ${savedAgo(o.savedAt, o.now)}`
  return o.published ? 'Live' : o.savedAt !== null ? `Draft saved · ${savedAgo(o.savedAt, o.now)}` : 'Draft'
}

function Banner({
  tone,
  icon,
  children,
  actions,
  label,
}: {
  tone: 'warn' | 'info'
  icon: React.ReactNode
  children: React.ReactNode
  actions: React.ReactNode
  label: string
}) {
  return (
    <section
      aria-label={label}
      className="fixed inset-x-3 top-16 z-[58] mx-auto flex max-w-2xl flex-col gap-3 rounded-2xl border bg-surface p-3 shadow-pop sm:flex-row sm:items-center sm:p-4"
    >
      <span
        className={
          tone === 'warn'
            ? 'grid size-8 shrink-0 place-items-center rounded-full bg-warning/15 text-warning'
            : 'grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-accent'
        }
      >
        {icon}
      </span>
      <div role={tone === 'warn' ? 'alert' : 'status'} className="min-w-0 flex-1 text-sm">
        {children}
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>
    </section>
  )
}

export function LockBanner({
  lock,
  onTakeOver,
  onReload,
}: {
  lock: Extract<LockState, { kind: 'other' }>
  onTakeOver: () => Promise<void>
  onReload: () => void
}) {
  const [pending, setPending] = useState(false)
  const { name } = lock.holder
  const take = async () => {
    setPending(true)
    try {
      await onTakeOver()
    } finally {
      setPending(false)
    }
  }
  return (
    <Banner
      tone={lock.reason === 'free' ? 'info' : 'warn'}
      label="Editing lock"
      icon={<Lock className="size-4" />}
      actions={
        lock.reason === 'free' ? (
          <Button size="sm" onClick={onReload}>
            <RotateCcw /> Reload to edit
          </Button>
        ) : (
          <Button size="sm" variant="secondary" onClick={take} pending={pending}>
            Take over
          </Button>
        )
      }
    >
      {lock.reason === 'free' ? (
        <p>
          <span className="font-medium">{name}</span> closed this page. Reload to get their latest version and
          edit.
        </p>
      ) : lock.reason === 'taken' ? (
        <p>
          <span className="font-medium">{name} took over editing this page</span> — view only. Your unsaved
          changes are kept on this device.
        </p>
      ) : (
        <p>
          <span className="font-medium">{name} is editing this page</span> — view only. Take over to edit
          (they switch to view only).
        </p>
      )}
    </Banner>
  )
}

export function ConflictBanner({ onReload, onKeepMine }: { onReload: () => void; onKeepMine: () => void }) {
  return (
    <Banner
      tone="warn"
      label="Changed elsewhere"
      icon={<TriangleAlert className="size-4" />}
      actions={
        <>
          <Button size="sm" variant="secondary" onClick={onReload}>
            Reload
          </Button>
          <Button size="sm" onClick={onKeepMine}>
            Keep mine
          </Button>
        </>
      }
    >
      <p>
        <span className="font-medium">Changed elsewhere (Claude or another editor).</span> Reload to get the
        latest version (your unsaved changes are dropped), or keep yours and replace it.
      </p>
    </Banner>
  )
}

export function RestoreBanner({
  copy,
  stale,
  onRestore,
  onDiscard,
}: {
  copy: LocalCopy
  stale: boolean
  onRestore: () => void
  onDiscard: () => void
}) {
  const now = useNow()
  return (
    <Banner
      tone="info"
      label="Unsaved changes found"
      icon={<CloudOff className="size-4" />}
      actions={
        <>
          <Button size="sm" variant="secondary" onClick={onDiscard}>
            Discard
          </Button>
          <Button size="sm" onClick={onRestore}>
            Restore
          </Button>
        </>
      }
    >
      <p>
        <span className="font-medium">Unsaved changes from {savedAgo(copy.at, now)}</span> were kept on this
        device.
        {stale &&
          ' The page was saved since (by you, Claude or another editor) — restoring replaces that version.'}
      </p>
    </Banner>
  )
}

/** Reloads the editor without the "leave site?" prompt (the caller decided what happens to unsaved changes). */
export function reloadEditor(leaving: { current: boolean }) {
  leaving.current = true
  window.location.reload()
}
