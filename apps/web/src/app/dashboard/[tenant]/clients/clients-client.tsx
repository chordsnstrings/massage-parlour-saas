'use client'
import { Loader2, Plus, Search, X } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'
import { ClientDetailsFields } from '@/components/clients/details-fields'
import { Button } from '@/components/ui/button'
import { ActionForm, SubmitButton } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Sheet } from '@/components/ui/sheet'
import { appPath } from '@/lib/paths'
import { createClientAction } from './actions'

/** Search box that keeps the query in the URL (debounced), so results are shareable and server-rendered. */
export function ClientSearch({ initial, placeholder }: { initial: string; placeholder: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [value, setValue] = useState(initial)
  const [pending, start] = useTransition()
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const t = setTimeout(() => {
      const p = new URLSearchParams(params.toString())
      if (value.trim()) p.set('q', value.trim())
      else p.delete('q')
      const s = p.toString()
      if (s === params.toString()) return
      start(() => router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false }))
    }, 250)
    return () => clearTimeout(t)
  }, [value, params, pathname, router])
  return (
    <div className="relative w-full sm:w-72">
      <span className="pointer-events-none absolute inset-y-0 start-3 grid place-items-center text-muted">
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
      </span>
      <Input
        type="search"
        aria-label="Search clients"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="h-11 ps-9 pe-9 sm:h-10 [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => setValue('')}
          className="absolute inset-y-0 end-1 grid w-9 place-items-center text-muted hover:text-fg"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  )
}

export function NewClientSheet({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false)
  const router = useRouter()
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title="New client"
      description="Add someone who called or walked in."
      className="md:max-w-xl"
      trigger={
        <Button>
          <Plus /> New client
        </Button>
      }
    >
      <ActionForm
        action={createClientAction.bind(null, slug)}
        className="space-y-6"
        onSuccess={(r) => {
          setOpen(false)
          const id = r.data?.id
          if (typeof id === 'string') router.push(appPath(`/${slug}/clients/${id}`))
        }}
      >
        <ClientDetailsFields />
        <SubmitButton className="w-full" size="lg">
          Add client
        </SubmitButton>
      </ActionForm>
    </Sheet>
  )
}
