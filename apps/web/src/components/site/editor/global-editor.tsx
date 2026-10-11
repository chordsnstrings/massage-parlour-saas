'use client'
// Puck styles without outside fonts (F10 CSP); first, before Puck renders.
import './puck-css'
import { type Config, type Data, Puck, useGetPuck, type Viewports } from '@puckeditor/core'
import type { PuckNode } from '@spa/services/site-kit'
import { Globe2, Monitor, Smartphone, Tablet, X } from 'lucide-react'
import {
  createContext,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { EditorContext, useEditorContext } from '../fields'
import type { Device, Locale } from '../types'
import type { SavedSection } from './context'
import { FrameStyles } from './frame-styles'
import { Segmented } from './segmented'

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

type Props = {
  section: SavedSection
  config: Config
  metadata: Record<string, unknown>
  onSave: (node: PuckNode) => Promise<boolean>
  onClose: () => void
}

type Chrome = {
  name: string
  locale: Locale
  setLocale: (l: Locale) => void
  device: Device
  setDevice: (d: Device) => void
  onSave: (node: PuckNode) => Promise<boolean>
  onClose: () => void
  root: RefObject<HTMLDivElement | null>
}
const GlobalChrome = createContext<Chrome | null>(null)

/** Escape in a field, or in a menu/popover layered above the dialog, belongs to that element. */
const ownsEscape = (target: EventTarget | null, dialog: HTMLElement | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
    (target !== document.body && !dialog?.contains(target)))

/**
 * Modal editor for one global section: a second Puck instance (outside the page editor's tree) whose canvas
 * shows just this block in the site theme, with its own EN/AR and device switches. Saving updates the saved
 * section — and so every page using it; closing with unsaved edits asks first.
 */
export function GlobalSectionEditor({ section, config, metadata, onSave, onClose }: Props) {
  const outer = useEditorContext()
  const [mounted, setMounted] = useState(false)
  const [locale, setLocale] = useState<Locale>(outer.locale)
  const [device, setDevice] = useState<Device>('lg')
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    setMounted(true)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])
  const data = useMemo(() => ({ root: { props: {} }, content: [section.data] }) as Partial<Data>, [section])
  const meta = useMemo(() => ({ ...metadata, locale, bare: true, editing: true }), [metadata, locale])
  const chrome = useMemo(
    () => ({ name: section.name, locale, setLocale, device, setDevice, onSave, onClose, root }),
    [section.name, locale, device, onSave, onClose],
  )
  const fieldContext = useMemo(() => ({ ...outer, locale, device }), [outer, locale, device])
  if (!mounted) return null
  return createPortal(
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label={`Edit global section ${section.name}`}
      className="site-editor anim-fade-in fixed inset-0 z-[70] bg-bg text-fg"
    >
      <EditorContext.Provider value={fieldContext}>
        <GlobalChrome.Provider value={chrome}>
          <Puck
            config={config}
            data={data}
            metadata={meta}
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
        </GlobalChrome.Provider>
      </EditorContext.Provider>
    </div>,
    document.body,
  )
}

const OVERRIDES = { header: () => <GlobalHeader />, iframe: FrameStyles }

function GlobalHeader() {
  const chrome = useContext(GlobalChrome)!
  const { name, onSave, onClose, root } = chrome
  const getPuck = useGetPuck()
  const [pending, start] = useTransition()

  // Baseline for "unsaved changes" once Puck has normalised the block.
  const baseline = useRef<string | null>(null)
  useEffect(() => {
    const t = setTimeout(() => {
      baseline.current = JSON.stringify(getPuck().appState.data.content)
    }, 400)
    return () => clearTimeout(t)
  }, [getPuck])
  const close = useCallback(() => {
    const dirty =
      baseline.current !== null && JSON.stringify(getPuck().appState.data.content) !== baseline.current
    if (dirty && !window.confirm('Discard your changes to this global section?')) return
    onClose()
  }, [getPuck, onClose])

  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || pending || ownsEscape(e.target, root.current)) return
      close()
    }
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('keydown', esc)
    }
  }, [close, pending, root])

  const setDevice = (d: Device) => {
    chrome.setDevice(d)
    const { viewports } = getPuck().appState.ui
    getPuck().dispatch({
      type: 'setUi',
      ui: { viewports: { ...viewports, current: { width: DEVICE_WIDTH[d], height: 'auto' } } },
    })
  }

  const save = () =>
    start(async () => {
      const content = getPuck().appState.data.content
      if (content.length !== 1) {
        toast.error('A global section is one block — keep a single top-level block (use a Section to group).')
        return
      }
      if (await onSave(content[0] as PuckNode)) onClose()
    })
  return (
    <header className="flex h-14 items-center gap-2 border-b bg-surface px-2 sm:gap-3 sm:px-4">
      <Button variant="ghost" size="icon" aria-label="Close global section editor" onClick={close}>
        <X />
      </Button>
      <span className="hidden size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent sm:grid">
        <Globe2 className="size-4" strokeWidth={1.75} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold tracking-tight">{name}</p>
        <p className="truncate text-xs text-muted">
          Global section · changes show on every page that uses it
        </p>
      </div>
      <div className="hidden md:flex">
        <Segmented
          label="Global section viewport"
          value={chrome.device}
          onChange={setDevice}
          options={DEVICES.map((d) => ({
            value: d.key,
            label: d.label,
            content: <d.Icon className="size-4" strokeWidth={1.5} />,
          }))}
        />
      </div>
      <Segmented
        label="Global section language"
        value={chrome.locale}
        onChange={chrome.setLocale}
        options={[
          { value: 'en', label: 'Edit English', content: 'EN' },
          { value: 'ar', label: 'Edit Arabic', content: 'AR' },
        ]}
      />
      <Button onClick={save} pending={pending}>
        <span className="sm:hidden">Save</span>
        <span className="hidden sm:inline">Save global section</span>
      </Button>
    </header>
  )
}
