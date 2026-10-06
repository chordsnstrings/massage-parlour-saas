'use client'
import { Search, ShoppingBag, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState, useTransition } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import {
  cancelDomainOrderAction,
  type DomainSearchResult,
  requestDomainAction,
  searchDomainsAction,
} from './actions'

type Offers = Extract<DomainSearchResult, { ok: true }>['offers']
const aed = (n: number) => `AED ${n.toLocaleString('en-AE')}`

export function BuyDomain({ slug }: { slug: string }) {
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
      !window.confirm(
        `Request ${domain} for ${aed(price)} / year? It’s added to your next invoice once we buy it.`,
      )
    )
      return
    setPicked(domain)
    startRequest(async () => {
      const r = await requestDomainAction(slug, domain)
      if (r?.ok) {
        toast.success(r.message ?? 'Requested')
        setOffers(null)
        setQuery('')
      } else if (r) toast.error(r.error)
      setPicked(null)
    })
  }

  return (
    <div className="space-y-4">
      <form onSubmit={search} className="space-y-1.5">
        <Label htmlFor="domain-search">Search for a name</Label>
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
            {!searching && <Search />} Search
          </Button>
        </div>
      </form>
      {unconfigured && (
        <p role="status" className="rounded-lg border border-warning/25 bg-warning-soft px-4 py-3 text-sm">
          Buying domains isn’t switched on yet — contact support, or connect a domain you already own.
        </p>
      )}
      <AnimatePresence initial={false}>
        {offers && offers.length > 0 && (
          <motion.ul
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            aria-label="Search results"
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
                      ? `${aed(o.priceAed)} / year${o.premium ? ' · premium name' : ''}`
                      : (o.note ?? 'Taken')}
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
                    {!(requesting && picked === o.domain) && <ShoppingBag />} Request
                  </Button>
                ) : (
                  <Badge>Unavailable</Badge>
                )}
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
      <p className="text-[13px] text-muted">
        We register it in your spa’s name, point it at your website and switch on SSL. The yearly registrar
        price is added to your next invoice. .ae names aren’t available here — buy those from a UAE registrar
        and connect them above.
      </p>
    </div>
  )
}

export function CancelOrderButton({ slug, id, domain }: { slug: string; id: string; domain: string }) {
  const [pending, start] = useTransition()
  return (
    <Button
      variant="ghost"
      size="sm"
      pending={pending}
      className="h-11 text-danger hover:bg-danger-soft hover:text-danger sm:h-8"
      onClick={() => {
        if (!window.confirm(`Cancel the request for ${domain}?`)) return
        start(async () => {
          const r = await cancelDomainOrderAction(slug, id)
          if (r?.ok) toast.success(r.message ?? 'Cancelled')
          else if (r) toast.error(r.error)
        })
      }}
    >
      {!pending && <X />} Cancel
    </Button>
  )
}
