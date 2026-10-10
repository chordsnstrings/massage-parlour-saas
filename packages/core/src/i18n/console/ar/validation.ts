// `validation` namespace (AR): zod field messages. Mirrors en/validation.ts (= the spa's en/validation.ts).
import type { ConsoleMessages } from '../types'

export const validation: ConsoleMessages['validation'] = {
  required: 'هذا الحقل مطلوب',
  tooShort: {
    one: 'استخدم حرفًا واحدًا على الأقل',
    two: 'استخدم حرفين على الأقل',
    few: 'استخدم {count} أحرف على الأقل',
    many: 'استخدم {count} حرفًا على الأقل',
    other: 'استخدم {count} حرف على الأقل',
  },
  tooLong: {
    one: 'استخدم حرفًا واحدًا على الأكثر',
    two: 'استخدم حرفين على الأكثر',
    few: 'استخدم {count} أحرف على الأكثر',
    many: 'استخدم {count} حرفًا على الأكثر',
    other: 'استخدم {count} حرف على الأكثر',
  },
  email: 'أدخل بريدًا إلكترونيًا صحيحًا',
  number: 'أدخل رقمًا',
  uaeMobile: 'أدخل رقم هاتف متحرك إماراتيًا، مثل 050 123 4567',
}
