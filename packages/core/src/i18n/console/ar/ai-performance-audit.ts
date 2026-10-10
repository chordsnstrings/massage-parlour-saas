// Console page group "ai-performance-audit" (R22, AR). Mirrors en/ai-performance-audit.ts — a missing or extra key is a type error.
// Owned by that group's conversion; glossary + tone: docs/design/console-i18n.md.
import type { Widen } from '../../types'
import type { domainErrors as en } from '../en/ai-performance-audit'
import type { ConsoleMessages } from '../types'

export const aiModels: ConsoleMessages['aiModels'] = {
  title: 'نماذج الذكاء الاصطناعي',
  description:
    'نموذج BytePlus ModelArk لكل وكيل. Seed 2.0 افتراضيًا — تتغير معرّفات النماذج كثيرًا، لذا حدّثها من هنا دون الحاجة إلى نشر جديد.',
  usage: {
    title: 'استخدام الذكاء الاصطناعي',
    description:
      'إنفاق الذكاء الاصطناعي لكل مركز مقابل ميزانيته الشهرية (الأشهر بتوقيت دبي). عند 80% يُبلَّغ مالك المركز؛ وعند 100% يتوقف الذكاء الاصطناعي لهذا المركز حتى أول الشهر التالي.',
  },
}

export const performance: ConsoleMessages['performance'] = {
  title: 'الأداء',
}

export const auditLog: ConsoleMessages['auditLog'] = {
  title: 'سجل التدقيق',
  description: 'كل تغيير على مستوى المنصة، الأحدث أولًا.',
}

export const domainErrors: Widen<typeof en> = {}
