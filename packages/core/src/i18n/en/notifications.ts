// `notifications` namespace (EN source): the shell bell, the /notifications page and every notification kind's text
// (also used for web-push titles/bodies in the recipient's locale). Mirror every key in th/notifications.ts.
export const notifications = {
  title: 'Notifications',
  description: 'Online bookings, stock, documents, AI drafts and billing — everything that needs a look.',
  bell: 'Notifications',
  bellUnread: { one: 'Notifications, {count} unread', other: 'Notifications, {count} unread' },
  markAll: 'Mark all as read',
  markRead: 'Mark as read',
  viewAll: 'See all notifications',
  older: 'Older notifications',
  allRead: 'All notifications marked as read.',
  emptyTitle: "You're all caught up",
  empty: 'New online bookings, low stock, expiring documents and AI drafts will show up here.',
  unread: 'Unread',
  filter: { all: 'All', unread: 'Unread' },
  warehouse: 'Warehouse',
  unknown: 'Notification',
  kind: {
    booking: {
      online: { title: 'New online booking', body: '{name} · {service} · {at} — waiting for confirmation' },
      pending: {
        title: 'Booking waiting for confirmation',
        body: '{name} · {service} · {at} — confirm it on WhatsApp',
      },
    },
    stock: {
      low: {
        title: {
          one: 'Low stock at {location}: {count} product',
          other: 'Low stock at {location}: {count} products',
        },
        body: '{products}',
      },
    },
    document: {
      expiry: {
        title: { one: 'A document needs renewing', other: '{count} documents need renewing' },
        body: { one: '{name} — expires {date}', other: '{name} — expires {date}, and {more} more' },
      },
    },
    ai: {
      drafts: {
        title: {
          one: '{count} AI draft waiting for approval',
          other: '{count} AI drafts waiting for approval',
        },
        body: 'Instagram posts: {posts} · Review replies: {replies}',
      },
      budget_warning: {
        title: 'AI budget {percent}% used',
        body: 'USD {spent} of USD {budget} this month. AI pauses when the budget is reached — contact us to raise it.',
      },
      budget_reached: {
        title: 'AI paused: monthly AI budget reached',
        body: 'USD {budget} used this month. AI features restart on the 1st — contact us to raise the budget.',
      },
    },
    billing: {
      overdue: { title: 'Invoice overdue', body: '{number} · {amount} was due on {date}' },
      reminder: { title: 'Payment reminder', body: '{amount} is due — open Billing to pay' },
    },
    weekly_insights: { title: 'Your weekly insights are ready', body: '{headline}' },
    daily_digest: {
      title: { one: 'Today: {count} booking', other: 'Today: {count} bookings' },
      body: '{detail}',
    },
  },
  digest: {
    insightsFallback: 'See what changed last week and two things to try this week.',
    pending: {
      one: '{count} still waiting for confirmation — confirm it on WhatsApp.',
      other: '{count} still waiting for confirmation — confirm them on WhatsApp.',
    },
    allConfirmed: 'All confirmed. Have a calm day.',
  },
} as const
