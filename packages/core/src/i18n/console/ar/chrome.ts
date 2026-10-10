// `chrome` namespace (AR). Mirrors en/chrome.ts — a missing or extra key is a type error.
import type { ConsoleMessages } from '../types'

export const chrome: ConsoleMessages['chrome'] = {
  title: 'لوحة تحكم المنصة',
  nav: {
    overview: 'نظرة عامة',
    applications: 'الطلبات',
    enquiries: 'الاستفسارات',
    tenants: 'مراكز السبا',
    performance: 'الأداء',
    websites: 'المواقع',
    plans: 'الباقات والأسعار',
    announcements: 'الإعلانات',
    flags: 'مفاتيح الميزات',
    company: 'الشركة',
    aiModels: 'نماذج الذكاء الاصطناعي',
    aiUsage: 'استخدام الذكاء الاصطناعي',
    domains: 'النطاقات',
    templates: 'قوالب المواقع',
    audit: 'سجل التدقيق',
  },
  menu: {
    account: 'الحساب والأمان',
    switchSpa: 'تبديل مركز السبا',
    signOut: 'تسجيل الخروج',
    language: 'اللغة',
  },
  notFound: {
    title: 'الصفحة غير موجودة',
    body: 'هذه الصفحة غير موجودة في لوحة التحكم، أو نُقلت إلى مكان آخر.',
    back: 'العودة إلى لوحة التحكم',
  },
  boundary: {
    title: 'حدث خطأ ما',
    body: 'سُجّل الخطأ. حاول مرة أخرى؛ يساعد الرقم المرجعي أدناه في العثور عليه في سجلات الخادم.',
    retry: 'حاول مرة أخرى',
    home: 'العودة إلى لوحة التحكم',
    ref: 'المرجع {digest}',
  },
}
