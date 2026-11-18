'use client'
import type { PuckNode } from '@spa/services/site-kit'
import { createContext, useContext } from 'react'
import type { ActionResult } from '@/lib/action'

/** A saved section as the editor sees it (`saved_sections` row, data = one Puck block with its children). */
export type SavedSection = {
  id: string
  name: string
  isGlobal: boolean
  data: PuckNode
  updatedAt: string
}

/**
 * Tenant-editor services shared by the library panel, the GlobalSection field and the modal section editor.
 * Absent outside the tenant editor (e.g. the template studio), where those features simply don't show.
 */
export type EditorServices = {
  slug: string
  canDesign: boolean
  /** ModelArk is configured (AI translate / copy assists work). */
  aiReady: boolean
  sections: SavedSection[]
  setSections: (update: (prev: SavedSection[]) => SavedSection[]) => void
  /** Opens the modal editor for a global section. */
  editGlobal: (id: string) => void
  /** Library panel state, so the block action bar can open "Save section" there. */
  library: {
    tab: LibraryTab
    setTab: (tab: LibraryTab) => void
    saving: boolean
    setSaving: (v: boolean) => void
  }
  api: {
    saveSection: (input: { name: string; node: PuckNode; isGlobal: boolean }) => Promise<ActionResult>
    renameSection: (id: string, name: string) => Promise<ActionResult>
    deleteSection: (id: string) => Promise<ActionResult>
    updateGlobal: (id: string, node: PuckNode) => Promise<ActionResult>
    /** English → Arabic, in order. */
    translate: (texts: string[]) => Promise<ActionResult>
  }
}
export type LibraryTab = 'sections' | 'saved'

export const EditorServicesContext = createContext<EditorServices | null>(null)
export const useEditorServices = () => useContext(EditorServicesContext)

/** Fresh ids for a block and every nested slot child, so inserted copies never clash. */
export function cloneWithIds(node: PuckNode, prefix = Math.random().toString(36).slice(2, 8)): PuckNode {
  let n = 0
  const walk = (x: PuckNode): PuckNode => {
    const props: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(x.props)) {
      props[k] =
        Array.isArray(v) &&
        v.length > 0 &&
        v.every((c) => c && typeof c === 'object' && 'type' in c && 'props' in c)
          ? (v as PuckNode[]).map(walk)
          : structuredClone(v)
    }
    return { type: x.type, props: { ...props, id: `${x.type}-${prefix}${++n}` } }
  }
  return walk(node)
}
