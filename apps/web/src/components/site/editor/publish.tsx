'use client'
import { createUsePuck, type Data, type Field, useGetPuck } from '@puckeditor/core'
import { type HtmlDesignContent, htmlContentLeftovers, htmlContentSlots, htmlDesignDocOf } from '@spa/core'
import {
  type PreflightContext,
  type PreflightIssue,
  preflight,
  removeAt,
  setAt,
} from '@spa/services/site-kit'
import { AlertTriangle, Check, CircleAlert, ExternalLink, Languages, Rocket } from 'lucide-react'
import { useEffect, useMemo, useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetClose } from '@/components/ui/sheet'
import { toast } from '@/components/ui/toast'
import type { ActionResult } from '@/lib/action'
import { cn } from '@/lib/utils'
import { useEditorContext } from '../fields'
import { designContract, designKey } from '../html-crm'
import { TRANSLATE_BATCH } from './colors'
import { useEditorServices } from './context'
import { scrollToBlock } from './frame-styles'
import { designListing, leftoverLabel, REASONS } from './html-content-labels'

const usePuckStore = createUsePuck()

type Props = {
  pageTitle: string
  liveHref: string
  context: Omit<PreflightContext, 'globalIds'>
  publish: (data: Data) => Promise<ActionResult | undefined>
  onPublished: (data: Data) => void
  /** Unpublished site settings this publish also takes live (draft theme, this page's rename). */
  alsoPublishes?: string[]
  /** Server notes for the other live pages (contrast under the draft theme), loaded when the sheet opens. */
  loadNotes?: () => Promise<ActionResult>
}

/**
 * Publish confirmation with preflight (PLAN §11.5): errors (images not on https) block, warnings don't. Every
 * issue has "Go to block"; safe one-click fixes apply in place (undoable), missing Arabic offers AI translation.
 * R28 P4: an HTML design page also lists its Website content leftovers (never blocking, never sent to the server).
 */
export function PublishSheet({
  pageTitle,
  liveHref,
  context,
  publish,
  onPublished,
  alsoPublishes = [],
  loadNotes,
}: Props) {
  const [open, setOpen] = useState(false)
  const [themeWarnings, setThemeWarnings] = useState<string[]>([])
  useEffect(() => {
    if (!open || !loadNotes) {
      setThemeWarnings([])
      return
    }
    let live = true
    loadNotes().then((r) => {
      if (live && r?.ok) setThemeWarnings((r.data?.themeWarnings as string[] | undefined) ?? [])
    })
    return () => {
      live = false
    }
  }, [open, loadNotes])
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
  const { html } = useEditorContext()
  // What the page's HTML design still shows from the design's own spa, as the Website content field lists it.
  const content = useMemo(() => {
    if (!open) return null
    const index = data.content.findIndex((b) => b.type === 'HtmlDesign')
    const props = index >= 0 ? (data.content[index]!.props as Record<string, unknown>) : null
    const ref = props ? htmlDesignDocOf(props) : null
    const source = (typeof props?.html === 'string' && props.html) || (ref ? html?.docs[ref.file] : '') || ''
    if (!props || !source) return null
    const key = designKey(ref)
    const designData = designContract(source, key)?.found?.literal?.data
    const page = designListing(source, key)
    const all = htmlContentLeftovers(designData, props.content as HtmlDesignContent | undefined, {
      spaName: html?.spaName ?? '',
      city: html?.city ?? '',
      arabic: true,
      page,
    })
    const ctx = { slots: htmlContentSlots(designData), ...page }
    const first = all.slice(0, 5).map((l) => ({ ...l, label: leftoverLabel(l.path, ctx) }))
    return { index, total: all.length, first }
  }, [open, data, html])

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

  const openContent = (index: number) => {
    getPuck().dispatch({
      type: 'setUi',
      ui: { itemSelector: { index, zone: 'root:default-zone' }, rightSideBarVisible: true },
    })
    setOpen(false)
  }

  const setData = (next: Data) => getPuck().dispatch({ type: 'setData', data: next })

  /** Translates in batches the server accepts, applying each batch as it arrives. */
  const translate = (targets: PreflightIssue[]) =>
    startFix(async () => {
      if (!services) return
      const batches: { issue: PreflightIssue; text: string }[][] = [[]]
      let chars = 0
      for (const issue of targets) {
        const text = issue.fix?.kind === 'translate' ? issue.fix.text : ''
        const last = batches[batches.length - 1]!
        if (
          last.length &&
          (last.length >= TRANSLATE_BATCH.items || chars + text.length > TRANSLATE_BATCH.chars)
        ) {
          batches.push([])
          chars = 0
        }
        batches[batches.length - 1]!.push({ issue, text })
        chars += text.length
      }
      let done = 0
      for (const batch of batches) {
        const r = await services.api.translate(batch.map((b) => b.text))
        if (!r?.ok) {
          if (r) toast.error(done ? `Arabic added to ${done} fields, then: ${r.error}` : r.error)
          return
        }
        const items = r.data?.items as string[]
        let next = getPuck().appState.data
        batch.forEach((b, n) => {
          next = setAt(next, [...b.issue.path, 'ar'], items[n])
        })
        setData(next)
        done += batch.length
      }
      toast.success(done === 1 ? 'Arabic added' : `Arabic added to ${done} fields`)
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
      {alsoPublishes.length > 0 && (
        <section aria-label="Also goes live" className="mb-4 rounded-xl border bg-subtle/50 p-3 text-sm">
          <p className="font-medium">Also goes live with this publish: {alsoPublishes.join(' · ')}</p>
          {themeWarnings.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-muted">
              {themeWarnings.map((w) => (
                <li key={w} className="flex gap-2">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-label="Warning" />
                  {w}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {content && content.total > 0 && (
        <section
          aria-label="Website content checks"
          className="mb-4 rounded-xl border bg-subtle/50 p-3 text-sm"
        >
          <p className="font-medium">Website content: {content.total} still from the design</p>
          <ul className="mt-2 space-y-1 text-xs text-muted">
            {content.first.map((l) => (
              <li key={`${l.path}:${l.reason}`} className="flex gap-2">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-label="Warning" />
                <span className="min-w-0 break-words">
                  <b className="font-medium text-fg">{l.label}</b>: {REASONS[l.reason]}
                </span>
              </li>
            ))}
            {content.total > 5 && <li className="ps-5.5">and {content.total - 5} more</li>}
          </ul>
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted">These don’t block publishing.</p>
            <Button size="sm" variant="secondary" onClick={() => openContent(content.index)}>
              Open Website content
            </Button>
          </div>
        </section>
      )}
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
