'use client'
// Top-bar global search (PLAN §14.7 B4, crm-spec §2.2): a search field that opens a ⌘K / Ctrl+K palette with grouped,
// permission-filtered results (server action), keyboard navigation (↑ ↓ Enter, Esc) and "Show more" per group.
// ≤680 px the field collapses to an icon button (crm-spec §2.3). Styles: crm.css `.crm-search*`.
import { Search, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Dialog } from 'radix-ui'
import { useEffect, useId, useMemo, useRef, useState, useTransition } from 'react'
import { useI18n } from '@/i18n/client'
import { type SearchResultGroup, searchAction } from './actions'

type Row = { id: string; type: 'item'; href: string } | { id: string; type: 'more'; group: SearchResultGroup }

export function SearchPalette({ slug, phoneSearch }: { slug: string; phoneSearch: boolean }) {
  const { t, locale } = useI18n()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [groups, setGroups] = useState<SearchResultGroup[] | null>(null)
  const [pages, setPages] = useState<Record<string, number>>({})
  const [error, setError] = useState(false)
  const [active, setActive] = useState(0)
  const [pending, start] = useTransition()
  const seq = useRef(0)
  const listId = useId()
  const [mac, setMac] = useState(false)

  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent))
  }, [])

  // ⌘K / Ctrl+K anywhere in the dashboard toggles the palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  // Debounced query → grouped results; stale answers are dropped.
  useEffect(() => {
    const query = q.trim()
    if (query.length < 2) {
      seq.current++
      setGroups(null)
      setError(false)
      return
    }
    const n = ++seq.current
    const timer = setTimeout(() => {
      start(async () => {
        const res = await searchAction(slug, query).catch(() => null)
        if (n !== seq.current) return
        if (!res?.ok) {
          setError(true)
          setGroups(null)
          return
        }
        setError(false)
        setGroups(res.groups)
        setPages({})
        setActive(0)
      })
    }, 180)
    return () => {
      clearTimeout(timer)
    }
  }, [q, slug])

  const rows = useMemo<Row[]>(
    () =>
      (groups ?? []).flatMap((g) => [
        ...g.items.map((i) => ({ id: `${g.kind}-${i.id}`, type: 'item' as const, href: i.href })),
        ...(g.hasMore ? [{ id: `${g.kind}-more`, type: 'more' as const, group: g }] : []),
      ]),
    [groups],
  )

  const close = () => {
    setOpen(false)
  }
  const go = (href: string) => {
    close()
    router.push(href)
  }
  const more = (g: SearchResultGroup) => {
    const page = (pages[g.kind] ?? 1) + 1
    const n = seq.current
    start(async () => {
      const res = await searchAction(slug, q.trim(), { kind: g.kind, page }).catch(() => null)
      if (n !== seq.current || !res?.ok) return
      const next = res.groups[0]
      setPages((p) => ({ ...p, [g.kind]: page }))
      setGroups((cur) =>
        (cur ?? []).map((x) =>
          x.kind === g.kind
            ? {
                ...x,
                items: [
                  ...x.items,
                  ...(next?.items ?? []).filter((i) => !x.items.some((o) => o.id === i.id)),
                ],
                hasMore: next?.hasMore ?? false,
              }
            : x,
        ),
      )
    })
  }
  const run = (row: Row | undefined) => {
    if (!row) return
    if (row.type === 'item') go(row.href)
    else more(row.group)
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!rows.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => (a + 1) % rows.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => (a - 1 + rows.length) % rows.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      run(rows[active])
    }
  }

  // Keep the highlighted option in view.
  useEffect(() => {
    const id = rows[active]?.id
    if (!id) return
    document.getElementById(`${listId}-${id}`)?.scrollIntoView({ block: 'nearest' })
  }, [active, rows, listId])

  const query = q.trim()
  const activeId = rows[active] ? `${listId}-${rows[active].id}` : undefined
  const shortcut = mac ? '⌘K' : 'Ctrl K'

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setActive(0)
      }}
    >
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="crm-search"
          aria-label={t('search.open')}
          aria-keyshortcuts="Control+K Meta+K"
        >
          <Search aria-hidden strokeWidth={1.8} />
          <span className="crm-search-ph">{t('search.placeholder')}</span>
          <kbd suppressHydrationWarning>{shortcut}</kbd>
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="crm-search-scrim" />
        <Dialog.Content className="crm-search-dlg" lang={locale} aria-describedby={undefined}>
          <Dialog.Title className="sr-only">{t('search.dialog')}</Dialog.Title>
          <div className="crm-search-bar">
            <Search aria-hidden strokeWidth={1.8} />
            <input
              // biome-ignore lint/a11y/noAutofocus: the palette exists to type into
              autoFocus
              type="search"
              role="combobox"
              aria-label={t('search.input')}
              aria-expanded={rows.length > 0}
              aria-controls={listId}
              aria-activedescendant={activeId}
              aria-autocomplete="list"
              placeholder={t('search.placeholder')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onKeyDown}
              maxLength={80}
            />
            <Dialog.Close className="crm-iconbtn" aria-label={t('search.close')}>
              <X aria-hidden />
            </Dialog.Close>
          </div>
          <div className="crm-search-body" aria-busy={pending}>
            {query.length < 2 ? (
              <p className="crm-search-msg">{phoneSearch ? t('search.hint') : t('search.hintNoPhone')}</p>
            ) : error ? (
              <p className="crm-search-msg" role="alert">
                {t('search.error')}
              </p>
            ) : groups === null ? (
              <p className="crm-search-msg">{t('search.loading')}</p>
            ) : groups.length === 0 ? (
              <p className="crm-search-msg" role="status">
                {t('search.empty', { q: query })}
              </p>
            ) : (
              <div id={listId} role="listbox" aria-label={t('search.dialog')} className="crm-search-list">
                {groups.map((g) => (
                  // biome-ignore lint/a11y/useSemanticElements: ARIA listbox groups (a fieldset is not a listbox child)
                  <div key={g.kind} role="group" aria-labelledby={`${listId}-${g.kind}-h`}>
                    <div id={`${listId}-${g.kind}-h`} className="crm-search-gh">
                      {g.label}
                    </div>
                    {g.items.map((i) => {
                      const id = `${g.kind}-${i.id}`
                      const idx = rows.findIndex((r) => r.id === id)
                      return (
                        // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard handled on the combobox input
                        <div
                          key={id}
                          id={`${listId}-${id}`}
                          role="option"
                          tabIndex={-1}
                          aria-selected={idx === active}
                          className="crm-search-opt"
                          onMouseMove={() => setActive(idx)}
                          onClick={() => go(i.href)}
                        >
                          <b>{i.title}</b>
                          {i.sub && <small>{i.sub}</small>}
                        </div>
                      )
                    })}
                    {g.hasMore &&
                      (() => {
                        const id = `${g.kind}-more`
                        const idx = rows.findIndex((r) => r.id === id)
                        return (
                          // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard handled on the combobox input
                          <div
                            id={`${listId}-${id}`}
                            role="option"
                            tabIndex={-1}
                            aria-selected={idx === active}
                            className="crm-search-opt crm-search-more"
                            onMouseMove={() => setActive(idx)}
                            onClick={() => more(g)}
                          >
                            {t('search.more')} · {g.label}
                          </div>
                        )
                      })()}
                  </div>
                ))}
              </div>
            )}
          </div>
          <p className="crm-search-keys" aria-hidden>
            {t('search.keys')}
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
