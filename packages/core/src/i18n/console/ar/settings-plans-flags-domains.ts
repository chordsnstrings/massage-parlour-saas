// Console page group "settings-plans-flags-domains" (R22, AR). Mirrors en/settings-plans-flags-domains.ts — a missing or extra key is a type error.
// Owned by that group's conversion; glossary + tone: docs/design/console-i18n.md.
import type { Widen } from '../../types'
import type { domainErrors as en } from '../en/settings-plans-flags-domains'
import type { ConsoleMessages } from '../types'

export const company: ConsoleMessages['company'] = {
  title: 'الشركة',
  description: 'شركتك المشغِّلة — تظهر على الفواتير وصفحة الفوترة وفي طلبات Meta وGoogle.',
}

export const plans: ConsoleMessages['plans'] = {
  title: 'الباقات والأسعار',
  description:
    'تُطبَّق الأسعار على مراكز السبا الجديدة. تحتفظ المراكز الحالية بالسعر المتفق عليه حتى تغيّر اشتراكها.',
}

export const flags: ConsoleMessages['flags'] = {
  title: 'مفاتيح الميزات',
  description:
    'مفاتيح تشغيل وإيقاف للميزات: إعداد افتراضي واحد لجميع مراكز السبا، مع استثناءات لكل مركز. تُطبَّق التغييرات عند تحميل الصفحة التالي وتُسجَّل في سجل التدقيق.',
}

export const domains: ConsoleMessages['domains'] = {
  title: 'النطاقات',
}

export const domainErrors: Widen<typeof en> = {}
