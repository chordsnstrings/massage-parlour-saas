'use client'
import { createUsePuck, type Data, type Field, useGetPuck } from '@puckeditor/core'
import {
  type PreflightContext,
  type PreflightIssue,
  preflight,
  removeAt,
  setAt,
} from '@spa/services/site-kit'
import { AlertTriangle, Check, CircleAlert, ExternalLink, Languages, Rocket } from 'lucide-react'
import { useMemo, useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetClose } from '@/components/ui/sheet'
import { toast } from '@/components/ui/toast'
import type { ActionResult } from '@/lib/action'
import { cn } from '@/lib/utils'
import { useEditorServices } from './context'
import { scrollToBlock } from './frame-styles'

const usePuckStore = createUsePuck()

type Props = {
  pageTitle: string
  liveHref: string
  context: Omit<PreflightContext, 'globalIds'>
  publish: (data: Data) => Promise<ActionResult>
  onPublished: (data: Data) => void
}

/**
 * Publish confirmation with preflight (PLAN §11.5): errors (images not on https) block, warnings don't. Every
 * issue has "Go to block"; safe one-click fixes apply in place (undoable), missing Arabic offers AI translation.
 */
export function PublishSheet({ pageTitle, liveHref, context, publish, onPublished }: Props) {
  const [open, setOpen] = useState(false)
  const [publishing, startPublish] = useTransition()
  const [fixing, startFix] = useTransition()
  const services = useEditorServices()
  const getPuck = useGetPuck()
  const data = usePuckStore((s) => s.appState.data)
  const config = usePuckStore((s) => s.config)
  const globalIds = useMemo(
    () => (services ? new Set(services.sections.filter((s) => s.isGlobal).map((s) => s.id)) : undefined),
    [services],
  )
  const issues = useMemo(
    () => (open ? preflight(data, { ...context, globalIds }) : []),
    [open, data, context, globalIds],
  )
  const errors = issues.filter((i) => i.severity === 'error')
  const warnings = issues.length - errors.length
  const arabic = issues.filter((i) => i.fix?.kind === 'translate')
  const aiReady = !!services?.aiReady

  const where = (i: PreflightIssue) => {
    if (i.blockId === null) return 'Page settings'
    const c = config.components[i.blockType]
    const f = i.field ? (c?.fields?.[i.field] as Field | undefined)?.label : undefined
    return [c?.label ?? i.blockType, f].filter(Boolean).join(' · ')
  }

  const goTo = (i: PreflightIssue) => {
    const api = getPuck()
    const selector = i.blockId ? api.getSelectorForId(i.blockId) : undefined
    api.dispatch({ type: 'setUi', ui: { itemSelector: selector ?? null, rightSideBarVisible: true } })
    setOpen(false)
    if (i.blockId) {
      const id = i.blockId
      setTimeout(() => {
        scrollToBlock(id)
      }, 200)
    }
  }

  const setData = (next: Data) => getPuck().dispatch({ type: 'setData', data: next })

  const translate = (targets: PreflightIssue[]) =>
    startFix(async () => {
      if (!services) return
      const texts = targets.map((t) => (t.fix?.kind === 'translate' ? t.fix.text : ''))
      const r = await services.api.translate(texts)
      if (!r?.ok) {
        if (r) toast.error(r.error)
        return
      }
      const items = r.data?.items as string[]
      let next = getPuck().appState.data
      targets.forEach((t, n) => {
        next = setAt(next, [...t.path, 'ar'], items[n])
      })
      setData(next)
      toast.success(targets.length === 1 ? 'Arabic added' : `Arabic added to ${targets.length} fields`)
    })

  const fix = (i: PreflightIssue) => {
    if (!i.fix) return
    if (i.fix.kind === 'translate') return translate([i])
    const current = getPuck().appState.data
    setData(i.fix.kind === 'remove' ? removeAt(current, i.path) : setAt(current, i.path, i.fix.value))
    toast.success('Fixed — undo is one click away')
  }

  const run = () =>
    startPublish(async () => {
      const current = getPuck().appState.data
      const r = await publish(current)
      if (r?.ok) {
        onPublished(current)
        setOpen(false)
        toast.success(r.message ?? 'Published')
      } else if (r) toast.error(r.error)
    })

  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={`Publish ${pageTitle}?`}
      description="Visitors will see this version straight away. You can keep editing afterwards."
      trigger={
        <Button className="px-3 sm:px-4">
          <Rocket />
          <span className="hidden sm:inline">Publish</span>
        </Button>
      }
    >
      <section aria-label="Preflight checks" className="mb-6">
        {issues.length === 0 ? (
          <ul className="space-y-2 text-sm text-muted">
            <li className="flex gap-2 font-medium text-fg">
              <Check className="mt-0.5 size-4 shrink-0 text-success" /> All checks passed
            </li>
            <li className="flex gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-success" /> Prices, team and hours stay live from
              your dashboard.
            </li>
            <li className="flex gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-success" /> Arabic visitors see the Arabic text
              where you've added it.
            </li>
          </ul>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm">
                <span className="font-medium">Preflight</span>
                <span className="text-muted">
                  {' · '}
                  {errors.length > 0 && (
                    <span className="text-danger">
                      {errors.length} {errors.length === 1 ? 'error' : 'errors'}
                      {warnings > 0 && ' · '}
                    </span>
                  )}
                  {warnings > 0 && `${warnings} ${warnings === 1 ? 'warning' : 'warnings'}`}
                </span>
              </p>
              {arabic.length > 1 && aiReady && (
                <Button size="sm" variant="secondary" pending={fixing} onClick={() => translate(arabic)}>
                  {!fixing && <Languages />} Translate all with AI ({arabic.length})
                </Button>
              )}
            </div>
            <ul className="max-h-[min(48dvh,420px)] divide-y overflow-y-auto overscroll-contain rounded-xl border px-3.5">
              {issues.map((i) => (
                <li key={i.id} className="flex gap-3 py-3">
                  {i.severity === 'error' ? (
                    <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-label="Error" />
                  ) : (
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-label="Warning" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug break-words">{i.message}</p>
                    <p className="mt-0.5 text-xs text-muted">{where(i)}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Button size="sm" variant="secondary" onClick={() => goTo(i)}>
                        Go to block
                      </Button>
                      {i.fix && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={fixing || (i.fix.kind === 'translate' && !aiReady)}
                          title={
                            i.fix.kind === 'translate' && !aiReady
                              ? 'AI translation isn’t set up yet — add the Arabic in the AR view'
                              : undefined
                          }
                          onClick={() => fix(i)}
                        >
                          {i.fix.label}
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <p className={cn('mt-3 text-xs', errors.length ? 'text-danger' : 'text-muted')}>
              {errors.length
                ? 'Fix the errors above to publish — images must be served over https.'
                : 'Warnings don’t block publishing.'}
              {arabic.length > 0 &&
                !aiReady &&
                ' AI translation isn’t set up yet — add Arabic in the AR view.'}
            </p>
          </>
        )}
      </section>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <SheetClose asChild>
          <Button variant="secondary">Cancel</Button>
        </SheetClose>
        <Button onClick={run} pending={publishing} disabled={errors.length > 0}>
          Publish now
        </Button>
      </div>
      <a
        href={liveHref}
        target="_blank"
        rel="noreferrer"
        className="mt-4 inline-flex min-h-10 items-center gap-1.5 text-sm text-muted hover:text-fg"
      >
        Open live page <ExternalLink className="size-3.5" />
      </a>
    </Sheet>
  )
}
