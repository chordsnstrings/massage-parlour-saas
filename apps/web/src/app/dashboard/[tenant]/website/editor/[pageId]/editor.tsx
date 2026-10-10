'use client'
// Puck styles without outside fonts (F10 CSP); first, before Puck renders.
import '@/components/site/editor/puck-css'
import '@/components/site/site.css'
import {
  ActionBar,
  createUsePuck,
  type Data,
  type Plugin,
  Puck,
  useGetPuck,
  type Viewports,
} from '@puckeditor/core'
import { GLOBAL_SECTION, type PreflightContext, type PuckNode } from '@spa/services/site-kit'
import {
  ArrowLeft,
  BarChart3,
  BookmarkPlus,
  Eye,
  LibraryBig,
  Monitor,
  Redo2,
  Save,
  Smartphone,
  Tablet,
  Undo2,
} from 'lucide-react'
import Link from 'next/link'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react'
import { editorConfig } from '@/components/site/config'
import { AiEditPanel } from '@/components/site/editor/ai-edit'
import { preflightColors } from '@/components/site/editor/colors'
import {
  type EditorServices,
  EditorServicesContext,
  type LibraryTab,
  type SavedSection,
  useEditorServices,
} from '@/components/site/editor/context'
import { FrameStyles } from '@/components/site/editor/frame-styles'
import { GlobalSectionEditor } from '@/components/site/editor/global-editor'
import { type InsightsMeta, withInsights } from '@/components/site/editor/insights'
import { LibraryPanel } from '@/components/site/editor/library'
import { PublishSheet } from '@/components/site/editor/publish'
import { Segmented } from '@/components/site/editor/segmented'
import {
  AUTOSAVE_MS,
  ConflictBanner,
  clearLocalCopy,
  type LocalCopy,
  LockBanner,
  type LockHolder,
  type LockState,
  localCopyKey,
  RestoreBanner,
  readLocalCopy,
  reloadEditor,
  type SaveState,
  saveStatusText,
  useEditorLock,
  useNow,
  writeLocalCopy,
} from '@/components/site/editor/session'
import { VersionsSheet } from '@/components/site/editor/versions'
import { type AiAssist, EditorContext } from '@/components/site/fields'
import type { SiteTheme } from '@/components/site/theme'
import type { Device, Locale, SiteMeta } from '@/components/site/types'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import type { ActionResult } from '@/lib/action'
import { cn } from '@/lib/utils'
import { saveDraftAction } from '../../actions'
import {
  aiTextAction,
  blockStatsAction,
  deleteSectionAction,
  labelVersionAction,
  listVersionsAction,
  previewLinkAction,
  publishCheckedAction,
  publishNotesAction,
  renameSectionAction,
  restoreVersionAction,
  saveSectionAction,
  translateBatchAction,
  updateGlobalSectionAction,
} from '../actions'
import { aiEditApplyAction, aiEditPlanAction, aiEditUndoAction } from '../ai-edit-actions'
import { editorLockAction, editorLockStatusAction, releaseEditorLockAction } from '../lock-actions'

const usePuckStore = createUsePuck()

const VIEWPORTS: Viewports = [
  { width: 375, height: 'auto', label: 'Mobile', icon: 'Smartphone' },
  { width: 768, height: 'auto', label: 'Tablet', icon: 'Tablet' },
  { width: 1280, height: 'auto', label: 'Desktop', icon: 'Monitor' },
]
const DEVICE_WIDTH: Record<Device, number> = { base: 375, md: 768, lg: 1280 }
const DEVICES = [
  { key: 'base' as const, label: 'Mobile 375', Icon: Smartphone },
  { key: 'md' as const, label: 'Tablet 768', Icon: Tablet },
  { key: 'lg' as const, label: 'Desktop 1280', Icon: Monitor },
]

type Status = 'draft' | 'published'
type Insights = NonNullable<InsightsMeta['insights']>
/** Services EditStamp: what this editor loaded (sent with saves / publish / Ask AI; refreshed from each reply). */
export type EditStamp = { page: string; site: string; themeDraft: boolean; pendingRename: boolean }
type Chrome = {
  props: EditorProps
  locale: Locale
  setLocale: (l: Locale) => void
  device: Device
  setDevice: (d: Device) => void
  dirty: boolean
  status: Status
  markSaved: (json: string, status: Status) => void
  setBaseline: (json: string) => void
  insights: Insights | null
  setInsights: (i: Insights | null) => void
  preflight: Omit<PreflightContext, 'globalIds'>
  /** Theme on the canvas (an AI edit preview may change it before it is saved). */
  theme: SiteTheme
  setTheme: (t: SiteTheme) => void
  stamp: EditStamp
  /** Latest stamp for action calls (callbacks read it without re-rendering). */
  stampRef: { readonly current: EditStamp }
  /** Takes the stamp from an action reply (`r.data.stamp`), when there is one. */
  takeStamp: <R extends ActionResult | undefined>(r: R) => R
  /** F29: bumps on every change while there are unsaved changes (autosave debounce). */
  tick: number
  /** An unapplied Ask AI plan is on the canvas: no autosave, no local copy. */
  previewing: { current: boolean }
  lock: LockState
  /** A save was refused by someone else's lock: view-only from now on. */
  lockLost: (name: string) => void
  takeOver: () => Promise<void>
  releaseLock: () => void
  saveState: SaveState
  setSaveState: (s: SaveState) => void
  savedAt: number | null
  setSavedAt: (at: number) => void
  localKey: string
  /** Set before a deliberate reload / leave, so the unsaved-changes prompt stays quiet. */
  leaving: { current: boolean }
  /** Unsaved local copy found on open (crash / closed tab), offered back once the canvas is ready. */
  restore: LocalCopy | null
  setRestore: (c: LocalCopy | null) => void
  /** Re-checks the canvas against the saved baseline (dirty flag, autosave tick, local copy). */
  noteChange: (data: Data) => void
}
const ChromeContext = createContext<Chrome | null>(null)
const useChrome = () => useContext(ChromeContext)!

type EditorProps = {
  slug: string
  pageId: string
  pageSlug: string
  pageTitle: string
  data: Record<string, unknown>
  meta: SiteMeta
  status: Status
  savedAt: string | null
  stamp: EditStamp
  canDesign: boolean
  canPublish: boolean
  canInsights: boolean
  aiReady: boolean
  /** R16 Ask AI (studio editor; ModelArk configured). */
  aiEditReady: boolean
  /** SITE_AI_EDITOR_EMAILS super-admin with 2FA (else the panel only says it isn't enabled). */
  aiEditAllowed: boolean
  sections: SavedSection[]
  pages: { slug: string; visible: boolean; published: boolean }[]
  /** Someone else holds the editing lock (read when the page loaded): opens view-only. */
  lockHolder: LockHolder | null
  backHref: string
  previewHref: string
  liveHref: string
}

/**
 * Full-screen Puck editor with our own minimal chrome (PLAN §11.6 / §12): page name, viewport switcher,
 * EN/AR content toggle, undo/redo, analytics overlay, versions + preview link, Save draft and Publish with
 * preflight. The left rail adds a Library (section presets + saved/global sections).
 */
export function SiteEditor(props: EditorProps) {
  const [locale, setLocale] = useState<Locale>('en')
  const [device, setDevice] = useState<Device>('lg')
  const [dirty, setDirty] = useState(false)
  const [status, setStatus] = useState<Status>(props.status)
  const [sections, setSectionsState] = useState<SavedSection[]>(props.sections)
  const [tab, setTab] = useState<LibraryTab>('sections')
  const [saving, setSaving] = useState(false)
  const [editingGlobal, setEditingGlobal] = useState<string | null>(null)
  const [insights, setInsights] = useState<Insights | null>(null)
  const [theme, setTheme] = useState<SiteTheme>(props.meta.theme)
  const baseline = useRef<string | null>(null)
  const stampRef = useRef<EditStamp>(props.stamp)
  const [stamp, setStamp] = useState<EditStamp>(props.stamp)
  const takeStamp = useCallback(<R extends ActionResult | undefined>(r: R): R => {
    const next = (r?.ok ? r.data?.stamp : undefined) as EditStamp | null | undefined
    if (next) {
      stampRef.current = next
      setStamp(next)
    }
    return r
  }, [])
  const { slug } = props

  // F29: autosave state, unsaved local copy, editing lock.
  const [tick, setTick] = useState(0)
  const previewing = useRef(false)
  const leaving = useRef(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [savedAt, setSavedAt] = useState<number | null>(() =>
    props.savedAt ? new Date(props.savedAt).getTime() : null,
  )
  const [restore, setRestore] = useState<LocalCopy | null>(null)
  const localKey = localCopyKey(slug, props.pageId)
  const localTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lockApi = useMemo(
    () => ({
      acquire: (takeOver?: boolean) => editorLockAction(slug, props.pageId, { takeOver }),
      status: () => editorLockStatusAction(slug, props.pageId),
      release: () => releaseEditorLockAction(slug, props.pageId),
    }),
    [slug, props.pageId],
  )
  const { lock, setLock, lost: lockLost } = useEditorLock(lockApi, props.lockHolder)
  const takeOver = useCallback(async () => {
    const r = await lockApi.acquire(true)
    if (!r?.ok || !r.data?.held) {
      if (r && !r.ok) toast.error(r.error)
      return
    }
    // Load what they saved last; unsaved changes of this tab stay in the local copy and are offered back.
    setLock({ kind: 'mine' })
    reloadEditor(leaving)
  }, [lockApi, setLock])
  const releaseLock = useCallback(() => {
    if (lock.kind === 'mine') void lockApi.release().catch(() => null)
  }, [lock.kind, lockApi])

  const baseConfig = useMemo(() => editorConfig(props.canDesign), [props.canDesign])
  const config = useMemo(() => withInsights(baseConfig), [baseConfig])
  const globals = useMemo(
    () => Object.fromEntries(sections.filter((s) => s.isGlobal).map((s) => [s.id, s.data])),
    [sections],
  )
  const metadata = useMemo(
    () => ({ ...props.meta, theme, locale, editing: true, globals, insights }),
    [props.meta, theme, locale, globals, insights],
  )
  const onChange = useCallback(
    (data: Data) => {
      if (baseline.current === null) return
      const json = JSON.stringify(data)
      const changed = json !== baseline.current
      setDirty(changed)
      if (localTimer.current) clearTimeout(localTimer.current)
      if (!changed) {
        clearLocalCopy(localKey)
        return
      }
      setTick((t) => t + 1)
      // Unsaved local copy (crash / offline), not of an unapplied AI preview.
      if (!previewing.current)
        localTimer.current = setTimeout(() => writeLocalCopy(localKey, json, stampRef.current.page), 400)
    },
    [localKey],
  )
  const markSaved = useCallback(
    (json: string, next: Status) => {
      baseline.current = json
      setDirty(false)
      setStatus(next)
      if (localTimer.current) clearTimeout(localTimer.current)
      clearLocalCopy(localKey)
    },
    [localKey],
  )
  const setBaseline = useCallback((json: string) => {
    if (baseline.current === null) baseline.current = json
  }, [])
  const preflightContext = useMemo(
    () => ({
      // The canvas theme: the draft theme (and an applied Ask AI theme change) is what this publish takes live.
      colors: preflightColors(theme),
      pages: props.pages,
      currentSlug: props.pageSlug,
    }),
    [theme, props.pages, props.pageSlug],
  )
  const chrome: Chrome = {
    props,
    locale,
    setLocale,
    device,
    setDevice,
    dirty,
    status,
    markSaved,
    setBaseline,
    insights,
    setInsights,
    preflight: preflightContext,
    theme,
    setTheme,
    stamp,
    stampRef,
    takeStamp,
    tick,
    previewing,
    lock,
    lockLost,
    takeOver,
    releaseLock,
    saveState,
    setSaveState,
    savedAt,
    setSavedAt,
    localKey,
    leaving,
    restore,
    setRestore,
    noteChange: onChange,
  }

  const setSections = useCallback(
    (update: (prev: SavedSection[]) => SavedSection[]) => setSectionsState(update),
    [],
  )
  const services: EditorServices = useMemo(
    () => ({
      slug,
      canDesign: props.canDesign,
      aiReady: props.aiReady,
      sections,
      setSections,
      editGlobal: setEditingGlobal,
      library: { tab, setTab, saving, setSaving },
      api: {
        saveSection: (input) => saveSectionAction(slug, input),
        renameSection: (id, name) => renameSectionAction(slug, id, name),
        deleteSection: (id) => deleteSectionAction(slug, id),
        updateGlobal: (id, node) => updateGlobalSectionAction(slug, id, node),
        translate: (texts) => translateBatchAction(slug, texts),
      },
    }),
    [slug, props.canDesign, props.aiReady, sections, setSections, tab, saving],
  )
  const ai: AiAssist = useMemo(
    () => ({
      ready: props.aiReady,
      run: async (op, text, from) => {
        const r = await aiTextAction(slug, { op, text, locale: from })
        if (r?.ok && typeof r.data?.text === 'string') return { ok: true as const, text: r.data.text }
        return {
          ok: false as const,
          error: r && !r.ok ? (r.fieldErrors?.text ?? r.error) : 'Please try again',
        }
      },
    }),
    [slug, props.aiReady],
  )
  const plugins: Plugin[] = useMemo(
    () =>
      props.canDesign
        ? [{ name: 'library', label: 'Library', icon: <LibraryBig />, render: () => <LibraryPanel /> }]
        : [],
    [props.canDesign],
  )

  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => {
      if (!leaving.current) e.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const editing = editingGlobal ? sections.find((s) => s.id === editingGlobal && s.isGlobal) : undefined
  const saveGlobal = useCallback(
    async (node: PuckNode) => {
      if (!editingGlobal) return false
      const r = await updateGlobalSectionAction(slug, editingGlobal, node)
      if (r?.ok) {
        const next = r.data?.section as SavedSection
        setSectionsState((prev) => prev.map((s) => (s.id === next.id ? next : s)))
        toast.success(r.message ?? 'Saved')
        return true
      }
      if (r) toast.error(r.error)
      return false
    },
    [slug, editingGlobal],
  )
  const closeGlobal = useCallback(() => setEditingGlobal(null), [])

  // View only while someone else holds the editing lock (F29); the server refuses this tab's writes meanwhile anyway.
  const permissions =
    lock.kind === 'other'
      ? { drag: false, duplicate: false, delete: false, insert: false, edit: false }
      : props.canDesign
        ? {}
        : { drag: false, duplicate: false, delete: false, insert: false }
  return (
    <div className="site-editor fixed inset-0 z-50 bg-bg text-fg" data-crm-off>
      <EditorContext.Provider value={{ locale, device, ai }}>
        <EditorServicesContext.Provider value={services}>
          <ChromeContext.Provider value={chrome}>
            <Puck
              config={config}
              data={props.data as Partial<Data>}
              metadata={metadata}
              onChange={onChange}
              permissions={permissions}
              plugins={plugins}
              viewports={VIEWPORTS}
              ui={{
                viewports: {
                  current: { width: 1280, height: 'auto' },
                  controlsVisible: false,
                  options: VIEWPORTS,
                },
              }}
              iframe={{ enabled: true }}
              overrides={OVERRIDES}
              height="100dvh"
            />
          </ChromeContext.Provider>
          {editing && (
            <EditorContext.Provider value={{ locale, device: 'lg', ai }}>
              <GlobalSectionEditor
                section={editing}
                config={baseConfig}
                metadata={metadata}
                onSave={saveGlobal}
                onClose={closeGlobal}
              />
            </EditorContext.Provider>
          )}
        </EditorServicesContext.Provider>
      </EditorContext.Provider>
    </div>
  )
}

/* ------------------------------------------------------------------ Chrome */

function InsightsToggle() {
  const chrome = useChrome()
  const getPuck = useGetPuck()
  const [pending, start] = useTransition()
  const on = chrome.insights !== null
  const toggle = () => {
    if (on) {
      chrome.setInsights(null)
      return
    }
    start(async () => {
      const top = getPuck()
        .appState.data.content.map((c) => String(c.props.id))
        .filter(Boolean)
      const r = await blockStatsAction(chrome.props.slug, chrome.props.pageId, top)
      if (!r?.ok) {
        if (r) toast.error(r.error)
        return
      }
      const stats = r.data as Omit<Insights, 'top'>
      chrome.setInsights({ ...stats, top })
      toast.success(
        stats.sessions
          ? `Last ${stats.days} days · ${stats.sessions.toLocaleString('en-AE')} ${stats.sessions === 1 ? 'visit' : 'visits'} to this page`
          : `No visits to this page in the last ${stats.days} days yet`,
      )
    })
  }
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      pending={pending}
      aria-pressed={on}
      aria-label="Block analytics"
      title="Block analytics (last 30 days)"
      className={cn(on && 'bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent')}
    >
      {!pending && <BarChart3 />}
    </Button>
  )
}

function EditorHeader() {
  const chrome = useChrome()
  const { props } = chrome
  const getPuck = useGetPuck()
  const dispatch = usePuckStore((s) => s.dispatch)
  const viewports = usePuckStore((s) => s.appState.ui.viewports)
  const history = usePuckStore((s) => s.history)
  const now = useNow()

  const { setBaseline, markSaved, stampRef, takeStamp, localKey, setRestore, setSaveState, setSavedAt } =
    chrome
  // Baseline for "unsaved changes" once Puck has normalised the initial data; then offer back an unsaved local
  // copy from an earlier session (dropped silently when it matches what was saved).
  useEffect(() => {
    const t = setTimeout(() => {
      const json = JSON.stringify(getPuck().appState.data)
      setBaseline(json)
      const copy = readLocalCopy(localKey)
      if (copy && JSON.stringify(copy.data) !== json) setRestore(copy)
      else if (copy) clearLocalCopy(localKey)
    }, 400)
    return () => clearTimeout(t)
  }, [getPuck, setBaseline, localKey, setRestore])

  // F29 autosave: ~2 s after the last change, on blur / tab hidden, retried when back online. Sends the edit stamp,
  // so it never silently overwrites a change made elsewhere (→ "Changed elsewhere": reload or keep mine).
  const dirtyRef = useRef(chrome.dirty)
  dirtyRef.current = chrome.dirty
  const lockRef = useRef(chrome.lock)
  lockRef.current = chrome.lock
  const chromeRef = useRef(chrome)
  chromeRef.current = chrome
  const busy = useRef(false)
  const again = useRef(false)
  const persistRef = useRef<(mode: 'auto' | 'manual' | 'overwrite') => Promise<void>>(async () => {})
  const persist = useCallback(
    async (mode: 'auto' | 'manual' | 'overwrite') => {
      const c = chromeRef.current
      if (lockRef.current.kind === 'other' || c.previewing.current) return
      if (mode === 'auto' && !dirtyRef.current) return
      if (busy.current) {
        again.current = true
        return
      }
      const data = getPuck().appState.data
      const json = JSON.stringify(data)
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        writeLocalCopy(localKey, json, stampRef.current.page)
        setSaveState('offline')
        return
      }
      busy.current = true
      setSaveState('saving')
      let r: ActionResult
      try {
        r = takeStamp(
          await saveDraftAction(props.slug, props.pageId, data, stampRef.current, {
            autosave: mode === 'auto',
            overwrite: mode === 'overwrite',
          }),
        )
      } catch {
        // Network / server unreachable: the local copy keeps the changes until the next try.
        busy.current = false
        writeLocalCopy(localKey, json, stampRef.current.page)
        setSaveState('offline')
        return
      }
      busy.current = false
      if (r?.ok) {
        markSaved(json, 'draft')
        setSavedAt(Date.now())
        setSaveState('saved')
        // Edited on while the save was running: still unsaved (re-checked against the new baseline).
        c.noteChange(getPuck().appState.data)
        if (mode === 'overwrite') toast.success('Your version is saved')
        else if (mode === 'manual') toast.success('Draft saved')
      } else if (r?.key === 'errors.domain.editedElsewhere') {
        setSaveState('conflict')
        if (mode !== 'auto') toast.error(r.error)
      } else if (r?.key === 'errors.domain.pageLocked') {
        setSaveState('idle')
        c.lockLost(String(r.params?.name ?? 'Another editor'))
      } else if (r) {
        setSaveState('error')
        toast.error(r.error)
      }
      if (again.current) {
        again.current = false
        void persistRef.current('auto')
      }
    },
    [getPuck, localKey, markSaved, props.pageId, props.slug, setSaveState, setSavedAt, stampRef, takeStamp],
  )
  persistRef.current = persist
  const { tick, dirty, saveState, lock } = chrome
  // biome-ignore lint/correctness/useExhaustiveDependencies: `tick` restarts the debounce on every change
  useEffect(() => {
    if (!dirty || lock.kind === 'other' || saveState === 'conflict' || saveState === 'saving') return
    const t = setTimeout(() => void persistRef.current('auto'), AUTOSAVE_MS)
    return () => clearTimeout(t)
  }, [tick, dirty, lock.kind, saveState])
  useEffect(() => {
    if (saveState !== 'offline') return
    const retry = () => void persistRef.current('auto')
    window.addEventListener('online', retry)
    const t = setInterval(retry, 15_000)
    return () => {
      window.removeEventListener('online', retry)
      clearInterval(t)
    }
  }, [saveState])
  useEffect(() => {
    const flush = () => {
      if (dirtyRef.current) void persistRef.current('auto')
    }
    // Clicking into the canvas iframe also blurs the window: that's still editing, not leaving.
    const onBlur = () =>
      setTimeout(() => {
        if (document.activeElement?.tagName !== 'IFRAME') flush()
      }, 0)
    const onHidden = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onHidden)
    }
  }, [])
  const viewOnly = lock.kind === 'other'

  const setDevice = (d: Device) => {
    chrome.setDevice(d)
    dispatch({
      type: 'setUi',
      ui: { viewports: { ...viewports, current: { width: DEVICE_WIDTH[d], height: 'auto' } } },
    })
  }

  const current = () => getPuck().appState.data
  const save = () => void persist('manual')
  const saving = saveState === 'saving'
  const onRestored = (data: Record<string, unknown>) => {
    getPuck().dispatch({ type: 'setData', data: data as Partial<Data> })
    setTimeout(() => {
      markSaved(JSON.stringify(getPuck().appState.data), 'draft')
    }, 60)
  }
  const versionsApi = useMemo(
    () => ({
      list: () => listVersionsAction(props.slug, props.pageId),
      label: (versionId: string, label: string) => labelVersionAction(props.slug, versionId, label),
      restore: async (versionId: string) =>
        takeStamp(await restoreVersionAction(props.slug, props.pageId, versionId)),
      previewLink: (days: 1 | 7 | 30) => previewLinkAction(props.slug, props.pageId, days),
    }),
    [props.slug, props.pageId, takeStamp],
  )
  const aiEditApi = useMemo(
    () => ({
      plan: (input: unknown) => aiEditPlanAction(props.slug, props.pageId, input),
      apply: async (input: object) =>
        takeStamp(await aiEditApplyAction(props.slug, props.pageId, { ...input, stamp: stampRef.current })),
      undo: async (input: object) =>
        takeStamp(await aiEditUndoAction(props.slug, props.pageId, { ...input, stamp: stampRef.current })),
    }),
    [props.slug, props.pageId, stampRef, takeStamp],
  )
  // What else this publish takes live (a draft theme is site-wide; a pending rename changes the menu / address).
  const alsoPublishes = [
    ...(chrome.stamp.themeDraft ? ['the unpublished site theme (every page)'] : []),
    ...(chrome.stamp.pendingRename ? ['this page’s new menu title / address'] : []),
  ]
  const themeDraft = chrome.stamp.themeDraft
  const loadNotes = useMemo(
    () => (themeDraft ? () => publishNotesAction(props.slug, props.pageId) : undefined),
    [themeDraft, props.slug, props.pageId],
  )

  const state = saveStatusText({
    lock,
    state: saveState,
    dirty,
    savedAt: chrome.savedAt,
    published: chrome.status === 'published',
    now,
  })
  const warn = dirty || saveState === 'offline' || saveState === 'conflict' || saveState === 'error'
  const restore = chrome.restore
  return (
    <>
      <header className="flex h-14 items-center gap-2 border-b bg-surface px-2 sm:gap-3 sm:px-4">
        <Button variant="ghost" size="icon" asChild className="shrink-0">
          <Link href={props.backHref} aria-label="Back to website" onClick={chrome.releaseLock}>
            <ArrowLeft />
          </Link>
        </Button>
        <div className="min-w-0 flex-1 md:flex-none">
          <p className="truncate text-sm font-semibold tracking-tight">{props.pageTitle}</p>
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <span
              className={cn(
                'size-1.5 shrink-0 rounded-full',
                viewOnly
                  ? 'bg-muted'
                  : warn
                    ? 'bg-warning'
                    : saving
                      ? 'animate-pulse bg-accent'
                      : chrome.status === 'published'
                        ? 'bg-success'
                        : 'bg-muted',
              )}
            />
            <span className="truncate" data-testid="save-status" aria-live="polite">
              {state}
            </span>
          </p>
        </div>
        <div className="hidden flex-1 justify-center md:flex">
          <Segmented
            label="Viewport"
            value={chrome.device}
            onChange={setDevice}
            options={DEVICES.map((d) => ({
              value: d.key,
              label: d.label,
              content: <d.Icon className="size-4" strokeWidth={1.5} />,
            }))}
          />
        </div>
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <Segmented
            label="Content language"
            value={chrome.locale}
            onChange={chrome.setLocale}
            options={[
              { value: 'en', label: 'Edit English', content: 'EN' },
              { value: 'ar', label: 'Edit Arabic', content: 'AR' },
            ]}
          />
          <div className="hidden items-center lg:flex">
            <Button
              variant="ghost"
              size="icon"
              onClick={history.back}
              disabled={!history.hasPast}
              aria-label="Undo"
            >
              <Undo2 />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={history.forward}
              disabled={!history.hasFuture}
              aria-label="Redo"
            >
              <Redo2 />
            </Button>
            <Button variant="ghost" size="icon" asChild>
              <a href={props.previewHref} target="_blank" rel="noreferrer" aria-label="Preview draft">
                <Eye />
              </a>
            </Button>
            {props.canInsights && <InsightsToggle />}
          </div>
          {props.aiEditReady && !viewOnly && (
            <AiEditPanel
              api={aiEditApi}
              enabled={props.aiEditAllowed}
              getData={() => current() as unknown as Record<string, unknown>}
              theme={chrome.theme}
              show={(data, theme) => {
                getPuck().dispatch({ type: 'setData', data: data as Partial<Data> })
                chrome.setTheme(theme)
              }}
              saved={() => markSaved(JSON.stringify(getPuck().appState.data), 'draft')}
              onPreview={(on) => {
                chrome.previewing.current = on
              }}
            />
          )}
          <VersionsSheet api={versionsApi} dirty={chrome.dirty} onRestored={onRestored} />
          <Button
            variant="secondary"
            onClick={save}
            pending={saving}
            disabled={viewOnly}
            className="px-3 sm:px-4"
            aria-label="Save draft"
          >
            {!saving && <Save />}
            <span className="hidden sm:inline">Save draft</span>
          </Button>
          {props.canPublish && !viewOnly && (
            <PublishSheet
              pageTitle={props.pageTitle}
              liveHref={props.liveHref}
              context={chrome.preflight}
              publish={async (data) =>
                takeStamp(await publishCheckedAction(props.slug, props.pageId, data, stampRef.current))
              }
              onPublished={(data) => {
                markSaved(JSON.stringify(data), 'published')
                setSaveState('idle')
              }}
              alsoPublishes={alsoPublishes}
              loadNotes={loadNotes}
            />
          )}
        </div>
      </header>
      {lock.kind === 'other' && (
        <LockBanner lock={lock} onTakeOver={chrome.takeOver} onReload={() => reloadEditor(chrome.leaving)} />
      )}
      {!viewOnly && saveState === 'conflict' && (
        <ConflictBanner
          onReload={() => {
            clearLocalCopy(localKey)
            reloadEditor(chrome.leaving)
          }}
          onKeepMine={() => void persist('overwrite')}
        />
      )}
      {!viewOnly && restore && saveState !== 'conflict' && (
        <RestoreBanner
          copy={restore}
          stale={restore.stamp !== stampRef.current.page}
          onRestore={() => {
            setRestore(null)
            getPuck().dispatch({ type: 'setData', data: restore.data as Partial<Data> })
          }}
          onDiscard={() => {
            setRestore(null)
            clearLocalCopy(localKey)
          }}
        />
      )}
    </>
  )
}

/** Block action bar + "Save to library" (opens the Library's save form for the selected block). */
function BlockActionBar({
  label,
  children,
  parentAction,
}: {
  label?: string
  children: React.ReactNode
  parentAction: React.ReactNode
}) {
  const services = useEditorServices()
  const dispatch = usePuckStore((s) => s.dispatch)
  const type = usePuckStore((s) => s.selectedItem?.type)
  const canSave = services?.canDesign && type && type !== GLOBAL_SECTION
  return (
    <ActionBar>
      <ActionBar.Group>
        {parentAction}
        {label && <ActionBar.Label label={label} />}
      </ActionBar.Group>
      <ActionBar.Group>
        {children}
        {canSave && (
          <ActionBar.Action
            label="Save to library"
            onClick={() => {
              services.library.setTab('saved')
              services.library.setSaving(true)
              dispatch({ type: 'setUi', ui: { plugin: { current: 'library' }, leftSideBarVisible: true } })
            }}
          >
            <BookmarkPlus size={16} />
          </ActionBar.Action>
        )}
      </ActionBar.Group>
    </ActionBar>
  )
}

const OVERRIDES = {
  header: () => <EditorHeader />,
  iframe: FrameStyles,
  actionBar: BlockActionBar,
}
