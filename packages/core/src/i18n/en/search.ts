// `search` namespace (EN source): the top-bar global search (⌘K / Ctrl+K palette, PLAN §14.7 B4).
// Mirror every key in th/search.ts.
export const search = {
  open: 'Search',
  placeholder: 'Search clients, bookings, receipts…',
  dialog: 'Search the spa',
  input: 'Search',
  hint: 'Type at least 2 characters — a name, phone, booking reference or receipt number.',
  hintNoPhone: 'Type at least 2 characters — a name, booking reference or receipt number.',
  loading: 'Searching…',
  empty: 'Nothing found for “{q}”.',
  error: 'Search failed. Try again.',
  more: 'Show more',
  keys: '↑ ↓ move · Enter open · Esc close',
  close: 'Close search',
  group: {
    clients: 'Clients',
    bookings: 'Bookings',
    sales: 'Receipts',
    staff: 'Staff',
    services: 'Services',
  },
  hit: {
    receipt: 'Receipt #{number}',
    walkIn: 'Walk-in',
    lastVisit: 'Last visit {date}',
    newClient: 'No visits yet',
  },
}
