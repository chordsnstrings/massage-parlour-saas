'use client'
import { createUsePuck, type Data, type PuckApi, useGetPuck } from '@puckeditor/core'
import { GLOBAL_SECTION, type PuckNode } from '@spa/services/site-kit'
import {
  BookmarkPlus,
  Check,
  Globe2,
  LayoutTemplate,
  PenLine,
  Plus,
  Search,
  TextCursorInput,
  Trash2,
  X,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useMemo, useState, useTransition } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { spring } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { instantiatePreset, type PresetCategory, SECTION_PRESETS } from '../presets'
import { cloneWithIds, type SavedSection, useEditorServices } from './context'
import { scrollToBlock } from './frame-styles'

const usePuckStore = createUsePuck()
const ROOT_ZONE = 'root:default-zone'

const CATEGORY_LABEL: Record<PresetCategory, string> = {
  hero: 'Heroes',
  services: 'Services & prices',
  about: 'About',
  team: 'Team',
  offers: 'Offers',
  'social-proof': 'Reviews & trust',
  faq: 'FAQ',
  contact: 'Contact & hours',
  cta: 'Calls to action',
  motion: '3D motion',
}
const categoryLabel = (c: string) =>
  CATEGORY_LABEL[c as PresetCategory] ?? c.replace(/-/g, ' ').replace(/^\w/, (x) => x.toUpperCase())

/** After the selected block's top-level band, or at the end of the page. */
function insertionIndex(api: PuckApi): number {
  const end = api.appState.data.content.length
  let id = api.selectedItem ? String(api.selectedItem.props.id) : null
  for (let depth = 0; id && depth < 25; depth++) {
    const selector = api.getSelectorForId(id)
    if (!selector) return end
    if (selector.zone === ROOT_ZONE) return selector.index + 1
    const parent = api.getParentById(id)
    id = parent ? String(parent.props.id) : null
  }
  return end
}

/** Inserts a block (with its nested children) at the library's insertion point and selects it. */
export function insertBlock(getPuck: () => PuckApi, node: PuckNode) {
  const api = getPuck()
  const index = insertionIndex(api)
  api.dispatch({
    type: 'setData',
    data: (prev: Data) => ({
      ...prev,
      content: [...prev.content.slice(0, index), node, ...prev.content.slice(index)] as Data['content'],
    }),
  })
  api.dispatch({ type: 'setUi', ui: { itemSelector: { index, zone: ROOT_ZONE } } })
  setTimeout(() => {
    scrollToBlock(String(node.props.id))
  }, 150)
}

/**
 * Library panel (PLAN §11.6 left rail): designed section presets by category with search, and the spa's saved
 * sections — save the selected block, insert, rename, delete, edit global ones.
 */
export function LibraryPanel() {
  const services = useEditorServices()
  const getPuck = useGetPuck()
  const selected = usePuckStore((s) => s.selectedItem)
  const hasSelection = usePuckStore((s) => Boolean(s.selectedItem))
  const [query, setQuery] = useState('')
  if (!services) return null
  const { tab, setTab } = services.library
  const q = query.trim().toLowerCase()
  const where = hasSelection ? 'Inserts after the selected section' : 'Inserts at the end of the page'

  return (
    <div className="flex min-h-full flex-col gap-4 p-4 text-fg">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold tracking-tight">Library</h2>
        <p className="text-xs text-muted">{where}</p>
      </div>
      <label className="relative block">
        <span className="sr-only">Search the library</span>
        <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search sections"
          className="h-10 w-full rounded-lg border bg-surface ps-9 pe-3 text-sm placeholder:text-muted/70 focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
        />
      </label>
      <div role="tablist" aria-label="Library" className="relative flex rounded-lg bg-subtle p-0.5">
        {(
          [
            ['sections', 'Sections', SECTION_PRESETS.length],
            ['saved', 'Saved', services.sections.length],
          ] as const
        ).map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn(
              'relative flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md text-[13px] font-medium transition-colors',
              tab === key ? 'text-fg' : 'text-muted hover:text-fg',
            )}
          >
            {tab === key && (
              <motion.span
                layoutId="library-tab"
                transition={spring}
                className="absolute inset-0 rounded-md bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.08)]"
              />
            )}
            <span className="relative">{label}</span>
            <span className="relative text-[11px] text-muted tabular-nums">{count}</span>
          </button>
        ))}
      </div>
      {tab === 'sections' ? (
        <PresetList query={q} onInsert={(node) => insertBlock(getPuck, node)} />
      ) : (
        <SavedList
          query={q}
          selected={selected as PuckNode | null}
          onInsert={(s) => {
            const node: PuckNode = s.isGlobal
              ? {
                  type: GLOBAL_SECTION,
                  props: {
                    id: `${GLOBAL_SECTION}-${Math.random().toString(36).slice(2, 10)}`,
                    sectionId: s.id,
                  },
                }
              : cloneWithIds(s.data)
            insertBlock(getPuck, node)
            toast.success(
              s.isGlobal ? `“${s.name}” added — it stays in sync everywhere` : `“${s.name}” added`,
            )
          }}
        />
      )}
    </div>
  )
}

function PresetList({ query, onInsert }: { query: string; onInsert: (node: PuckNode) => void }) {
  const groups = useMemo(() => {
    const out = new Map<string, typeof SECTION_PRESETS>()
    for (const p of SECTION_PRESETS) {
      const hay = `${p.name} ${p.description} ${p.category} ${categoryLabel(p.category)}`.toLowerCase()
      if (query && !hay.includes(query)) continue
      out.set(p.category, [...(out.get(p.category) ?? []), p])
    }
    return [...out.entries()]
  }, [query])
  if (!groups.length)
    return (
      <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted">
        No sections match.
      </p>
    )
  return (
    <div className="space-y-5">
      {groups.map(([category, presets]) => (
        <section key={category} className="space-y-2">
          <h3 className="text-[11px] font-semibold tracking-[0.08em] text-muted uppercase">
            {categoryLabel(category)}
          </h3>
          <ul className="space-y-1.5">
            {presets.map((p) => (
              <li key={p.key}>
                <button
                  type="button"
                  aria-label={`Insert ${p.name}`}
                  onClick={() => onInsert(instantiatePreset(p.node, Math.random().toString(36).slice(2, 8)))}
                  className="group flex min-h-14 w-full items-center gap-3 rounded-xl border bg-surface px-3 py-2.5 text-start transition-[border-color,background-color,transform] duration-150 hover:border-accent/50 hover:bg-accent-soft/40 active:scale-[0.99]"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-subtle text-muted transition-colors group-hover:bg-accent-soft group-hover:text-accent">
                    <LayoutTemplate className="size-4" strokeWidth={1.5} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm leading-snug font-medium">{p.name}</span>
                    <span className="line-clamp-2 text-xs leading-snug text-muted">{p.description}</span>
                  </span>
                  <Plus className="size-4 shrink-0 text-muted transition-colors group-hover:text-accent" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function SavedList({
  query,
  selected,
  onInsert,
}: {
  query: string
  selected: PuckNode | null
  onInsert: (s: SavedSection) => void
}) {
  const services = useEditorServices()!
  const list = services.sections.filter((s) => !query || s.name.toLowerCase().includes(query))
  return (
    <div className="space-y-4">
      {services.canDesign && <SaveSelected selected={selected} />}
      {list.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm leading-relaxed text-muted">
          {services.sections.length
            ? 'No saved sections match.'
            : 'Save a section you’ve styled to reuse it on any page.'}
        </p>
      ) : (
        <ul className="space-y-1.5">
          <AnimatePresence initial={false}>
            {list.map((s) => (
              <motion.li
                key={s.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0 }}
                transition={spring}
              >
                <SavedRow section={s} onInsert={() => onInsert(s)} />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </div>
  )
}

function SaveSelected({ selected }: { selected: PuckNode | null }) {
  const services = useEditorServices()!
  const getPuck = useGetPuck()
  const [name, setName] = useState('')
  const [isGlobal, setGlobal] = useState(false)
  const [pending, start] = useTransition()
  const { saving, setSaving } = services.library
  const label = selected ? (getPuck().config.components[selected.type]?.label ?? selected.type) : null
  const blocked = selected?.type === GLOBAL_SECTION

  if (!saving)
    return (
      <Button
        type="button"
        variant="secondary"
        className="h-11 w-full justify-start"
        disabled={!selected || blocked}
        onClick={() => setSaving(true)}
      >
        <BookmarkPlus />
        {selected
          ? blocked
            ? 'Already a global section'
            : `Save selected ${label}`
          : 'Select a section to save it'}
      </Button>
    )

  const save = () =>
    start(async () => {
      const node = getPuck().selectedItem as PuckNode | null
      if (!node) {
        toast.error('Select the section to save first')
        return
      }
      const r = await services.api.saveSection({ name, node, isGlobal })
      if (r?.ok) {
        const section = r.data?.section as SavedSection
        services.setSections((prev) => [section, ...prev])
        toast.success(r.message ?? 'Saved')
        setName('')
        setGlobal(false)
        setSaving(false)
        // A new global section replaces the selected block, so this page follows it too.
        if (section.isGlobal) {
          const api = getPuck()
          const selector = api.getSelectorForId(String(node.props.id))
          if (selector)
            api.dispatch({
              type: 'replace',
              destinationIndex: selector.index,
              destinationZone: selector.zone,
              data: { type: GLOBAL_SECTION, props: { id: String(node.props.id), sectionId: section.id } },
            })
        }
      } else if (r) toast.error(r.fieldErrors?.name ?? r.error)
    })

  return (
    <form
      className="anim-pop-in space-y-3 rounded-xl border bg-surface p-3.5"
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Save {label ?? 'section'}</p>
        <button
          type="button"
          aria-label="Cancel"
          onClick={() => setSaving(false)}
          className="grid size-8 place-items-center rounded-md text-muted hover:bg-subtle hover:text-fg"
        >
          <X className="size-4" />
        </button>
      </div>
      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-muted">Name</span>
        <input
          // biome-ignore lint/a11y/noAutofocus: the form opens on purpose to type a name
          autoFocus
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Ramadan offer band"
          className="h-10 w-full rounded-lg border bg-surface px-3 text-sm focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
        />
      </label>
      <label className="flex cursor-pointer items-start gap-2.5 rounded-lg bg-subtle/70 p-2.5">
        <input
          type="checkbox"
          checked={isGlobal}
          onChange={(e) => setGlobal(e.target.checked)}
          className="mt-0.5 size-4 accent-[var(--accent)]"
        />
        <span className="text-xs leading-relaxed">
          <span className="block font-medium text-fg">Global section</span>
          <span className="text-muted">Edit it once and every page that shows it updates.</span>
        </span>
      </label>
      <Button type="submit" className="w-full" pending={pending} disabled={!name.trim()}>
        Save section
      </Button>
    </form>
  )
}

function SavedRow({ section, onInsert }: { section: SavedSection; onInsert: () => void }) {
  const services = useEditorServices()!
  const getPuck = useGetPuck()
  const [mode, setMode] = useState<'view' | 'rename' | 'delete'>('view')
  const [name, setName] = useState(section.name)
  const [pending, start] = useTransition()

  const rename = () =>
    start(async () => {
      const r = await services.api.renameSection(section.id, name)
      if (r?.ok) {
        const next = r.data?.section as SavedSection
        services.setSections((prev) => prev.map((s) => (s.id === next.id ? next : s)))
        setMode('view')
        toast.success('Renamed')
      } else if (r) toast.error(r.fieldErrors?.name ?? r.error)
    })
  const remove = () =>
    start(async () => {
      const r = await services.api.deleteSection(section.id)
      if (r?.ok) {
        services.setSections((prev) => prev.filter((s) => s.id !== section.id))
        toast.success(r.message ?? 'Removed')
      } else if (r) {
        toast.error(r.error)
        setMode('view')
      }
    })

  if (mode === 'rename')
    return (
      <form
        className="flex items-center gap-1.5 rounded-xl border bg-surface p-2"
        onSubmit={(e) => {
          e.preventDefault()
          rename()
        }}
      >
        <input
          aria-label="Section name"
          // biome-ignore lint/a11y/noAutofocus: inline rename
          autoFocus
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          className="h-9 min-w-0 flex-1 rounded-lg border bg-surface px-2.5 text-sm focus:border-accent focus:outline-none"
        />
        <Button type="submit" size="icon" className="size-9" aria-label="Save name" pending={pending}>
          {!pending && <Check />}
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-9"
          aria-label="Cancel"
          onClick={() => setMode('view')}
        >
          <X />
        </Button>
      </form>
    )

  return (
    <div className="group rounded-xl border bg-surface p-3 transition-colors hover:border-fg/15">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'grid size-9 shrink-0 place-items-center rounded-lg',
            section.isGlobal ? 'bg-accent-soft text-accent' : 'bg-subtle text-muted',
          )}
        >
          {section.isGlobal ? (
            <Globe2 className="size-4" strokeWidth={1.5} />
          ) : (
            <BookmarkPlus className="size-4" strokeWidth={1.5} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-snug font-medium break-words">{section.name}</p>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
            {section.isGlobal ? <Badge tone="accent">Global</Badge> : <span>Copy</span>}
            <span className="truncate">
              {getPuck().config.components[section.data.type]?.label ?? section.data.type}
            </span>
          </p>
        </div>
      </div>
      {mode === 'delete' ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
          <span className="min-w-0 break-words">Delete “{section.name}”?</span>
          <span className="flex gap-1">
            <Button type="button" size="sm" variant="danger" pending={pending} onClick={remove}>
              Delete
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setMode('view')}>
              Keep
            </Button>
          </span>
        </div>
      ) : (
        <div className="mt-2.5 flex items-center gap-1 border-t pt-2.5">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={onInsert}
            aria-label={`Insert ${section.name}`}
          >
            <Plus /> Insert
          </Button>
          {section.isGlobal && (
            <Button type="button" size="sm" variant="ghost" onClick={() => services.editGlobal(section.id)}>
              <PenLine /> Edit
            </Button>
          )}
          <span className="ms-auto flex gap-0.5">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8"
              aria-label={`Rename ${section.name}`}
              title="Rename"
              onClick={() => setMode('rename')}
            >
              <TextCursorInput />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8"
              aria-label={`Delete ${section.name}`}
              title="Delete"
              onClick={() => setMode('delete')}
            >
              <Trash2 />
            </Button>
          </span>
        </div>
      )}
    </div>
  )
}
