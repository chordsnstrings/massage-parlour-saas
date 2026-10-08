'use client'
import { Search, ShoppingBag, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState, useTransition } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { toast } from '@/components/ui/toast'
import { resultText, useI18n } from '@/i18n/client'
import { cn } from '@/lib/utils'
import {
  cancelDomainOrderAction,
  type DomainSearchResult,
  requestDomainAction,
  searchDomainsAction,
} from './actions'

type Offers = Extract<DomainSearchResult, { ok: true }>['offers']

export function BuyDomain({ slug }: { slug: string }) {
  const { t, fmt } = useI18n()
  const [query, setQuery] = useState('')
  const [offers, setOffers] = useState<Offers | null>(null)
  const [unconfigured, setUnconfigured] = useState(false)
  const [searching, startSearch] = useTransition()
  const [requesting, startRequest] = useTransition()
  const [picked, setPicked] = useState<string | null>(null)

  const search = (e: React.FormEvent) => {
    e.preventDefault()
    startSearch(async () => {
      const r = await searchDomainsAction(slug, query)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      setUnconfigured(!r.configured)
      setOffers(r.offers)
    })
  }
  const request = (domain: string, price: number) => {
    if (
      !window.confirm(t('settings.domains.search.confirm', { domain, price: fmt.aed(price) }))
    )
      return
    setPicked(domain)
    startRequest(async () => {
      const r = await requestDomainAction(slug, domain)
      if (r?.ok) {
        toast.success(resultText(t, r) ?? '')
        setOffers(null)
        setQuery('')
      } else if (r) toast.error(resultText(t, r))
      setPicked(null)
    })
  }

  return (
    <div className="space-y-4">
      <form onSubmit={search} className="space-y-1.5">
        <Label htmlFor="domain-search">{t('settings.domains.search.label')}</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="domain-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="serenity spa"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            dir="ltr"
            className="h-11 sm:flex-1"
          />
          <Button type="submit" size="lg" variant="secondary" pending={searching} className="sm:w-auto">
            {!searching && <Search />} {t('settings.domains.search.button')}
          </Button>
        </div>
      </form>
      {unconfigured && (
        <p role="status" className="rounded-lg border border-warning/25 bg-warning-soft px-4 py-3 text-sm">
          {t('settings.domains.search.unconfigured')}
        </p>
      )}
      <AnimatePresence initial={false}>
        {offers && offers.length > 0 && (
          <motion.ul
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            aria-label={t('settings.domains.search.results')}
            className="divide-y divide-border overflow-hidden rounded-xl border"
          >
            {offers.map((o) => (
              <li key={o.domain} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p
                    dir="ltr"
                    className={cn('break-all font-medium', !o.available && 'text-muted line-through')}
                  >
                    {o.domain}
                  </p>
                  <p className="text-[13px] text-muted">
                    {o.available && o.priceAed
                      ? t(o.premium ? 'settings.domains.search.premium' : 'settings.domains.search.perYear', {
                          price: fmt.aed(o.priceAed),
                        })
                      : (o.note ?? t('settings.domains.search.taken'))}
                  </p>
                </div>
                {o.available && o.priceAed ? (
                  <Button
                    size="sm"
                    className="h-11 sm:h-8"
                    pending={requesting && picked === o.domain}
                    disabled={requesting}
                    onClick={() => request(o.domain, o.priceAed!)}
                  >
                    {!(requesting && picked === o.domain) && <ShoppingBag />} {t('settings.domains.search.request')}
                  </Button>
                ) : (
                  <Badge>{t('settings.domains.search.unavailable')}</Badge>
                )}
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
      <p className="text-[13px] text-muted">{t('settings.domains.search.note')}</p>
    </div>
  )
}

export function CancelOrderButton({ slug, id, domain }: { slug: string; id: string; domain: string }) {
  const { t } = useI18n()
  const [pending, start] = useTransition()
  return (
    <Button
      variant="ghost"
      size="sm"
      pending={pending}
      className="h-11 text-danger hover:bg-danger-soft hover:text-danger sm:h-8"
      onClick={() => {
        if (!window.confirm(t('settings.domains.orders.cancelConfirm', { domain }))) return
        start(async () => {
          const r = await cancelDomainOrderAction(slug, id)
          if (r?.ok) toast.success(resultText(t, r) ?? '')
          else if (r) toast.error(resultText(t, r))
        })
      }}
    >
      {!pending && <X />} {t('settings.domains.orders.cancel')}
    </Button>
  )
}
