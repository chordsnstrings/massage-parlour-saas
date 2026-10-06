'use client'
import { Paintbrush, Rocket } from 'lucide-react'
import { useOptimistic, useTransition } from 'react'
import type { SiteTheme } from '@/components/site/theme'
import { Button } from '@/components/ui/button'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { FormSheet } from '@/components/ui/form-sheet'
import { Checkbox, Input, Label, Select } from '@/components/ui/input'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { applyTemplateAction, publishSiteAction, saveThemeAction, setPageVisibleAction } from './actions'

/** First template pick: creates the site with the template's starter pages. */
export function UseTemplateButton({
  slug,
  template,
  name,
}: {
  slug: string
  template: string
  name: string
}) {
  return (
    <ActionForm action={applyTemplateAction.bind(null, slug)}>
      <input type="hidden" name="template" value={template} />
      <SubmitButton className="w-full" aria-label={`Use ${name}`}>
        Use {name}
      </SubmitButton>
    </ActionForm>
  )
}

/** Switching template later: tokens always change; content only when asked. */
export function ApplyTemplateSheet({
  slug,
  template,
  name,
  hasLiveContent,
}: {
  slug: string
  template: string
  name: string
  hasLiveContent: boolean
}) {
  return (
    <FormSheet
      title={`Apply ${name}`}
      description="Colours, fonts, shapes and motion change right away. Your words and images stay."
      trigger={
        <Button variant="secondary" className="w-full">
          Apply
        </Button>
      }
      action={applyTemplateAction.bind(null, slug)}
      submitLabel="Apply template"
    >
      <input type="hidden" name="template" value={template} />
      <label className="flex items-start gap-3 rounded-xl border p-4 text-sm">
        <Checkbox name="replaceContent" defaultChecked={!hasLiveContent} className="mt-0.5" />
        <span className="space-y-1">
          <span className="block font-medium">Also start from its sample pages</span>
          <span className="block text-muted">
            Replaces Home, Treatments and Contact with this template's layout as drafts. Nothing changes on
            your live site until you publish.
          </span>
        </span>
      </label>
    </FormSheet>
  )
}

export function PublishSiteSheet({ slug, pending }: { slug: string; pending: number }) {
  return (
    <FormSheet
      title="Publish your site?"
      description={`${pending} ${pending === 1 ? 'page has' : 'pages have'} unpublished changes. Visitors will see them immediately.`}
      trigger={
        <Button>
          <Rocket /> Publish site
        </Button>
      }
      action={publishSiteAction.bind(null, slug)}
      submitLabel="Publish now"
    >
      <p className="text-sm text-muted">
        Prices, team and opening hours always show live data from your dashboard.
      </p>
    </FormSheet>
  )
}

/** Show / hide a page in the site navigation (home is always visible). */
export function VisibilityToggle({
  slug,
  pageId,
  visible,
  disabled,
  label,
}: {
  slug: string
  pageId: string
  visible: boolean
  disabled?: boolean
  label: string
}) {
  const [pending, start] = useTransition()
  const [optimistic, setOptimistic] = useOptimistic(visible)
  return (
    <button
      type="button"
      role="switch"
      aria-checked={optimistic}
      aria-label={`${label} visible`}
      disabled={disabled || pending}
      onClick={() =>
        start(async () => {
          setOptimistic(!optimistic)
          const r = await setPageVisibleAction(slug, pageId, !optimistic)
          if (r && !r.ok) toast.error(r.error)
        })
      }
      className="group inline-flex min-h-11 items-center gap-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span
        className={cn(
          'relative h-6 w-10 rounded-full transition-colors duration-200',
          optimistic ? 'bg-accent' : 'bg-border',
        )}
      >
        <span
          className={cn(
            'absolute top-1 left-1 size-4 rounded-full bg-white shadow-sm transition-transform duration-200 ease-[var(--ease-calm)]',
            optimistic && 'translate-x-4',
          )}
        />
      </span>
      <span className="text-muted">{optimistic ? 'Visible' : 'Hidden'}</span>
    </button>
  )
}

export function ThemeSheet({ slug, theme }: { slug: string; theme: SiteTheme }) {
  return (
    <FormSheet
      title="Theme"
      description="Fine-tune the template. Changes are live on your site right away."
      trigger={
        <Button variant="secondary" className="w-full sm:w-auto">
          <Paintbrush /> Theme
        </Button>
      }
      action={saveThemeAction.bind(null, slug)}
      submitLabel="Save theme"
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Accent colour" name="accent">
          <span className="flex items-center gap-2">
            <Input
              id="accent"
              name="accent"
              type="color"
              defaultValue={theme.accent}
              className="h-11 w-16 p-1"
            />
            <span className="text-xs text-muted">Buttons, links, highlights</span>
          </span>
        </Field>
        <Field label="Text on accent" name="accentFg">
          <span className="flex items-center gap-2">
            <Input
              id="accentFg"
              name="accentFg"
              type="color"
              defaultValue={theme.accentFg}
              className="h-11 w-16 p-1"
            />
            <span className="text-xs text-muted">Keep it readable</span>
          </span>
        </Field>
        <Field label="Headings" name="headingFont">
          <Select id="headingFont" name="headingFont" defaultValue={theme.headingFont}>
            <option value="serif">Serif — classic, calm</option>
            <option value="sans">Sans — clean, modern</option>
          </Select>
        </Field>
        <Field label="Corners" name="radius">
          <Select id="radius" name="radius" defaultValue={theme.radius}>
            <option value="none">Square</option>
            <option value="soft">Soft</option>
            <option value="round">Round</option>
          </Select>
        </Field>
        <Field label="Buttons" name="buttonShape">
          <Select id="buttonShape" name="buttonShape" defaultValue={theme.buttonShape}>
            <option value="square">Square</option>
            <option value="rounded">Rounded</option>
            <option value="pill">Pill</option>
          </Select>
        </Field>
        <Field label="Spacing" name="density">
          <Select id="density" name="density" defaultValue={theme.density}>
            <option value="compact">Compact</option>
            <option value="comfortable">Comfortable</option>
            <option value="airy">Airy</option>
          </Select>
        </Field>
        <div className="space-y-2 sm:col-span-2">
          <Label>Motion</Label>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Motion">
            {(['none', 'subtle', 'expressive'] as const).map((m) => (
              <label
                key={m}
                className="flex min-h-11 cursor-pointer items-center justify-center rounded-lg border text-sm capitalize transition-colors has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:text-accent"
              >
                <input
                  type="radio"
                  name="motion"
                  value={m}
                  defaultChecked={theme.motion === m}
                  className="sr-only"
                />
                {m}
              </label>
            ))}
          </div>
          <p className="text-[13px] text-muted">
            Visitors who prefer reduced motion always get gentle fades.
          </p>
        </div>
      </div>
    </FormSheet>
  )
}
