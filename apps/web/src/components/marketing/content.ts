// Marketing copy shared by the home, features, website-builder and pricing pages.

export type Tint = 'sage' | 'clay' | 'mist' | 'sand' | 'plum'

export type Area = { key: string; title: string; blurb: string; tint: Tint; features: string[] }

export const AREAS: Area[] = [
  {
    key: 'front-desk',
    title: 'Front desk',
    blurb: 'A calm calendar for therapists, rooms and walk-ins.',
    tint: 'sage',
    features: [
      'Day view by therapist or by room, drag to reschedule',
      'Walk-ins with a fair therapist rotation list',
      'Double booking blocked by the database itself',
      'Couples treatments: two therapists and one room in one booking',
      'Late-night spas: the business day ends at your cutoff, not midnight',
      'Services with durations, prices and EN/AR names; rooms, staff skills and shifts',
      'Online booking page in English and Arabic, with WhatsApp confirmation',
    ],
  },
  {
    key: 'clients',
    title: 'Clients & WhatsApp',
    blurb: 'Know every guest, and message them in one click.',
    tint: 'clay',
    features: [
      'Client profiles with preferences, notes, tags and visit history',
      'Phone numbers hidden from therapists (anti-poaching)',
      'Intake and waiver forms in EN/AR, signed on screen',
      'WhatsApp outbox: confirmations, reminders, thank-yous, birthdays, win-backs',
      'Send through WhatsApp Web, the desktop app or a phone link',
      'Campaigns with segments and offer codes, with weekly caps built in',
      'Instagram inbox for messages and comments, with AI-drafted replies',
    ],
  },
  {
    key: 'money',
    title: 'Sales & money',
    blurb: 'Cash-first checkout and accounts you can read.',
    tint: 'sand',
    features: [
      'Checkout for services, products, packages and gift cards',
      'Split payments: cash, your own card machine, bank transfer, gift card',
      'Tips per therapist, tax receipts shared on WhatsApp, refunds with reasons',
      'End-of-day cash count and daily close',
      'Packages, memberships, gift cards and promo codes',
      'Double-entry accounts: profit and loss, VAT figures for the FTA return',
      'Expenses with AI receipt scanning; payroll with commissions and WPS file',
      'Inventory with stock counts and products used per treatment',
    ],
  },
  {
    key: 'website',
    title: 'Website builder',
    blurb: 'A beautiful site in an afternoon, in English and Arabic.',
    tint: 'mist',
    features: [
      '8 designer templates and ready-made sections',
      'Drag-and-drop editor with per-device styling',
      'Switch template any time, with one-click undo',
      'Saved and global sections, version history, scheduled publishing',
      'Checks before publishing: missing alt text, Arabic copy, broken links',
      'Media library with automatic image sizes',
      'Your own domain, or buy one from us, with HTTPS included',
    ],
  },
  {
    key: 'growth',
    title: 'Growth & AI',
    blurb: 'Quiet tools that bring guests back.',
    tint: 'plum',
    features: [
      'AI receptionist chat that can book a treatment',
      'Instagram captions and images, posted from the dashboard',
      'Google reviews synced, with suggested replies; Google posts with a Book button',
      'Quiet-slot offers to fill the gaps in your day',
      'Weekly insights and a morning digest on your phone',
      'Website analytics without cookies: sections, funnel and sources',
    ],
  },
  {
    key: 'team',
    title: 'Team & control',
    blurb: 'Everyone sees exactly what they need.',
    tint: 'sage',
    features: [
      'Roles for owner, manager, receptionist, therapist and accountant, or build your own',
      'Two-factor sign-in, invitations and an audit log of every change',
      'Staff and business documents with expiry reminders',
      'Import your clients, menu and products from a spreadsheet; export everything',
    ],
  },
]

export const DAY = [
  {
    t: '09:12',
    title: 'Booked online',
    text: 'Layla picks a 90-minute deep tissue on your site.',
    tint: 'mist' as Tint,
  },
  {
    t: '09:13',
    title: 'Confirmed on WhatsApp',
    text: 'One click sends the confirmation from your number.',
    tint: 'sage' as Tint,
  },
  {
    t: '18:00',
    title: 'Checked in',
    text: 'Her preferences and signed waiver are already there.',
    tint: 'sand' as Tint,
  },
  {
    t: '18:05',
    title: 'Treatment',
    text: 'Room and therapist were reserved together — no clashes.',
    tint: 'plum' as Tint,
  },
  {
    t: '19:40',
    title: 'Paid & thanked',
    text: 'Cash or card recorded, receipt and review request sent.',
    tint: 'clay' as Tint,
  },
]

export const TEMPLATES: { name: string; mood: string; colors: [string, string, string] }[] = [
  { name: 'Zen Minimal', mood: 'Calm and airy', colors: ['#eef2ef', '#8fa89a', '#23221f'] },
  { name: 'Dark Luxury', mood: 'Evening and gold', colors: ['#2a2723', '#b8a07a', '#f3efe7'] },
  { name: 'Nordic Clean', mood: 'Light and precise', colors: ['#f2f3f5', '#9fb1c2', '#1e2530'] },
  { name: 'Thai Teak', mood: 'Warm wood tones', colors: ['#f7f0ea', '#a7826a', '#2c221c'] },
  { name: 'Desert Sand', mood: 'Warm and grounded', colors: ['#f9f6f1', '#c8a490', '#3b2f27'] },
  { name: 'Tropical Bali', mood: 'Lush and green', colors: ['#eef3ec', '#6f8f6a', '#1f2a1e'] },
  { name: 'Urban Express', mood: 'Quick and modern', colors: ['#f5f1f4', '#b3a1b0', '#2e2530'] },
  { name: 'Hotel Spa', mood: 'Quiet luxury', colors: ['#f6f3ee', '#cdbfa9', '#2a2620'] },
]

export const INCLUDED = [
  'Every feature, no add-ons',
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
    a: 'No — messages are prepared for you and sent from your own WhatsApp in one click, so your number stays safe.',
  },
]
