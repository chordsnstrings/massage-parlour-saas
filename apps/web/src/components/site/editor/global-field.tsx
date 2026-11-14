'use client'
import { type ComponentData, FieldLabel, useGetPuck } from '@puckeditor/core'
import { Globe2, PenLine, Unlink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { cloneWithIds, useEditorServices } from './context'

/**
 * Field panel for a GlobalSection block: which global section it shows, "Edit global section" (modal editor,
 * updates every page) and "Detach" (replace with an independent copy).
 */
export function GlobalSectionField({
  field,
  id,
  value,
  onChange,
  readOnly,
}: {
  field: { label?: string }
  id: string
  value: string | undefined
  onChange: (value: string) => void
  readOnly?: boolean
}) {
  const services = useEditorServices()
  const getPuck = useGetPuck()
  const globals = services?.sections.filter((s) => s.isGlobal) ?? []
  const section = globals.find((s) => s.id === value)
  const canEdit = !!services?.canDesign && !readOnly

  const detach = () => {
    const { selectedItem, getSelectorForId, dispatch } = getPuck()
    const blockId = selectedItem?.props.id
    const selector = blockId ? getSelectorForId(String(blockId)) : undefined
    if (!section || !selector) return
    dispatch({
      type: 'replace',
      destinationIndex: selector.index,
      destinationZone: selector.zone,
      data: cloneWithIds(section.data) as ComponentData,
    })
    toast.success('Detached — this copy no longer follows the global section')
  }

  return (
    <FieldLabel label={field.label ?? 'Global section'} el="div" readOnly={readOnly}>
      <div className="space-y-3 rounded-xl border bg-subtle/60 p-3.5">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
            <Globe2 className="size-3.5" strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{section?.name ?? 'Deleted section'}</p>
            <p className="text-xs leading-relaxed text-muted">
              Shared across pages — edit it once and every page updates.
            </p>
          </div>
        </div>
        {globals.length > 1 && canEdit && (
          <select
            id={id}
            aria-label="Show another global section"
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value)}
            className="min-h-10 w-full rounded-lg border bg-surface px-3 text-sm"
          >
            {globals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        )}
        {canEdit && section && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => services?.editGlobal(section.id)}>
              <PenLine /> Edit global section
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={detach}>
              <Unlink /> Detach copy
            </Button>
          </div>
        )}
      </div>
    </FieldLabel>
  )
}
