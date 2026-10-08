'use client'
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
import { VersionsSheet } from '@/components/site/editor/versions'
import { type AiAssist, EditorContext } from '@/components/site/fields'
import type { Device, Locale, SiteMeta } from '@/components/site/types'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
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
  renameSectionAction,
  restoreVersionAction,
  saveSectionAction,
  translateBatchAction,
  updateGlobalSectionAction,
} from '../actions'

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
  canDesign: boolean
  canPublish: boolean
  canInsights: boolean
  aiReady: boolean
  sections: SavedSection[]
  pages: { slug: string; visible: boolean; published: boolean }[]
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
  const baseline = useRef<string | null>(null)
  const { slug } = props

  const baseConfig = useMemo(() => editorConfig(props.canDesign), [props.canDesign])
  const config = useMemo(() => withInsights(baseConfig), [baseConfig])
  const globals = useMemo(
    () => Object.fromEntries(sections.filter((s) => s.isGlobal).map((s) => [s.id, s.data])),
    [sections],
  )
  const metadata = useMemo(
    () => ({ ...props.meta, locale, editing: true, globals, insights }),
    [props.meta, locale, globals, insights],
  )
  const onChange = useCallback((data: Data) => {
    if (baseline.current !== null) setDirty(JSON.stringify(data) !== baseline.current)
  }, [])
  const markSaved = useCallback((json: string, next: Status) => {
    baseline.current = json
    setDirty(false)
    setStatus(next)
  }, [])
  const setBaseline = useCallback((json: string) => {
    if (baseline.current === null) baseline.current = json
  }, [])
  const preflightContext = useMemo(
    () => ({
      colors: preflightColors(props.meta.theme),
      pages: props.pages,
      currentSlug: props.pageSlug,
    }),
    [props.meta.theme, props.pages, props.pageSlug],
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
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
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

  const permissions = props.canDesign ? {} : { drag: false, duplicate: false, delete: false, insert: false }
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
  const [saving, startSave] = useTransition()

  // Baseline for "unsaved changes" once Puck has normalised the initial data.
  const { setBaseline, markSaved } = chrome
  useEffect(() => {
    const t = setTimeout(() => setBaseline(JSON.stringify(getPuck().appState.data)), 400)
    return () => clearTimeout(t)
  }, [getPuck, setBaseline])

  const setDevice = (d: Device) => {
    chrome.setDevice(d)
    dispatch({
      type: 'setUi',
      ui: { viewports: { ...viewports, current: { width: DEVICE_WIDTH[d], height: 'auto' } } },
    })
  }

  const current = () => getPuck().appState.data
  const save = () =>
    startSave(async () => {
      const data = current()
      const r = await saveDraftAction(props.slug, props.pageId, data)
      if (r?.ok) {
        markSaved(JSON.stringify(data), 'draft')
        toast.success('Draft saved')
      } else if (r) toast.error(r.error)
    })
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
      restore: (versionId: string) => restoreVersionAction(props.slug, props.pageId, versionId),
      previewLink: (days: 1 | 7 | 30) => previewLinkAction(props.slug, props.pageId, days),
    }),
    [props.slug, props.pageId],
  )

  const state = chrome.dirty ? 'Unsaved changes' : chrome.status === 'published' ? 'Live' : 'Draft saved'
  return (
    <header className="flex h-14 items-center gap-2 border-b bg-surface px-2 sm:gap-3 sm:px-4">
      <Button variant="ghost" size="icon" asChild className="shrink-0">
        <Link href={props.backHref} aria-label="Back to website">
          <ArrowLeft />
        </Link>
      </Button>
      <div className="min-w-0 flex-1 md:flex-none">
        <p className="truncate text-sm font-semibold tracking-tight">{props.pageTitle}</p>
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <span
            className={cn(
              'size-1.5 shrink-0 rounded-full',
              chrome.dirty ? 'bg-warning' : chrome.status === 'published' ? 'bg-success' : 'bg-muted',
            )}
          />
          <span className="truncate">{state}</span>
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
        <VersionsSheet api={versionsApi} dirty={chrome.dirty} onRestored={onRestored} />
        <Button
          variant="secondary"
          onClick={save}
          pending={saving}
          className="px-3 sm:px-4"
          aria-label="Save draft"
        >
          {!saving && <Save />}
          <span className="hidden sm:inline">Save draft</span>
        </Button>
        {props.canPublish && (
          <PublishSheet
            pageTitle={props.pageTitle}
            liveHref={props.liveHref}
            context={chrome.preflight}
            publish={(data) => publishCheckedAction(props.slug, props.pageId, data)}
            onPublished={(data) => markSaved(JSON.stringify(data), 'published')}
          />
        )}
      </div>
    </header>
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
