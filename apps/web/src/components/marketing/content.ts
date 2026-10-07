// Marketing copy shared by the home, features, website-builder and pricing pages.

export type Tint = 'sage' | 'clay' | 'mist' | 'sand' | 'plum'

export type Area = { key: string; title: string; blurb: string; tint: Tint; features: string[] }

export const AREAS: Area[] = [
  {
    key: 'bookings',
    title: 'Bookings on autopilot',
    blurb: 'Clients book themselves, day and night. You just see them arrive.',
    tint: 'sage',
    features: [
      'Online booking page in English and Arabic, open 24/7',
      'AI receptionist chat that answers questions and books the treatment',
      'Instagram messages answered by AI, with bookings made from the chat',
      'Every booking lands on the calendar with therapist and room reserved',
      'Double booking impossible — the database itself blocks it',
      'Couples treatments, walk-in rotation and late-night business days handled for you',
      'Google posts and your Instagram bio carry a Book button that is tracked by source',
    ],
  },
  {
    key: 'follow-up',
    title: 'Follow-ups that write themselves',
    blurb: 'Every reminder and message is prepared for you. One tap sends it from your own WhatsApp.',
    tint: 'clay',
    features: [
      'Confirmation and reminder queued the moment a booking is made',
      'Thank-you message ready at checkout',
      'Quiet-slot offers generated for the gaps in your day',
      'Birthday, win-back and rebook campaigns: choose the clients once, messages are written and paced for you',
      'Sent from your own number, so it stays safe — no risky bots',
    ],
  },
  {
    key: 'money',
    title: 'Books that do themselves',
    blurb: 'Every sale posts to your accounts. VAT and payroll are ready when you are.',
    tint: 'sand',
    features: [
      'Each sale, refund and tip posts to double-entry accounts automatically',
      'Profit and loss and VAT figures for the FTA return, always up to date',
      'Commissions calculated per therapist; WPS salary file in one click',
      'Products used per treatment deducted from stock automatically',
      'Package and gift-card balances tracked; expired packages closed for you',
      'Receipts scanned by AI into expenses',
      'Cash, your own card machine or bank transfer — recorded, never processed',
    ],
  },
  {
    key: 'marketing',
    title: 'Marketing that runs itself',
    blurb: 'AI writes, posts and replies, so new guests keep finding you.',
    tint: 'plum',
    features: [
      'AI writes Instagram captions and images; scheduled posts publish themselves',
      'Google reviews synced automatically, with AI-written replies to approve',
      'AI site writer drafts your website copy in English and Arabic',
      'Weekly insights and a morning digest sent to your phone',
      'Website analytics without cookies: which sections and sources bring bookings',
    ],
  },
  {
    key: 'website',
    title: 'A website crafted for you',
    blurb: 'Designed, written and built by our studio — with booking built in.',
    tint: 'mist',
    features: [
      'Handcrafted by our studio from your menu, team, photos and story',
      'Every section composed from hundreds of hand-tuned designs, in English and Arabic',
      'Already have a site? We read it and bring your content across',
      'Ask for any change — we make it; prices, team and hours update themselves',
      'Your own domain, or buy one from us — connected and secured automatically',
    ],
  },
  {
    key: 'team',
    title: 'Control without the admin',
    blurb: 'Everyone sees exactly what they need. Nothing slips through.',
    tint: 'sage',
    features: [
      'Roles for owner, manager, receptionist, therapist and accountant, or your own',
      'Therapists never see client phone numbers',
      'Staff and business documents tracked, with expiry reminders to your phone',
      'Two-factor sign-in and an audit log of every change',
      'Import clients, menu and products from a spreadsheet; export everything',
    ],
  },
]

/** What runs without anyone lifting a finger (home page sequence). */
export const DAY = [
  {
    t: '02:14',
    title: 'Booked while you sleep',
    text: 'A client books a 90-minute massage on your site at 2 am.',
    tint: 'mist' as Tint,
  },
  {
    t: '02:15',
    title: 'Reminder queued',
    text: 'Confirmation and day-before reminder are written and waiting.',
    tint: 'sage' as Tint,
  },
  {
    t: '11:00',
    title: 'Gap spotted',
    text: 'A quiet afternoon slot gets an offer to your lapsed clients.',
    tint: 'plum' as Tint,
  },
  {
    t: '19:40',
    title: 'Paid & posted',
    text: 'The sale lands in your accounts, VAT and commission included.',
    tint: 'sand' as Tint,
  },
  {
    t: '19:41',
    title: 'Follow-up ready',
    text: 'A thank-you is queued at checkout; your win-back campaign brings her back next month.',
    tint: 'clay' as Tint,
  },
]

/** Background jobs that run on their own (features page). */
export const AUTOMATIONS = [
  'Confirmations and reminders queued for every booking',
  'Quiet-slot offers twice a day',
  'Instagram posts published on schedule',
  'Google reviews synced every two hours',
  'Expired packages closed overnight',
  'Document expiry alerts to your phone',
  'Morning digest and weekly insights',
  'Domains checked and secured automatically',
  'Nightly backups',
]

export const INCLUDED = [
  'Every feature and automation, no add-ons',
  'Unlimited staff, clients and bookings',
  'Website, online booking and your own domain',
  'AI tools with a monthly allowance',
  'Onboarding and data import help',
  'WhatsApp support from a real person',
]

export const FAQ = [
  {
    q: 'Do you take payments from my clients?',
    a: 'No. You keep using cash, your own card machine or bank transfer — we record every payment so your accounts and VAT figures are right.',
  },
  {
    q: 'Can I pay for the subscription by card?',
    a: 'Yes. Pay your invoice by card from the Billing page, or by bank transfer or cash if you prefer.',
  },
  {
    q: 'Is it in Arabic?',
    a: 'Your website, booking page and client messages work in English and Arabic. The dashboard is in English.',
  },
  {
    q: 'Can I bring my existing data?',
    a: 'Yes. Import clients, your menu and products from a spreadsheet. We help you with the first import.',
  },
  {
    q: 'Do you send WhatsApp messages automatically?',
    a: 'Every message is written and queued automatically; your team sends it from your own WhatsApp in one tap, so your number stays safe.',
  },
]
