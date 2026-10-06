'use client'
import '@/components/site/site.css'
import { createUsePuck, type Data, Puck, useGetPuck, type Viewports } from '@puckeditor/core'
import {
  ArrowLeft,
  Check,
  ExternalLink,
  Eye,
  Monitor,
  Redo2,
  Rocket,
  Save,
  Smartphone,
  Tablet,
  Undo2,
} from 'lucide-react'
import { motion } from 'motion/react'
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
import { EditorContext } from '@/components/site/fields'
import type { Device, Locale, SiteMeta } from '@/components/site/types'
import { Button } from '@/components/ui/button'
import { Sheet, SheetClose } from '@/components/ui/sheet'
import { toast } from '@/components/ui/toast'
import { spring } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { publishPageAction, saveDraftAction } from '../../actions'

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
}
const ChromeContext = createContext<Chrome | null>(null)
const useChrome = () => useContext(ChromeContext)!

type EditorProps = {
  slug: string
  pageId: string
  pageTitle: string
  data: Record<string, unknown>
  meta: SiteMeta
  status: Status
  savedAt: string | null
  canDesign: boolean
  canPublish: boolean
  backHref: string
  previewHref: string
  liveHref: string
}

/**
 * Full-screen Puck editor with our own minimal chrome (PLAN §11.6 / §12): page name, viewport switcher,
 * EN/AR content toggle, undo/redo, Save draft and Publish with confirmation.
 */
export function SiteEditor(props: EditorProps) {
  const [locale, setLocale] = useState<Locale>('en')
  const [device, setDevice] = useState<Device>('lg')
  const [dirty, setDirty] = useState(false)
  const [status, setStatus] = useState<Status>(props.status)
  const baseline = useRef<string | null>(null)
  const config = useMemo(() => editorConfig(props.canDesign), [props.canDesign])
  const metadata = useMemo(() => ({ ...props.meta, locale, editing: true }), [props.meta, locale])
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
  }
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  const permissions = props.canDesign ? {} : { drag: false, duplicate: false, delete: false, insert: false }
  return (
    <div className="site-editor fixed inset-0 z-50 bg-bg text-fg">
      <EditorContext.Provider value={{ locale, device }}>
        <ChromeContext.Provider value={chrome}>
          <Puck
            config={config}
            data={props.data as Partial<Data>}
            metadata={metadata}
            onChange={onChange}
            permissions={permissions}
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
      </EditorContext.Provider>
    </div>
  )
}

/* ------------------------------------------------------------------ Chrome */

function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string; content: React.ReactNode }[]
  label: string
}) {
  return (
    <fieldset className="relative m-0 flex items-center rounded-lg border-0 bg-subtle p-0.5">
      <legend className="sr-only">{label}</legend>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          aria-label={o.label}
          title={o.label}
          onClick={() => onChange(o.value)}
          className={cn(
            'relative grid h-8 min-w-9 place-items-center rounded-md px-2.5 text-[13px] font-medium transition-colors',
            value === o.value ? 'text-fg' : 'text-muted hover:text-fg',
          )}
        >
          {value === o.value && (
            <motion.span
              layoutId={`seg-${label}`}
              transition={spring}
              className="absolute inset-0 rounded-md bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.08)]"
            />
          )}
          <span className="relative">{o.content}</span>
        </button>
      ))}
    </fieldset>
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
  const [publishing, startPublish] = useTransition()
  const [confirm, setConfirm] = useState(false)

  // Baseline for "unsaved changes" once Puck has normalised the initial data.
  const { setBaseline } = chrome
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
        chrome.markSaved(JSON.stringify(data), 'draft')
        toast.success('Draft saved')
      } else if (r) toast.error(r.error)
    })
  const publish = () =>
    startPublish(async () => {
      const data = current()
      const r = await publishPageAction(props.slug, props.pageId, data)
      if (r?.ok) {
        chrome.markSaved(JSON.stringify(data), 'published')
        setConfirm(false)
        toast.success(r.message ?? 'Published')
      } else if (r) toast.error(r.error)
    })

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
              'size-1.5 rounded-full',
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
      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
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
        </div>
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
          <Sheet
            open={confirm}
            onOpenChange={setConfirm}
            title={`Publish ${props.pageTitle}?`}
            description="Visitors will see this version straight away. You can keep editing afterwards."
            trigger={
              <Button className="px-3 sm:px-4">
                <Rocket />
                <span className="hidden sm:inline">Publish</span>
              </Button>
            }
          >
            <ul className="mb-6 space-y-2 text-sm text-muted">
              <li className="flex gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-success" /> Prices, team and hours stay live
                from your dashboard.
              </li>
              <li className="flex gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-success" /> Arabic visitors see the Arabic text
                where you've added it.
              </li>
            </ul>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <SheetClose asChild>
                <Button variant="secondary">Cancel</Button>
              </SheetClose>
              <Button onClick={publish} pending={publishing}>
                Publish now
              </Button>
            </div>
            <a
              href={props.liveHref}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg"
            >
              Open live page <ExternalLink className="size-3.5" />
            </a>
          </Sheet>
        )}
      </div>
    </header>
  )
}

/** Puck's selection colours in the canvas iframe follow our sage accent. */
function FrameStyles({ children, document: doc }: { children: React.ReactNode; document?: Document }) {
  useEffect(() => {
    if (!doc) return
    const el = doc.createElement('style')
    el.textContent = `:root{${PUCK_VARS}}`
    doc.head.appendChild(el)
    return () => el.remove()
  }, [doc])
  return <>{children}</>
}

const PUCK_VARS = [
  '--puck-color-azure-01:#16241c',
  '--puck-color-azure-02:#22372b',
  '--puck-color-azure-03:#2f4a3a',
  '--puck-color-azure-04:#3f5f4c',
  '--puck-color-azure-05:#5e7d6b',
  '--puck-color-azure-06:#7d978a',
  '--puck-color-azure-07:#9bb0a4',
  '--puck-color-azure-08:#b9c9bf',
  '--puck-color-azure-09:#d4dfd8',
  '--puck-color-azure-10:#e8eeea',
  '--puck-color-azure-11:#f2f6f3',
  '--puck-color-azure-12:#f8faf8',
].join(';')

const OVERRIDES = {
  header: () => <EditorHeader />,
  iframe: FrameStyles,
}
