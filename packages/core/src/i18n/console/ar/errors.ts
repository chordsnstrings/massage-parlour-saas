// `errors` namespace (AR). Mirrors en/errors.ts; `domain` merges the page groups' fragments the same way.
import type { ConsoleMessages } from '../types'
import { domainErrors as actions } from './actions'
import { domainErrors as aiPerformanceAudit } from './ai-performance-audit'
import { domainErrors as applicationsEnquiriesAnnouncements } from './applications-enquiries-announcements'
import { domainErrors as settingsPlansFlagsDomains } from './settings-plans-flags-domains'
import { domainErrors as templatesWebsites } from './templates-websites'
import { domainErrors as tenants } from './tenants'

export const errors: ConsoleMessages['errors'] = {
  generic: 'حدث خطأ ما — يُرجى المحاولة مرة أخرى.',
  forbidden: 'ليست لديك صلاحية للقيام بذلك.',
  checkFields: 'يُرجى مراجعة الحقول المظلّلة.',
  notFound: 'غير موجود.',
  signInAgain: 'يُرجى تسجيل الدخول مرة أخرى.',
  file: {
    empty: 'الملف فارغ',
    tooLarge: 'الحد الأقصى لحجم الملف {size}',
    imageTooLarge: 'الحد الأقصى لحجم الصورة {size}',
    compressedTooLarge: 'الصورة كبيرة جدًا حتى بعد الضغط',
    unreadable: 'تعذّرت قراءة الصورة — ربما تكون تالفة.',
    svg: 'ملفات SVG غير مدعومة — يُرجى رفع صورة JPG أو PNG أو WebP.',
    notImage: 'هذا الملف ليس صورة يمكن استخدامها (JPG أو PNG أو WebP أو AVIF أو GIF).',
    notVideo: 'هذا الملف ليس فيديو يمكن تشغيله (MP4 أو WebM).',
    videoTooLarge: 'الحد الأقصى لحجم الفيديو {size}',
    uploadFailed: 'فشل الرفع — يُرجى المحاولة مرة أخرى.',
    choose: 'اختر صورة لرفعها.',
  },
  domain: {
    adminJoinRefused: 'لا يمكن لعنوان البريد الإلكتروني هذا إنشاء حساب مشرف عام.',
    ...tenants,
    ...templatesWebsites,
    ...aiPerformanceAudit,
    ...applicationsEnquiriesAnnouncements,
    ...settingsPlansFlagsDomains,
    ...actions,
  },
}
