'use client'
import { type Config, type Data, Puck, useGetPuck, type Viewports } from '@puckeditor/core'
import type { PuckNode } from '@spa/services/site-kit'
import { Globe2, X } from 'lucide-react'
import { useEffect, useMemo, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import type { SavedSection } from './context'
import { FrameStyles } from './frame-styles'

const VIEWPORTS: Viewports = [
  { width: 375, height: 'auto', label: 'Mobile', icon: 'Smartphone' },
  { width: 768, height: 'auto', label: 'Tablet', icon: 'Tablet' },
  { width: 1280, height: 'auto', label: 'Desktop', icon: 'Monitor' },
]

type Props = {
  section: SavedSection
  config: Config
  metadata: Record<string, unknown>
  onSave: (node: PuckNode) => Promise<boolean>
  onClose: () => void
}

/**
 * Modal editor for one global section: a second Puck instance (outside the page editor's tree) whose canvas
 * shows just this block in the site theme. Saving updates the saved section — and so every page using it.
 */
export function GlobalSectionEditor({ section, config, metadata, onSave, onClose }: Props) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])
  const data = useMemo(() => ({ root: { props: {} }, content: [section.data] }) as Partial<Data>, [section])
  const meta = useMemo(() => ({ ...metadata, bare: true, editing: true }), [metadata])
  const overrides = useMemo(
    () => ({
      header: () => <GlobalHeader name={section.name} onSave={onSave} onClose={onClose} />,
      iframe: FrameStyles,
    }),
    [section.name, onSave, onClose],
  )
  if (!mounted) return null
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Edit global section ${section.name}`}
      className="site-editor anim-fade-in fixed inset-0 z-[70] bg-bg text-fg"
    >
      <Puck
        config={config}
        data={data}
        metadata={meta}
        viewports={VIEWPORTS}
        ui={{
          viewports: { current: { width: 1280, height: 'auto' }, controlsVisible: false, options: VIEWPORTS },
        }}
        iframe={{ enabled: true }}
        overrides={overrides}
        height="100dvh"
      />
    </div>,
    document.body,
  )
}

function GlobalHeader({
  name,
  onSave,
  onClose,
}: {
  name: string
  onSave: (node: PuckNode) => Promise<boolean>
  onClose: () => void
}) {
  const getPuck = useGetPuck()
  const [pending, start] = useTransition()
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !pending) onClose()
    }
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('keydown', esc)
    }
  }, [onClose, pending])
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
    <header className="flex h-14 items-center gap-3 border-b bg-surface px-3 sm:px-4">
      <Button variant="ghost" size="icon" aria-label="Close without saving" onClick={onClose}>
        <X />
      </Button>
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
        <Globe2 className="size-4" strokeWidth={1.75} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold tracking-tight">{name}</p>
        <p className="truncate text-xs text-muted">
          Global section · changes show on every page that uses it
        </p>
      </div>
      <Button onClick={save} pending={pending}>
        Save global section
      </Button>
    </header>
  )
}
