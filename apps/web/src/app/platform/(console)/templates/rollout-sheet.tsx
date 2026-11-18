'use client'
// R28 P5 (owner D4 + D5): "Roll out" of an uploaded HTML template's new version — the sign-off. The sheet lists the
// spas it switches (live at once, their edits carried, undo on each spa's page) and the ones it leaves, then shows
// what happened.
import { Send, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { FormSheet } from '@/components/ui/form-sheet'
import { Sheet } from '@/components/ui/sheet'
import { toast } from '@/components/ui/toast'
import {
  discardTemplateVersionAction,
  type RolloutPlan,
  rolloutPlanAction,
  rolloutTemplateVersionAction,
} from './actions'

type Result = {
  version: number
  switched: { name: string; slug: string; carried: number; dropped: number }[]
  skipped: { name: string; reason: string }[]
  more: boolean
  /** Spas this click could not switch: the next click tries the others first. */
  later?: string[]
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export function RolloutSheet({ id, name, label }: { id: string; name: string; label: string }) {
  const router = useRouter()
  const [plan, setPlan] = useState<RolloutPlan | { error: string } | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [later, setLater] = useState<string[]>([])
  const load = () => {
    setPlan(null)
    rolloutPlanAction(id, later).then(setPlan, () =>
      setPlan({ error: 'Could not load the spas. Try again.' }),
    )
  }
  const ready = plan && !('error' in plan) ? plan : null
  return (
    <>
      <FormSheet
        title={`Roll out · ${name}`}
        className="md:max-w-2xl"
        trigger={
          <Button variant="secondary" size="sm" className="h-11" onClick={load}>
            <Send /> {label}
          </Button>
        }
        action={rolloutTemplateVersionAction.bind(null, id)}
        submitLabel={label}
        onSuccess={(r) => {
          const data = (r.data as Result | undefined) ?? null
          setResult(data)
          if (data?.later?.length) setLater((all) => [...new Set([...all, ...data.later!])])
          router.refresh()
        }}
      >
        {!plan ? (
          <p className="text-sm text-muted">Finding the spas on older versions…</p>
        ) : 'error' in plan ? (
          <p role="alert" className="text-sm text-danger">
            {plan.error}
          </p>
        ) : (
          <div className="space-y-4 text-sm">
            <input type="hidden" name="sha256" value={plan.sha256} />
            {later.map((t) => (
              <input key={t} type="hidden" name="later" value={t} />
            ))}
            <p className="text-muted">
              Roll out = sign-off: version {plan.version} goes live at once for these spas (their edits are
              carried; each spa can undo it on its page). New spas get version {plan.version} from now on.
              Write texts then drafts English + Arabic texts for each switched spa (drafts only).
            </p>
            {plan.textsSkip && (
              <p className="rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-warning">
                Write texts will be skipped: {plan.textsSkip}.
              </p>
            )}
            {plan.look.length > 0 && (
              <section className="space-y-1.5 rounded-xl border p-3" data-testid="rollout-look">
                <h3 className="font-medium">Phone fixes and picture adjustments</h3>
                <ul className="list-disc space-y-0.5 ps-5 text-[13px] text-muted">
                  {plan.look.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              </section>
            )}
            <section className="space-y-2">
              <h3 className="font-medium">
                {plan.spas.length ? `Switched now: ${plural(plan.spas.length, 'spa')}` : 'No spa to switch'}
              </h3>
              {plan.spas.length > 0 && (
                <ul aria-label="Spas to switch" className="divide-y rounded-xl border">
                  {plan.spas.map((s) => (
                    <li
                      key={s.slug}
                      className="flex flex-wrap items-baseline justify-between gap-x-3 px-3 py-2"
                    >
                      <span className="font-medium">{s.name}</span>
                      <span className="text-[13px] text-muted">
                        {[
                          s.pages > 1 ? `${s.pages} pages` : null,
                          s.own ? 'made for this spa' : null,
                          `${plural(s.kept, 'edit')} kept · ${s.notKept} not kept`,
                          s.keepsPhoneFixes ? 'keeps its phone fixes' : null,
                          s.keepsAdjustments
                            ? `keeps ${plural(s.keepsAdjustments, 'picture adjustment')}`
                            : null,
                          s.hasDraft ? 'has a draft' : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {plan.more && <p className="text-[13px] text-muted">More spas follow: run Roll out again.</p>}
            </section>
            {plan.skipped.length > 0 && (
              <section className="space-y-2">
                <h3 className="font-medium">Left as they are</h3>
                <ul aria-label="Not switched" className="divide-y rounded-xl border">
                  {plan.skipped.map((s) => (
                    <li key={`${s.slug}:${s.reason}`} className="px-3 py-2">
                      <span className="font-medium">{s.name}</span>{' '}
                      <span className="text-[13px] text-muted">— {s.reason}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
        {!ready && <input type="hidden" name="sha256" value="" />}
      </FormSheet>
      <Sheet
        open={result !== null}
        onOpenChange={(open) => {
          if (!open) setResult(null)
        }}
        title={result ? `Version ${result.version} rolled out` : 'Rolled out'}
      >
        {result && (
          <div className="space-y-4 text-sm">
            <section className="space-y-2">
              <h3 className="font-medium">Live now: {plural(result.switched.length, 'spa')}</h3>
              {result.switched.length > 0 && (
                <ul aria-label="Switched spas" className="divide-y rounded-xl border">
                  {result.switched.map((s) => (
                    <li key={s.slug} className="flex flex-wrap justify-between gap-x-3 px-3 py-2">
                      <span className="font-medium">{s.name}</span>
                      <span className="text-[13px] text-muted">
                        {plural(s.carried, 'edit')} kept · {s.dropped} not kept
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {result.skipped.length > 0 && (
              <section className="space-y-2">
                <h3 className="font-medium">Not switched</h3>
                <ul aria-label="Skipped spas" className="divide-y rounded-xl border">
                  {result.skipped.map((s) => (
                    <li key={`${s.name}:${s.reason}`} className="px-3 py-2">
                      <span className="font-medium">{s.name}</span>{' '}
                      <span className="text-[13px] text-muted">— {s.reason}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {result.more && <p className="text-muted">Run again for the rest.</p>}
          </div>
        )}
      </Sheet>
    </>
  )
}

/** Drops the version waiting for sign-off. */
export function DiscardVersionButton({ id, version }: { id: string; version: number }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-11"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await discardTemplateVersionAction(id)
          if (r?.ok) {
            toast.success(r.message ?? 'Discarded')
            router.refresh()
          } else toast.error(r?.error ?? 'Could not discard')
        })
      }
    >
      <Trash2 /> Discard version {version}
    </Button>
  )
}
