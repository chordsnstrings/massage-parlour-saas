import { DEFAULT_HOURS } from '@spa/core'
import type { SiteData } from '@/components/site/types'

/** Sample spa used to preview templates in the studio (no tenant data involved). */
export const DEMO_SITE: Omit<SiteData, 'pages'> = {
  tenant: { name: 'Serenity Spa', slug: 'serenity' },
  branch: {
    name: 'Jumeirah',
    address: 'Jumeirah Beach Road, Dubai',
    mapsUrl: null,
    phone: '+971 4 000 0000',
    whatsappE164: '971500000000',
    openingHours: DEFAULT_HOURS,
    businessDayCutoff: '05:00',
  },
  services: [
    {
      id: 'demo-swedish',
      name: { en: 'Swedish massage', ar: 'مساج سويدي' },
      description: {
        en: 'Long, gentle strokes to relax body and mind.',
        ar: 'حركات طويلة لطيفة لإرخاء الجسم والذهن.',
      },
      category: { en: 'Massage', ar: 'مساج' },
      variants: [
        { durationMin: 60, priceAed: '350' },
        { durationMin: 90, priceAed: '480' },
      ],
    },
    {
      id: 'demo-deep',
      name: { en: 'Deep tissue', ar: 'مساج الأنسجة العميقة' },
      description: {
        en: 'Firm pressure for tight shoulders and back.',
        ar: 'ضغط قوي للكتفين والظهر المشدودين.',
      },
      category: { en: 'Massage', ar: 'مساج' },
      variants: [{ durationMin: 60, priceAed: '390' }],
    },
    {
      id: 'demo-thai',
      name: { en: 'Thai massage', ar: 'مساج تايلاندي' },
      description: { en: 'Stretches and pressure on a padded mat.', ar: 'تمددات وضغط على فراش مريح.' },
      category: { en: 'Massage', ar: 'مساج' },
      variants: [{ durationMin: 90, priceAed: '420' }],
    },
    {
      id: 'demo-foot',
      name: { en: 'Foot reflexology', ar: 'مساج القدمين' },
      description: { en: 'A quick reset for tired feet.', ar: 'راحة سريعة للقدمين المتعبتين.' },
      category: { en: 'Express', ar: 'سريع' },
      variants: [
        { durationMin: 30, priceAed: '150' },
        { durationMin: 45, priceAed: '210' },
      ],
    },
  ],
  staff: [
    {
      id: 'demo-maya',
      name: 'Maya',
      photoUrl: null,
      bio: { en: 'Swedish and hot stone.', ar: 'سويدي وأحجار ساخنة.' },
    },
    {
      id: 'demo-ploy',
      name: 'Ploy',
      photoUrl: null,
      bio: { en: 'Traditional Thai.', ar: 'تايلاندي تقليدي.' },
    },
    { id: 'demo-sara', name: 'Sara', photoUrl: null, bio: { en: 'Deep tissue.', ar: 'الأنسجة العميقة.' } },
  ],
}
