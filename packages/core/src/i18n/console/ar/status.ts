// `status` namespace (AR). Mirrors en/status.ts — a missing or extra key is a type error.
import type { ConsoleMessages } from '../types'

export const status: ConsoleMessages['status'] = {
  tenant: {
    trial: 'تجريبي',
    active: 'نشط',
    past_due: 'متأخر السداد',
    read_only: 'للقراءة فقط',
    suspended: 'معلّق',
    cancelled: 'ملغى',
  },
  subscription: { trialing: 'تجريبي', active: 'نشط', past_due: 'متأخر السداد', cancelled: 'ملغى' },
  invoice: { draft: 'مسودة', issued: 'صادرة', paid: 'مدفوعة', void: 'ملغاة' },
  application: { pending: 'قيد الانتظار', approved: 'مقبول', rejected: 'مرفوض' },
  enquiry: { new: 'جديد', contacted: 'تم التواصل', closed: 'مغلق' },
  domain: { pending: 'قيد الانتظار', verifying: 'قيد التحقق', active: 'نشط', failed: 'فشل' },
  domainOrder: {
    requested: 'مطلوب',
    purchasing: 'قيد الشراء',
    purchased: 'تم الشراء',
    failed: 'فشل',
    rejected: 'مرفوض',
    cancelled: 'ملغى',
  },
  job: { ok: 'ناجح', failed: 'فشل', skipped: 'تم التخطي', error: 'خطأ' },
  severity: { info: 'معلومة', warning: 'تحذير', critical: 'حرج' },
}
