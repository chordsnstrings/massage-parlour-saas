// Console page group "applications-enquiries-announcements" (R22, AR). Mirrors en/applications-enquiries-announcements.ts — a missing or extra key is a type error.
// Owned by that group's conversion; glossary + tone: docs/design/console-i18n.md.
import type { Widen } from '../../types'
import type { domainErrors as en } from '../en/applications-enquiries-announcements'
import type { ConsoleMessages } from '../types'

export const applications: ConsoleMessages['applications'] = {
  title: 'طلبات الانضمام',
  description:
    'تتقدم مراكز السبا الجديدة بطلباتها هنا. اقبل الطلب لإنشاء المركز وتسجيل دفعة رسوم الإعداد، أو ارفضه.',
}

export const contactEnquiries: ConsoleMessages['contactEnquiries'] = {
  title: 'الاستفسارات',
  description:
    'رسائل من صفحة التواصل. رُدّ عبر الهاتف أو واتساب أو البريد الإلكتروني، ثم ضع عليها علامة «تم التواصل» أو «مغلق».',
}

export const announcements: ConsoleMessages['announcements'] = {
  title: 'الإعلانات',
  description:
    'إشعارات تظهر أعلى لوحة تحكم السبا (يمكن لكل عضو إخفاؤها). لا تُرسَل أبدًا بالبريد الإلكتروني أو الرسائل النصية.',
}

export const domainErrors: Widen<typeof en> = {}
