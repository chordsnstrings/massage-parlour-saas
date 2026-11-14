'use client'
// Installable spa dashboard (docs/PLAN.md §18.6): worker registration, the user-menu entry, the iOS steps sheet and
// the owner/manager tip on the dashboard home.
import { Download, Share, SquarePlus, X } from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/sheet'
import { useT } from '@/i18n/client'
import { OFFLINE_CACHE, offlineKey, registerWorker } from '@/lib/sw'
import { setStepsOpen, startInstall, useInstallMode, useStepsOpen } from './install'

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' }[c]};`)

/**
 * Mounted once by the spa dashboard layout: registers the service worker (push + installable app), leaves it an
 * offline page in the viewer's language, and hosts the iOS install steps.
 */
export function PwaSetup({ app }: { app: string }) {
  const t = useT()
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    registerWorker().catch(() => {
      // Unsupported or blocked (private mode, some embedded browsers): the dashboard works without it.
    })
    if (!('caches' in window)) return
    const title = esc(t('pwa.offline.title'))
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#f6f6f9;color:#0b0b0f;font:15px/1.5 system-ui,sans-serif;text-align:center;padding:24px}h1{font-size:18px;margin:0 0 6px}p{margin:0 0 18px;color:#5a5a66}button{font:inherit;font-weight:600;border:0;border-radius:12px;padding:10px 18px;background:#0f6b4b;color:#fff}</style></head><body><main><h1>${title}</h1><p>${esc(t('pwa.offline.body'))}</p><button onclick="location.reload()">${esc(t('pwa.offline.retry'))}</button></main></body></html>`
    caches
      .open(OFFLINE_CACHE)
      .then((c) =>
        c.put(offlineKey(), new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })),
      )
      .catch(() => {
        // Storage full or blocked: the worker falls back to its built-in bilingual page.
      })
  }, [t])
  return <IosSteps app={app} />
}

/** Share → Add to Home Screen, for iOS (no install prompt there). */
function IosSteps({ app }: { app: string }) {
  const t = useT()
  const open = useStepsOpen()
  const steps = [
    { icon: Share, text: t('pwa.ios.share') },
    { icon: SquarePlus, text: t('pwa.ios.add') },
    { icon: Download, text: t('pwa.ios.confirm', { app }) },
  ]
  return (
    <Sheet
      open={open}
      onOpenChange={setStepsOpen}
      title={t('pwa.ios.title', { app })}
      description={t('pwa.ios.description', { app })}
    >
      <ol className="space-y-3">
        {steps.map((s, i) => (
          <li key={s.text} className="flex items-start gap-3 text-sm">
            <span
              className="grid size-8 shrink-0 place-items-center rounded-full bg-subtle text-fg"
              aria-hidden
            >
              <s.icon className="size-4" strokeWidth={1.7} />
            </span>
            <span className="pt-1.5">
              <b className="me-1 font-semibold">{i + 1}.</b>
              {s.text}
            </span>
          </li>
        ))}
      </ol>
      <Button className="mt-5 w-full" onClick={() => setStepsOpen(false)}>
        {t('pwa.ios.done')}
      </Button>
    </Sheet>
  )
}

/** "Install app" in the spa user menu; hidden where the browser can't install or it already runs installed. */
export function InstallMenuItem() {
  const t = useT()
  const mode = useInstallMode()
  if (!mode) return null
  return (
    <DropdownMenu.Item className="crm-menu-item" onSelect={startInstall}>
      <Download /> {t('pwa.install')}
    </DropdownMenu.Item>
  )
}

const tipKey = (slug: string) => `spa.pwa.tip.${slug}`

/** One-time, dismissible install tip on the dashboard home (owners and managers). Remembered per browser. */
export function InstallTip({ app, slug }: { app: string; slug: string }) {
  const t = useT()
  const mode = useInstallMode()
  const [dismissed, setDismissed] = useState(true) // until storage is read: no flash for people who closed it
  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(tipKey(slug)) === '1')
    } catch {
      setDismissed(false)
    }
  }, [slug])
  if (!mode || dismissed) return null
  const dismiss = () => {
    setDismissed(true)
    try {
      window.localStorage.setItem(tipKey(slug), '1')
    } catch {
      // Storage blocked: hidden for this visit only.
    }
  }
  return (
    <section className="crm-note relative pe-10" data-tone="acc" aria-label={t('pwa.tip.title', { app })}>
      <Download aria-hidden strokeWidth={1.8} />
      <div className="min-w-0">
        <b className="font-semibold">{t('pwa.tip.title', { app })}</b>
        <p className="crm-muted">{t('pwa.tip.body')}</p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          <Button size="sm" onClick={startInstall}>
            {mode === 'ios' ? t('pwa.tip.howTo') : t('pwa.tip.install')}
          </Button>
          <Button size="sm" variant="ghost" onClick={dismiss}>
            {t('pwa.tip.dismiss')}
          </Button>
        </div>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t('pwa.tip.dismiss')}
        className="absolute end-2 top-2 grid size-7 place-items-center rounded-md text-muted transition-colors hover:bg-subtle hover:text-fg"
      >
        <X className="size-4" strokeWidth={1.8} />
      </button>
    </section>
  )
}
