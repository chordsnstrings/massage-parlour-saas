// `enquiries` namespace (EN source, F15): Inbox → Enquiries — messages sent from the spa's website enquiry form.
// Names and messages the visitors typed are never translated. Mirror every key in th/enquiries.ts.
export const enquiries = {
  title: 'Website enquiries',
  nav: 'Enquiries',
  description:
    'Messages from the enquiry form on your website. Reply on WhatsApp — nothing is emailed to the guest.',
  filter: { new: 'New', replied: 'Replied', closed: 'Closed', all: 'All' },
  filterLabel: 'Show',
  search: 'Search name, phone or message',
  searchButton: 'Search',
  colFrom: 'From',
  colMessage: 'Message',
  colReceived: 'Received',
  colStatus: 'Status',
  fromPage: 'From the {page} page',
  homePage: 'home',
  arabic: 'Wrote in Arabic',
  reply: 'Reply on WhatsApp',
  replyLabel: 'Reply to {name} on WhatsApp',
  markReplied: 'Mark replied',
  close: 'Close',
  reopen: 'Reopen',
  phoneHidden: 'Phone hidden',
  emptyTitle: 'No enquiries yet',
  empty: 'When a guest sends a message from your website, it shows up here.',
  emptyFilter: 'No enquiries match.',
  total: { one: '{count} enquiry', other: '{count} enquiries' },
  moved: 'Enquiry updated',
  // R26: a booking request from the website's HTML design form (typed names never translated).
  booking: {
    title: 'Booking request',
    minutes: '{n} min',
    guests: { one: '{count} guest', other: '{count} guests' },
    when: '{date} at {time}',
    /** The form offers the small hours under the chosen day (2026-10-13). */
    night: '{date} night · {time} (after midnight, {calendarDate})',
    with: 'with {name}',
  },
  // "Make booking" (owner 2026-10-13): opens the calendar's New booking prefilled from the request.
  make: {
    button: 'Make booking',
    label: 'Make a booking for {name}',
    booked: 'Booked',
    bookedLabel: 'Open the booking for {name} in the calendar',
    note: 'Website booking request',
  },
} as const
